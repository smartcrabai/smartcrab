//! Integration tests for `seher-bridge auth status` / argv validation.
//!
//! `PI_CODING_AGENT_DIR` points pi's global dir (and therefore auth.json) at a
//! temp dir, so these tests never touch the developer's real credentials and
//! need no network.

use std::process::{Command, Output, Stdio};

/// Run `seher-bridge auth <args..>` with auth.json rooted at `agent_dir`.
///
/// `HOME` is also pointed at the temp dir: pi's credential_status falls back
/// to "external" credentials of other CLIs (Codex / Claude / Copilot config
/// under the real home), which would make `none` assertions depend on the
/// developer machine.
fn run_auth(agent_dir: &std::path::Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_seher-bridge"))
        .arg("auth")
        .args(args)
        .env("PI_CODING_AGENT_DIR", agent_dir)
        .env("HOME", agent_dir)
        .env("XDG_CONFIG_HOME", agent_dir.join(".config"))
        // Make sure ambient keys do not leak into credential_status's
        // env fallback for the providers under test.
        .env_remove("GITHUB_COPILOT_API_KEY")
        .env_remove("GITHUB_TOKEN")
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("OPENAI_API_KEY")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .output()
        .expect("run seher-bridge auth")
}

fn frames(output: &Output) -> Vec<serde_json::Value> {
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("frame is valid json"))
        .collect()
}

#[test]
fn status_reports_none_for_unknown_providers() {
    let dir = tempfile::tempdir().expect("tempdir");
    let out = run_auth(dir.path(), &["status", "github-copilot", "openai-codex"]);
    assert!(out.status.success(), "auth status should exit 0");

    let frames = frames(&out);
    assert_eq!(frames.len(), 2, "one frame per provider: {frames:?}");
    assert_eq!(frames[0]["type"], "auth_status");
    assert_eq!(frames[0]["provider"], "github-copilot");
    assert_eq!(frames[0]["status"], "none");
    assert_eq!(frames[1]["provider"], "openai-codex");
    assert_eq!(frames[1]["status"], "none");
}

#[test]
fn status_reflects_seeded_credentials() {
    let dir = tempfile::tempdir().expect("tempdir");
    // Seed an auth.json in pi's on-disk format: api key for anthropic, a
    // far-future OAuth token for github-copilot, an expired one for
    // openai-codex.
    // Note: pi serializes the OAuth variant tag as "o_auth" (serde snake_case
    // of `OAuth`) — matches pi's own auth.json format.
    let auth = serde_json::json!({
        "anthropic": { "type": "api_key", "key": "sk-ant-test" },
        "github-copilot": {
            "type": "o_auth",
            "access_token": "gho_test",
            "refresh_token": "ghr_test",
            "expires": 4_102_444_800_000_i64 // 2100-01-01 in unix ms
        },
        "openai-codex": {
            "type": "o_auth",
            "access_token": "stale",
            "refresh_token": "stale",
            "expires": 1_000_i64
        },
    });
    std::fs::write(
        dir.path().join("auth.json"),
        serde_json::to_string_pretty(&auth).expect("serialize auth.json"),
    )
    .expect("write auth.json");

    let out = run_auth(
        dir.path(),
        &["status", "anthropic", "github-copilot", "openai-codex"],
    );
    assert!(out.status.success(), "auth status should exit 0");

    let frames = frames(&out);
    assert_eq!(frames.len(), 3, "frames: {frames:?}");
    assert_eq!(frames[0]["provider"], "anthropic");
    assert_eq!(frames[0]["status"], "api_key");
    assert_eq!(frames[1]["provider"], "github-copilot");
    assert_eq!(frames[1]["status"], "oauth_valid");
    assert!(
        frames[1]["expiresInMs"].as_i64().expect("expiresInMs") > 0,
        "frames: {frames:?}"
    );
    assert_eq!(frames[2]["provider"], "openai-codex");
    assert_eq!(frames[2]["status"], "oauth_expired");
    assert!(
        frames[2]["expiredByMs"].as_i64().expect("expiredByMs") > 0,
        "frames: {frames:?}"
    );
}

#[test]
fn login_with_unsupported_provider_yields_auth_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let out = run_auth(dir.path(), &["login", "anthropic"]);
    assert!(
        !out.status.success(),
        "unsupported login should exit non-zero"
    );

    let frames = frames(&out);
    assert_eq!(frames.len(), 1, "frames: {frames:?}");
    assert_eq!(frames[0]["type"], "auth_error");
    let msg = frames[0]["message"].as_str().expect("message");
    assert!(msg.contains("anthropic"), "message: {msg}");
}

#[test]
fn auth_without_subcommand_yields_auth_error_usage() {
    let dir = tempfile::tempdir().expect("tempdir");
    let out = run_auth(dir.path(), &[]);
    assert!(!out.status.success());

    let frames = frames(&out);
    assert_eq!(frames.len(), 1, "frames: {frames:?}");
    assert_eq!(frames[0]["type"], "auth_error");
    let msg = frames[0]["message"].as_str().expect("message");
    assert!(msg.contains("usage"), "message: {msg}");
}
