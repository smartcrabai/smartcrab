use std::time::Duration;

use async_trait::async_trait;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tracing::instrument;

use super::AgentExecutor;
use crate::error::{Result, SmartCrabError};

/// Claude Code CLI integration.
///
/// Executes the `claude` CLI as a child process, sending a prompt via stdin
/// and collecting the response from stdout.
pub struct ClaudeCode {
    timeout: Duration,
    allowed_tools: Vec<String>,
    system_prompt: Option<String>,
    max_turns: Option<u32>,
}

impl ClaudeCode {
    pub fn new() -> Self {
        Self {
            timeout: Duration::from_secs(300),
            allowed_tools: Vec::new(),
            system_prompt: None,
            max_turns: None,
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn with_allowed_tools(mut self, tools: &[&str]) -> Self {
        self.allowed_tools = tools.iter().map(|s| (*s).to_owned()).collect();
        self
    }

    pub fn with_system_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.system_prompt = Some(prompt.into());
        self
    }

    pub fn with_max_turns(mut self, max_turns: u32) -> Self {
        self.max_turns = Some(max_turns);
        self
    }

    /// Execute the Claude Code CLI with the given prompt.
    #[instrument(skip(self, prompt), fields(timeout = ?self.timeout))]
    pub async fn prompt(&self, prompt: &str) -> Result<String> {
        let mut cmd = Command::new("claude");
        // Allow spawning claude from within an existing Claude Code session.
        cmd.env_remove("CLAUDECODE");
        cmd.arg("--print").arg("--output-format").arg("text");

        if let Some(ref sp) = self.system_prompt {
            cmd.arg("--system-prompt").arg(sp);
        }
        if let Some(max) = self.max_turns {
            cmd.arg("--max-turns").arg(max.to_string());
        }
        if !self.allowed_tools.is_empty() {
            cmd.arg("--allowedTools").arg(self.allowed_tools.join(","));
        }

        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                SmartCrabError::ClaudeCodeNotFound
            } else {
                SmartCrabError::Io(e)
            }
        })?;

        // Write prompt to stdin and shutdown to signal EOF
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(prompt.as_bytes()).await?;
            stdin.shutdown().await?;
        }

        let result = tokio::time::timeout(self.timeout, child.wait_with_output()).await;

        match result {
            Err(_) => {
                // Timeout — child is already consumed by wait_with_output,
                // the future was dropped so the process will be cleaned up.
                Err(SmartCrabError::ClaudeCodeTimeout {
                    timeout: self.timeout,
                })
            }
            Ok(output) => {
                let output = output?;
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                    return Err(SmartCrabError::ClaudeCodeFailed {
                        exit_code: output.status.code().unwrap_or(-1),
                        stderr,
                    });
                }
                Ok(String::from_utf8_lossy(&output.stdout).to_string())
            }
        }
    }
}

impl Default for ClaudeCode {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AgentExecutor for ClaudeCode {
    async fn execute(&self, prompt: &str) -> Result<String> {
        self.prompt(prompt).await
    }
}

/// Mock implementation for testing.
pub struct MockClaudeCode {
    response: String,
}

impl MockClaudeCode {
    pub fn new(response: impl Into<String>) -> Self {
        Self {
            response: response.into(),
        }
    }
}

#[async_trait]
impl AgentExecutor for MockClaudeCode {
    async fn execute(&self, _prompt: &str) -> Result<String> {
        Ok(self.response.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claude_code_builder() {
        let cc = ClaudeCode::new()
            .with_timeout(Duration::from_secs(60))
            .with_allowed_tools(&["read", "write"])
            .with_system_prompt("You are helpful")
            .with_max_turns(5);

        assert_eq!(cc.timeout, Duration::from_secs(60));
        assert_eq!(cc.allowed_tools, vec!["read", "write"]);
        assert_eq!(cc.system_prompt.as_deref(), Some("You are helpful"));
        assert_eq!(cc.max_turns, Some(5));
    }

    #[tokio::test]
    async fn test_mock_claude_code() {
        let mock = MockClaudeCode::new("test response");
        let result = mock.execute("hello").await.unwrap();
        assert_eq!(result, "test response");
    }
}
