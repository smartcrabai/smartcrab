//! `seher-bridge`: a Rust sidecar that runs one LLM prompt through the seher SDK
//! and speaks the NDJSON stdio protocol with the bun-service.
//!
//! Run mode (no argv): spawned once per request. Reads a single `run` frame
//! from stdin, resolves a provider via seher, runs the prompt on pi, and emits
//! exactly one terminal frame (`done` / `limit` / `error`) before exiting (0 on
//! `done`, non-zero otherwise). stdout carries protocol frames only; logs go to
//! stderr.
//!
//! Auth mode (`seher-bridge auth ...`): provider login (device flow / OAuth)
//! and credential status — see `auth.rs`.

mod auth;
mod io;
mod protocol;

use std::io::{BufRead, BufReader, Stdout, Write, stdin, stdout};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use seher::sdk::{
    CodexBarProbe, PiRunOutput, PiRunner, PiRunnerOptions, ResolveError, ResolveOptions, RunError,
    SeherTool, resolve_agent, split_thinking_suffix,
};

use crate::io::{
    FrameWriter, ToolOutcome, ToolResultRouter, dispatch_tool_call, overall_timeout_from_env,
    run_stdin_reader, tool_timeout_from_env,
};
use crate::protocol::{Incoming, Outgoing, RunRequest};

fn main() {
    // `auth` subcommand; anything else (including no args) is run mode, so the
    // bun router's plain `spawn([bridgePath])` keeps working unchanged.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("auth") {
        std::process::exit(auth::run_auth(&args[1..]));
    }

    let writer = Arc::new(FrameWriter::new(stdout()));
    let exit_code = run(&writer);
    std::process::exit(exit_code);
}

/// Returns the process exit code: 0 for `done`, 1 otherwise.
fn run(writer: &Arc<FrameWriter<Stdout>>) -> i32 {
    // Owned `Stdin` (not a borrowed lock) so the `BufReader` is `Send` and can
    // move into the reader thread once the first line is consumed.
    let mut reader = BufReader::new(stdin());

    // Step 1: read & parse the first line as a `run` request.
    let request = match read_run_request(&mut reader) {
        Ok(req) => req,
        Err(message) => return emit_terminal(writer, Outgoing::Error { message, partial: None }),
    };

    // The stdin reader thread owns the rest of stdin (tool_result frames).
    let router = ToolResultRouter::new();
    let reader_router = router.clone();
    thread::spawn(move || run_stdin_reader(reader, &reader_router));

    let frame = execute(writer, &router, request);
    emit_terminal(writer, frame)
}

/// Read and parse the first stdin line as a `run` request.
fn read_run_request<R: BufRead>(reader: &mut R) -> Result<RunRequest, String> {
    let mut line = String::new();
    let read = reader
        .read_line(&mut line)
        .map_err(|e| format!("failed to read run request: {e}"))?;
    if read == 0 {
        return Err("no run request received on stdin".to_string());
    }
    match serde_json::from_str::<Incoming>(line.trim_end()) {
        Ok(Incoming::Run(req)) => Ok(req),
        Ok(Incoming::ToolResult(_)) => {
            Err("first frame must be 'run', got 'tool_result'".to_string())
        }
        Err(e) => Err(format!("invalid run request: {e}")),
    }
}

/// Resolve a provider, build the pi runner, and run the prompt. Returns the
/// terminal frame to emit. Never panics: every failure maps to an `error` /
/// `limit` frame.
fn execute(
    writer: &Arc<FrameWriter<Stdout>>,
    router: &ToolResultRouter,
    request: RunRequest,
) -> Outgoing {
    let mode_key = request.model.clone().unwrap_or_else(|| "build".to_string());
    let config_path = request.config_path.clone().map(PathBuf::from);
    let require_tools = !request.tools.is_empty();

    // Step 2: resolve a provider. A current-thread runtime is enough — resolution
    // only awaits the codexbar probe (which gracefully degrades when the binary
    // is absent), and pi itself runs on its own thread.
    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            return Outgoing::Error {
                message: format!("failed to build tokio runtime: {e}"),
                partial: None,
            };
        }
    };

    let opts = ResolveOptions {
        mode_key,
        config_path,
        no_wait: true,
        require_tools,
        ..Default::default()
    };
    let resolved = {
        let mut probe = CodexBarProbe;
        match rt.block_on(async { resolve_agent(opts, &mut probe).await }) {
            Ok(resolved) => resolved,
            Err(ResolveError::AllLimited(e)) => {
                return Outgoing::Limit {
                    message: e.to_string(),
                    partial: None,
                };
            }
            Err(e) => {
                return Outgoing::Error {
                    message: e.to_string(),
                    partial: None,
                };
            }
        }
    };

    // Step 3: build PiRunnerOptions from the resolved agent (mirrors the seher-cli
    // `build_pi_runner` recipe: split model_id into provider/model, strip a
    // recognized `:thinking` suffix, fall back to a provider-specific env API key).
    let (provider, model, thinking) = parse_provider_model(&resolved.model_id);
    let api_key = resolved
        .api
        .as_ref()
        .and_then(|a| a.key.clone())
        .or_else(|| env_api_key_for(provider.as_deref()));

    // Step 4: convert each requested tool into a SeherTool whose handler blocks on
    // the stdin reader for the matching tool_result.
    let tool_timeout = tool_timeout_from_env();
    let tools = build_tools(writer, router, &request.tools, tool_timeout);

    let runner = PiRunner::new(PiRunnerOptions {
        provider,
        model,
        api_key,
        thinking,
        system_prompt: request.system_prompt,
        working_directory: None,
        tools,
    });

    // Step 5: run the prompt. PiRunner::run drives pi on its own internal thread,
    // so an optional overall timeout is enforced by running it on a worker thread
    // and waiting with recv_timeout.
    run_with_timeout(runner, request.prompt, overall_timeout_from_env())
}

/// Run the prompt, optionally bounded by an overall timeout. Maps the pi result
/// into a terminal frame.
fn run_with_timeout(runner: PiRunner, prompt: String, timeout: Option<Duration>) -> Outgoing {
    let result = match timeout {
        None => runner.run(prompt, None),
        Some(timeout) => {
            let (tx, rx) = std::sync::mpsc::channel();
            thread::spawn(move || {
                let _ = tx.send(runner.run(prompt, None));
            });
            match rx.recv_timeout(timeout) {
                Ok(result) => result,
                Err(_) => {
                    return Outgoing::Error {
                        message: format!("run timed out after {}ms", timeout.as_millis()),
                        partial: None,
                    };
                }
            }
        }
    };

    match result {
        Ok(PiRunOutput { text, session_id }) => Outgoing::done(text, session_id),
        Err(RunError::Limit { error, partial }) => Outgoing::Limit {
            message: error.to_string(),
            partial: non_empty(partial),
        },
        Err(err @ (RunError::Timeout { .. } | RunError::Other { .. })) => {
            let partial = non_empty(err.partial().to_string());
            Outgoing::Error {
                message: err.to_string(),
                partial,
            }
        }
    }
}

/// Convert protocol tool defs into seher tools. Each handler emits a `tool_call`
/// and blocks (on pi's own thread) for the routed `tool_result`.
fn build_tools(
    writer: &Arc<FrameWriter<Stdout>>,
    router: &ToolResultRouter,
    defs: &[protocol::ToolDef],
    timeout: Duration,
) -> Vec<SeherTool> {
    // Monotonic counter -> unique tool_call ids within this run.
    let counter = Arc::new(AtomicU64::new(0));
    defs.iter()
        .map(|def| {
            let writer = Arc::clone(writer);
            let router = router.clone();
            let counter = Arc::clone(&counter);
            let name = def.name.clone();
            SeherTool::new(
                def.name.clone(),
                def.description.clone(),
                def.parameters.clone(),
                Arc::new(move |input: serde_json::Value| {
                    let n = counter.fetch_add(1, Ordering::Relaxed);
                    let id = format!("tc-{n}");
                    match dispatch_tool_call(&writer, &router, id, &name, input, timeout) {
                        ToolOutcome::Output(out) => Ok(out),
                        ToolOutcome::Error(err) => Err(err),
                    }
                }),
            )
        })
        .collect()
}

/// Splits a config model id into `(provider, model, thinking)` — mirrors
/// seher-cli's `parse_provider_model`. The segment before the first `/` is the
/// provider; a recognized trailing `:level` selects pi's thinking level.
fn parse_provider_model(model_id: &str) -> (Option<String>, Option<String>, Option<String>) {
    let (provider, rest) = match model_id.split_once('/') {
        Some((p, m)) => (Some(p.to_string()), m),
        None => (None, model_id),
    };
    let (model, thinking) = split_thinking_suffix(rest);
    (
        provider,
        Some(model.to_string()),
        thinking.map(str::to_string),
    )
}

/// Provider-specific API-key env fallback — mirrors seher-cli's `env_api_key_for`.
fn env_api_key_for(provider: Option<&str>) -> Option<String> {
    let var = match provider {
        Some("anthropic") => "ANTHROPIC_API_KEY",
        Some("openai") => "OPENAI_API_KEY",
        _ => return None,
    };
    std::env::var(var).ok()
}

/// Emit the single terminal frame and return the matching process exit code.
fn emit_terminal<W: Write + Send>(writer: &FrameWriter<W>, frame: Outgoing) -> i32 {
    let code = if frame.is_success() { 0 } else { 1 };
    if let Err(e) = writer.write(&frame) {
        eprintln!("[seher-bridge] failed to write terminal frame: {e}");
        return 1;
    }
    code
}

fn non_empty(s: String) -> Option<String> {
    if s.is_empty() { None } else { Some(s) }
}
