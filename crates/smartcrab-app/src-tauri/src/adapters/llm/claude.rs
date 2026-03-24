use std::time::Duration;

use async_trait::async_trait;

use super::{LlmAdapter, LlmCapabilities, LlmRequest, LlmResponse};
use crate::error::AppError;

/// Adapter ID used in error messages and registry registration.
const ADAPTER_ID: &str = "claude";

/// Default timeout when none is specified in the request.
const DEFAULT_TIMEOUT_SECS: u64 = 120;

/// Claude LLM adapter.
///
/// Executes prompts by spawning the `claude` CLI as a subprocess.
pub struct ClaudeLlmAdapter {
    capabilities: LlmCapabilities,
}

impl ClaudeLlmAdapter {
    /// Creates a new Claude adapter with default capability flags.
    #[must_use]
    pub fn new() -> Self {
        Self {
            capabilities: LlmCapabilities {
                streaming: true,
                function_calling: false,
                max_context_tokens: 200_000,
            },
        }
    }
}

impl Default for ClaudeLlmAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl LlmAdapter for ClaudeLlmAdapter {
    fn id(&self) -> &'static str {
        ADAPTER_ID
    }

    fn name(&self) -> &'static str {
        "Claude"
    }

    fn capabilities(&self) -> &LlmCapabilities {
        &self.capabilities
    }

    async fn execute_prompt(&self, request: &LlmRequest) -> Result<LlmResponse, AppError> {
        let timeout_secs = request.timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS);

        let output = tokio::time::timeout(
            Duration::from_secs(timeout_secs),
            tokio::process::Command::new(ADAPTER_ID)
                .arg("-p")
                .arg(&request.prompt)
                .output(),
        )
        .await
        .map_err(|_| AppError::Adapter(format!("{ADAPTER_ID}: timed out after {timeout_secs}s")))?
        .map_err(|e| {
            AppError::Adapter(format!("{ADAPTER_ID}: failed to spawn claude process: {e}"))
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Adapter(format!(
                "{ADAPTER_ID}: exited with code {}: {stderr}",
                output.status.code().unwrap_or(-1)
            )));
        }

        let content = String::from_utf8_lossy(&output.stdout).into_owned();

        Ok(LlmResponse {
            content,
            metadata: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_adapter_id_and_name() {
        let adapter = ClaudeLlmAdapter::new();
        assert_eq!(adapter.id(), "claude");
        assert_eq!(adapter.name(), "Claude");
    }

    #[test]
    fn claude_adapter_capabilities() {
        let adapter = ClaudeLlmAdapter::new();
        let caps = adapter.capabilities();
        assert!(caps.streaming);
        assert!(!caps.function_calling);
        assert_eq!(caps.max_context_tokens, 200_000);
    }

    #[test]
    fn claude_adapter_default_impl() {
        let adapter = ClaudeLlmAdapter::default();
        assert_eq!(adapter.id(), "claude");
    }
}
