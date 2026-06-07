//! stdio plumbing: a serialized frame writer, a stdin reader that routes
//! `tool_result` frames to waiting tool handlers, and the synchronous tool
//! handler invoked by pi on its own thread.

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::protocol::{Incoming, Outgoing, ToolResult};

/// Default per-tool-call timeout (overridable via
/// `SMARTCRAB_SEHER_BRIDGE_TOOL_TIMEOUT_MS`).
pub const DEFAULT_TOOL_TIMEOUT_MS: u64 = 120_000;

/// Serializes protocol frame writes to a single underlying writer. stdout must
/// carry one frame per line and never interleave, so every writer (the pi
/// thread's tool handlers and the main thread's terminal frame) goes through
/// this lock.
pub struct FrameWriter<W: Write + Send> {
    inner: Mutex<W>,
}

impl<W: Write + Send> FrameWriter<W> {
    pub const fn new(writer: W) -> Self {
        Self {
            inner: Mutex::new(writer),
        }
    }

    /// Serialize `frame` as one NDJSON line and flush. Returns an error string
    /// on serialization, lock, or I/O failure. Generic so both run-mode
    /// (`Outgoing`) and auth-mode (`AuthEvent`) frames share the same writer.
    pub fn write<F: serde::Serialize>(&self, frame: &F) -> Result<(), String> {
        let line = serde_json::to_string(frame).map_err(|e| e.to_string())?;
        let mut guard = self.inner.lock().map_err(|_| "frame writer poisoned")?;
        guard
            .write_all(line.as_bytes())
            .and_then(|()| guard.write_all(b"\n"))
            .and_then(|()| guard.flush())
            .map_err(|e| e.to_string())
    }
}

/// Routes incoming `tool_result` frames to the handler waiting on a given id.
///
/// A handler registers its id (receiving a one-shot channel) before emitting the
/// matching `tool_call`. The stdin reader looks the id up and delivers the result.
#[derive(Clone, Default)]
pub struct ToolResultRouter {
    waiters: Arc<Mutex<HashMap<String, Sender<ToolResult>>>>,
}

impl ToolResultRouter {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Register `id` and return the receiver the handler blocks on.
    pub fn register(&self, id: String) -> Receiver<ToolResult> {
        let (tx, rx) = channel();
        // A poisoned lock here is unrecoverable; drop the sender so the waiter
        // unblocks with a disconnect error rather than hanging forever.
        if let Ok(mut map) = self.waiters.lock() {
            map.insert(id, tx);
        }
        rx
    }

    /// Deliver `result` to the waiter registered under its id (no-op if none).
    pub fn deliver(&self, result: ToolResult) {
        if let Ok(mut map) = self.waiters.lock()
            && let Some(tx) = map.remove(&result.id)
        {
            let _ = tx.send(result);
        }
    }
}

/// Read NDJSON `tool_result` frames from `reader` and route them via `router`.
/// Runs on a dedicated thread for the lifetime of the run; returns when stdin
/// closes. Malformed lines are logged to stderr and skipped (the model can still
/// recover from a missing tool result via the handler timeout).
pub fn run_stdin_reader<R: BufRead>(reader: R, router: &ToolResultRouter) {
    for line in reader.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Incoming>(&line) {
            Ok(Incoming::ToolResult(result)) => router.deliver(result),
            // A second `run` (or anything else) on the result channel is a
            // protocol violation; ignore it but surface for debugging.
            Ok(Incoming::Run(_)) => {
                eprintln!("[seher-bridge] unexpected 'run' frame after start; ignoring");
            }
            Err(e) => eprintln!("[seher-bridge] ignoring malformed stdin line: {e}"),
        }
    }
}

/// Outcome of waiting for a tool result, normalized into pi's `Ok`/`Err` model.
pub enum ToolOutcome {
    /// `tool_result.output` -> tool succeeds.
    Output(String),
    /// `tool_result.error`, a timeout, or a disconnect -> tool error (the model
    /// sees `is_error: true` and can recover).
    Error(String),
}

/// Emit a `tool_call` frame and block until the matching `tool_result` arrives
/// (or the timeout elapses). Called synchronously from pi's tool handler, which
/// runs on a dedicated thread, so blocking here is safe.
pub fn dispatch_tool_call<W: Write + Send>(
    writer: &FrameWriter<W>,
    router: &ToolResultRouter,
    id: String,
    name: &str,
    input: serde_json::Value,
    timeout: Duration,
) -> ToolOutcome {
    // Register before emitting the call so a fast reply can never race past us.
    let rx = router.register(id.clone());
    let frame = Outgoing::ToolCall {
        id,
        name: name.to_string(),
        input,
    };
    if let Err(e) = writer.write(&frame) {
        return ToolOutcome::Error(format!("failed to write tool_call: {e}"));
    }
    match rx.recv_timeout(timeout) {
        Ok(result) => match (result.output, result.error) {
            (Some(output), _) => ToolOutcome::Output(output),
            (None, Some(error)) => ToolOutcome::Error(error),
            (None, None) => {
                ToolOutcome::Error(format!("tool '{name}' result had neither output nor error"))
            }
        },
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            ToolOutcome::Error(format!("tool '{name}' timed out"))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            ToolOutcome::Error(format!("tool '{name}' channel disconnected"))
        }
    }
}

/// Read the tool timeout from `SMARTCRAB_SEHER_BRIDGE_TOOL_TIMEOUT_MS`, falling
/// back to [`DEFAULT_TOOL_TIMEOUT_MS`] when unset or unparseable.
#[must_use]
pub fn tool_timeout_from_env() -> Duration {
    let ms = std::env::var("SMARTCRAB_SEHER_BRIDGE_TOOL_TIMEOUT_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(DEFAULT_TOOL_TIMEOUT_MS);
    Duration::from_millis(ms)
}

/// Read the optional overall-run timeout from `SMARTCRAB_SEHER_BRIDGE_TIMEOUT_MS`.
/// `None` when unset (no overall timeout).
#[must_use]
pub fn overall_timeout_from_env() -> Option<Duration> {
    std::env::var("SMARTCRAB_SEHER_BRIDGE_TIMEOUT_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .map(Duration::from_millis)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::thread;

    fn collect_lines(buf: &[u8]) -> Vec<serde_json::Value> {
        String::from_utf8_lossy(buf)
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| serde_json::from_str(l).expect("each line is valid json"))
            .collect()
    }

    #[test]
    fn frame_writer_emits_one_ndjson_line_per_frame() {
        let writer = FrameWriter::new(Vec::new());
        writer
            .write(&Outgoing::done("a".to_string(), "s".to_string()))
            .expect("write");
        writer
            .write(&Outgoing::Error {
                message: "e".to_string(),
                partial: None,
            })
            .expect("write");
        let inner = writer.inner.into_inner().expect("unlock");
        let lines = collect_lines(&inner);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["type"], "done");
        assert_eq!(lines[1]["type"], "error");
    }

    #[test]
    fn dispatch_tool_call_round_trip_output() {
        let writer = Arc::new(FrameWriter::new(Vec::new()));
        let router = ToolResultRouter::new();

        // Reader thread feeds a matching tool_result.
        let reader_router = router.clone();
        let stdin = Cursor::new(r#"{"type":"tool_result","id":"id-1","output":"pong"}"#.to_string());
        let reader = thread::spawn(move || run_stdin_reader(stdin, &reader_router));

        let outcome = dispatch_tool_call(
            &writer,
            &router,
            "id-1".to_string(),
            "ping",
            serde_json::json!({}),
            Duration::from_secs(5),
        );
        reader.join().expect("reader joins");

        match outcome {
            ToolOutcome::Output(o) => assert_eq!(o, "pong"),
            ToolOutcome::Error(e) => panic!("expected output, got error: {e}"),
        }
        // The tool_call frame should have been written.
        let inner = Arc::try_unwrap(writer)
            .map_err(|_| "writer still shared")
            .expect("sole owner")
            .inner
            .into_inner()
            .expect("unlock");
        let lines = collect_lines(&inner);
        assert_eq!(lines[0]["type"], "tool_call");
        assert_eq!(lines[0]["id"], "id-1");
        assert_eq!(lines[0]["name"], "ping");
    }

    #[test]
    fn dispatch_tool_call_round_trip_error() {
        let writer = FrameWriter::new(Vec::new());
        let router = ToolResultRouter::new();
        router.deliver(ToolResult {
            id: "id-2".to_string(),
            output: None,
            error: Some("nope".to_string()),
        });
        // deliver before register => no waiter yet; register then deliver again.
        let outcome = {
            let router2 = router.clone();
            let stdin =
                Cursor::new(r#"{"type":"tool_result","id":"id-2","error":"nope"}"#.to_string());
            let reader = thread::spawn(move || run_stdin_reader(stdin, &router2));
            let o = dispatch_tool_call(
                &writer,
                &router,
                "id-2".to_string(),
                "boom",
                serde_json::json!({}),
                Duration::from_secs(5),
            );
            reader.join().expect("reader joins");
            o
        };
        match outcome {
            ToolOutcome::Error(e) => assert_eq!(e, "nope"),
            ToolOutcome::Output(o) => panic!("expected error, got output: {o}"),
        }
    }

    #[test]
    fn dispatch_tool_call_times_out() {
        let writer = FrameWriter::new(Vec::new());
        let router = ToolResultRouter::new();
        let outcome = dispatch_tool_call(
            &writer,
            &router,
            "id-3".to_string(),
            "slow",
            serde_json::json!({}),
            Duration::from_millis(20),
        );
        match outcome {
            ToolOutcome::Error(e) => assert!(e.contains("timed out"), "got: {e}"),
            ToolOutcome::Output(o) => panic!("expected timeout error, got output: {o}"),
        }
    }

    #[test]
    fn tool_timeout_env_falls_back_to_default() {
        // SAFETY: tests in this module touch process-global env; this assertion
        // only relies on the var being absent in CI.
        unsafe {
            std::env::remove_var("SMARTCRAB_SEHER_BRIDGE_TOOL_TIMEOUT_MS");
        }
        assert_eq!(
            tool_timeout_from_env(),
            Duration::from_millis(DEFAULT_TOOL_TIMEOUT_MS)
        );
    }
}
