//! Integration test: spawn the built `seher-bridge` binary and drive a `run`
//! that resolves against a config with no usable providers, asserting an `error`
//! terminal frame comes back. Needs no LLM credits.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

/// Run the bridge with `run_line` on stdin and return the first emitted frame
/// (parsed JSON). Closes stdin after the run line so a no-tools run can finish.
fn run_bridge(run_line: &str) -> serde_json::Value {
    let mut child = Command::new(env!("CARGO_BIN_EXE_seher-bridge"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn seher-bridge");

    {
        let stdin = child.stdin.as_mut().expect("child stdin");
        stdin
            .write_all(run_line.as_bytes())
            .expect("write run line");
        stdin.write_all(b"\n").expect("write newline");
    }
    // Drop stdin so the reader thread sees EOF.
    drop(child.stdin.take());

    let stdout = child.stdout.take().expect("child stdout");
    let mut lines = BufReader::new(stdout).lines();
    let first = lines
        .next()
        .expect("at least one frame")
        .expect("read frame line");
    child.wait().expect("child exits");
    serde_json::from_str(&first).expect("frame is valid json")
}

#[test]
fn missing_config_path_yields_error_frame() {
    // A config path that does not exist => load_config fails => error frame.
    let line = r#"{"type":"run","prompt":"hi","systemPrompt":null,"model":null,"configPath":"/tmp/seher-bridge-nonexistent-config.yaml","tools":[]}"#;
    let frame = run_bridge(line);
    assert_eq!(frame["type"], "error", "frame: {frame}");
}

#[test]
fn empty_providers_config_yields_error_frame() {
    // A valid but empty config (no providers) => no matching agent => error frame.
    let dir = tempfile::tempdir().expect("tempdir");
    let config_path = dir.path().join("config.yaml");
    std::fs::write(&config_path, "providers: {}\n").expect("write config");

    let line = format!(
        r#"{{"type":"run","prompt":"hi","systemPrompt":null,"model":null,"configPath":{:?},"tools":[]}}"#,
        config_path.to_string_lossy()
    );
    let frame = run_bridge(&line);
    assert_eq!(frame["type"], "error", "frame: {frame}");
}

#[test]
fn malformed_first_line_yields_error_frame() {
    let frame = run_bridge("not json at all");
    assert_eq!(frame["type"], "error", "frame: {frame}");
}
