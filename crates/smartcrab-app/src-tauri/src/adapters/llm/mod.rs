pub mod claude;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Declares what an LLM provider can do.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmCapabilities {
    pub streaming: bool,
    pub function_calling: bool,
    pub max_context_tokens: u64,
}

/// A normalized prompt request sent to any LLM adapter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmRequest {
    pub prompt: String,
    pub timeout_secs: Option<u64>,
    pub metadata: Option<serde_json::Value>,
}

/// A normalized response returned from any LLM adapter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmResponse {
    pub content: String,
    pub metadata: Option<serde_json::Value>,
}

/// Trait that every LLM-provider adapter must implement.
///
/// Adding a new provider requires:
/// 1. Implementing this trait.
/// 2. Registering the adapter with `AdapterRegistry<dyn LlmAdapter>`.
///
/// No other code changes are needed.
#[async_trait]
pub trait LlmAdapter: Send + Sync {
    /// Unique machine-readable identifier (e.g. `"claude"`).
    fn id(&self) -> &str;

    /// Human-readable display name (e.g. `"Claude"`).
    fn name(&self) -> &str;

    /// Static capability declaration for this provider.
    fn capabilities(&self) -> &LlmCapabilities;

    /// Sends a prompt and waits for the complete response.
    async fn execute_prompt(
        &self,
        request: &LlmRequest,
    ) -> Result<LlmResponse, crate::error::AppError>;

    /// Streams a prompt response.
    ///
    /// The default implementation falls back to [`execute_prompt`](Self::execute_prompt).
    async fn stream_prompt(
        &self,
        request: &LlmRequest,
    ) -> Result<LlmResponse, crate::error::AppError> {
        self.execute_prompt(request).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn llm_capabilities_serialization_roundtrip() {
        let caps = LlmCapabilities {
            streaming: true,
            function_calling: false,
            max_context_tokens: 200_000,
        };

        let json = serde_json::to_string(&caps).ok();
        assert!(json.is_some());

        let deserialized: Option<LlmCapabilities> =
            json.and_then(|j| serde_json::from_str(&j).ok());
        assert!(deserialized.is_some());

        let caps2 = deserialized.as_ref();
        assert_eq!(caps2.map(|c| c.streaming), Some(true));
        assert_eq!(caps2.map(|c| c.function_calling), Some(false));
        assert_eq!(caps2.map(|c| c.max_context_tokens), Some(200_000));
    }

    #[test]
    fn llm_request_serialization_roundtrip() {
        let req = LlmRequest {
            prompt: "Hello".to_owned(),
            timeout_secs: Some(30),
            metadata: None,
        };

        let json = serde_json::to_string(&req).ok();
        assert!(json.is_some());

        let deserialized: Option<LlmRequest> = json.and_then(|j| serde_json::from_str(&j).ok());
        assert!(deserialized.is_some());

        let req2 = deserialized.as_ref();
        assert_eq!(req2.map(|r| r.prompt.as_str()), Some("Hello"));
        assert_eq!(req2.map(|r| r.timeout_secs), Some(Some(30)));
    }

    #[test]
    fn llm_response_serialization_roundtrip() {
        let resp = LlmResponse {
            content: "World".to_owned(),
            metadata: Some(serde_json::json!({"tokens": 42})),
        };

        let json = serde_json::to_string(&resp).ok();
        assert!(json.is_some());

        let deserialized: Option<LlmResponse> = json.and_then(|j| serde_json::from_str(&j).ok());
        assert!(deserialized.is_some());

        let resp2 = deserialized.as_ref();
        assert_eq!(resp2.map(|r| r.content.as_str()), Some("World"));
        assert!(resp2.and_then(|r| r.metadata.as_ref()).is_some());
    }
}
