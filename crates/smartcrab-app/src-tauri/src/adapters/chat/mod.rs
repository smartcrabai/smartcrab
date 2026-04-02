pub mod discord;
pub mod runtime;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Declares what a chat platform can do.
///
/// Upper layers inspect these flags at runtime to decide which features
/// to expose for a given platform (e.g. reactions, threads, file uploads).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "capability flags are inherently boolean"
)]
pub struct ChatCapabilities {
    pub threads: bool,
    pub reactions: bool,
    pub file_upload: bool,
    pub streaming: bool,
    pub direct_message: bool,
    pub group_message: bool,
}

/// A normalized chat message used across all platform adapters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub channel_id: String,
    pub content: String,
    pub author: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

/// Trait that every chat-platform adapter must implement.
///
/// Adding support for a new platform requires:
/// 1. Implementing this trait.
/// 2. Registering the adapter with `AdapterRegistry<dyn ChatAdapter>`.
///
/// No other code changes are needed.
#[async_trait]
pub trait ChatAdapter: Send + Sync {
    /// Unique machine-readable identifier (e.g. `"discord"`).
    fn id(&self) -> &str;

    /// Human-readable display name (e.g. `"Discord"`).
    fn name(&self) -> &str;

    /// Static capability declaration for this platform.
    fn capabilities(&self) -> &ChatCapabilities;

    /// Sends a text message to the specified channel.
    async fn send_message(
        &self,
        channel_id: &str,
        content: &str,
    ) -> Result<(), crate::error::AppError>;

    /// Starts the background listener (bot loop, websocket, etc.).
    async fn start_listener(&self) -> Result<(), crate::error::AppError>;

    /// Gracefully stops the background listener.
    async fn stop_listener(&self) -> Result<(), crate::error::AppError>;

    /// Returns `true` when the listener is actively running.
    fn is_running(&self) -> bool;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_capabilities_serialization_roundtrip() {
        let caps = ChatCapabilities {
            threads: true,
            reactions: false,
            file_upload: true,
            streaming: false,
            direct_message: true,
            group_message: false,
        };

        let json = serde_json::to_string(&caps).ok();
        assert!(json.is_some());

        let deserialized: Option<ChatCapabilities> =
            json.and_then(|j| serde_json::from_str(&j).ok());
        assert!(deserialized.is_some());

        let caps2 = deserialized.as_ref();
        assert_eq!(caps2.map(|c| c.threads), Some(true));
        assert_eq!(caps2.map(|c| c.reactions), Some(false));
        assert_eq!(caps2.map(|c| c.file_upload), Some(true));
        assert_eq!(caps2.map(|c| c.streaming), Some(false));
        assert_eq!(caps2.map(|c| c.direct_message), Some(true));
        assert_eq!(caps2.map(|c| c.group_message), Some(false));
    }

    #[test]
    fn chat_message_serialization_roundtrip() {
        let msg = ChatMessage {
            channel_id: "ch-1".to_owned(),
            content: "hello".to_owned(),
            author: Some("bot".to_owned()),
            metadata: None,
        };

        let json = serde_json::to_string(&msg).ok();
        assert!(json.is_some());

        let deserialized: Option<ChatMessage> = json.and_then(|j| serde_json::from_str(&j).ok());
        assert!(deserialized.is_some());

        let msg2 = deserialized.as_ref();
        assert_eq!(msg2.map(|m| m.channel_id.as_str()), Some("ch-1"));
        assert_eq!(msg2.map(|m| m.content.as_str()), Some("hello"));
    }
}
