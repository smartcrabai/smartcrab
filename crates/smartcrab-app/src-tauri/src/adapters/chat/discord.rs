use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;

use super::{ChatAdapter, ChatCapabilities};
use crate::error::AppError;

/// Adapter ID used in error messages and registry registration.
const ADAPTER_ID: &str = "discord";

/// Discord chat adapter.
///
/// Wraps the Discord bot lifecycle and exposes it through the
/// platform-agnostic [`ChatAdapter`] trait.
pub struct DiscordChatAdapter {
    capabilities: ChatCapabilities,
    running: AtomicBool,
}

impl DiscordChatAdapter {
    /// Creates a new Discord adapter with default capability flags.
    #[must_use]
    pub fn new() -> Self {
        Self {
            capabilities: ChatCapabilities {
                threads: true,
                reactions: true,
                file_upload: true,
                // Discord does not support streaming message edits natively.
                streaming: false,
                direct_message: true,
                group_message: true,
            },
            running: AtomicBool::new(false),
        }
    }
}

impl Default for DiscordChatAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ChatAdapter for DiscordChatAdapter {
    fn id(&self) -> &'static str {
        ADAPTER_ID
    }

    fn name(&self) -> &'static str {
        "Discord"
    }

    fn capabilities(&self) -> &ChatCapabilities {
        &self.capabilities
    }

    async fn send_message(&self, _channel_id: &str, _content: &str) -> Result<(), AppError> {
        // TODO: implement via poise / serenity HTTP client
        Err(AppError::Adapter(format!(
            "{ADAPTER_ID}: send_message not yet implemented"
        )))
    }

    async fn start_listener(&self) -> Result<(), AppError> {
        self.running.store(true, Ordering::Release);
        // TODO: spawn poise framework in background task
        Ok(())
    }

    async fn stop_listener(&self) -> Result<(), AppError> {
        self.running.store(false, Ordering::Release);
        Ok(())
    }

    fn is_running(&self) -> bool {
        self.running.load(Ordering::Acquire)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discord_adapter_id_and_name() {
        let adapter = DiscordChatAdapter::new();
        assert_eq!(adapter.id(), "discord");
        assert_eq!(adapter.name(), "Discord");
    }

    #[test]
    fn discord_adapter_capabilities() {
        let adapter = DiscordChatAdapter::new();
        let caps = adapter.capabilities();
        assert!(caps.threads);
        assert!(caps.reactions);
        assert!(caps.file_upload);
        assert!(!caps.streaming);
        assert!(caps.direct_message);
        assert!(caps.group_message);
    }

    #[test]
    fn discord_adapter_default_not_running() {
        let adapter = DiscordChatAdapter::new();
        assert!(!adapter.is_running());
    }

    #[tokio::test]
    async fn discord_adapter_start_stop_lifecycle() {
        let adapter = DiscordChatAdapter::new();

        assert!(!adapter.is_running());

        let start_result = adapter.start_listener().await;
        assert!(start_result.is_ok());
        assert!(adapter.is_running());

        let stop_result = adapter.stop_listener().await;
        assert!(stop_result.is_ok());
        assert!(!adapter.is_running());
    }

    #[test]
    fn discord_adapter_default_impl() {
        let adapter = DiscordChatAdapter::default();
        assert_eq!(adapter.id(), "discord");
    }
}
