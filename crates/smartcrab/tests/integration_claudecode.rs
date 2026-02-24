//! Integration tests for Claude Code CLI.
//!
//! These tests require:
//! - `claude` CLI installed and authenticated
//!
//! Run with: `cargo test -p smartcrab --test integration_claudecode -- --ignored`

use std::time::Duration;

use smartcrab::agent::AgentExecutor;
use smartcrab::agent::claudecode::ClaudeCode;

#[tokio::test]
#[ignore]
async fn test_claude_code_simple_prompt() {
    let cc = ClaudeCode::new()
        .with_timeout(Duration::from_secs(30))
        .with_max_turns(1);

    let response = cc
        .execute("Reply with exactly: PONG")
        .await
        .expect("claude CLI should succeed");

    assert!(
        response.contains("PONG"),
        "Expected response to contain 'PONG', got: {response}"
    );
}

#[tokio::test]
#[ignore]
async fn test_claude_code_with_system_prompt() {
    let cc = ClaudeCode::new()
        .with_timeout(Duration::from_secs(30))
        .with_system_prompt("You are a calculator. Only output the numeric result, nothing else.")
        .with_max_turns(1);

    let response = cc
        .execute("What is 2 + 3?")
        .await
        .expect("claude CLI should succeed");

    assert!(
        response.contains('5'),
        "Expected response to contain '5', got: {response}"
    );
}

#[tokio::test]
#[ignore]
async fn test_claude_code_json_response() {
    let cc = ClaudeCode::new()
        .with_timeout(Duration::from_secs(30))
        .with_system_prompt(
            "You are an API. Always respond with valid JSON only. No markdown fences.",
        )
        .with_max_turns(1);

    let response = cc
        .execute(r#"Return a JSON object with keys "status" (value "ok") and "count" (value 42)."#)
        .await
        .expect("claude CLI should succeed");

    let parsed: serde_json::Value =
        serde_json::from_str(response.trim()).expect("response should be valid JSON");
    assert_eq!(parsed["status"], "ok");
    assert_eq!(parsed["count"], 42);
}

#[tokio::test]
#[ignore]
async fn test_claude_code_timeout() {
    let cc = ClaudeCode::new().with_timeout(Duration::from_millis(1));

    let result = cc.execute("Hello").await;

    assert!(
        result.is_err(),
        "Expected timeout error with 1ms timeout, but got success"
    );
}
