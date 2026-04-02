use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::{ChatAdapter, ChatCapabilities};
use crate::error::AppError;

/// Adapter ID used in error messages and registry registration.
pub const ADAPTER_ID: &str = "discord";

/// Typed configuration for the Discord adapter.
///
/// Stored in `chat_adapter_config.config_json` as JSON.
/// Token values are never stored -- only the environment variable name.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordConfig {
    pub bot_token_env: String,
    #[serde(default)]
    pub notification_channel_id: Option<String>,
}

impl DiscordConfig {
    /// Parse from a `serde_json::Value` coming from the database.
    ///
    /// # Errors
    ///
    /// Returns [`AppError::InvalidInput`] if required fields are missing.
    pub fn from_json_value(value: serde_json::Value) -> Result<Self, AppError> {
        serde_json::from_value(value)
            .map_err(|e| AppError::InvalidInput(format!("invalid Discord config: {e}")))
    }

    /// Default config used when no DB row exists yet.
    #[must_use]
    pub fn default_config() -> serde_json::Value {
        serde_json::json!({
            "bot_token_env": ""
        })
    }

    /// Resolve the actual bot token from the environment variable.
    ///
    /// # Errors
    ///
    /// Returns [`AppError::InvalidInput`] if the environment variable is not set.
    pub fn resolve_token(&self) -> Result<String, AppError> {
        if self.bot_token_env.is_empty() {
            return Err(AppError::InvalidInput(
                "bot_token_env is not configured".to_owned(),
            ));
        }
        std::env::var(&self.bot_token_env).map_err(|_| {
            AppError::InvalidInput(format!(
                "environment variable '{}' is not set",
                self.bot_token_env
            ))
        })
    }
}

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

    // --- Adapter identity ---

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

    #[test]
    fn discord_adapter_default_impl() {
        let adapter = DiscordChatAdapter::default();
        assert_eq!(adapter.id(), "discord");
    }

    // --- Adapter lifecycle ---

    #[tokio::test]
    async fn discord_adapter_start_sets_running_and_returns_handle() {
        // Given: a fresh adapter
        let adapter = DiscordChatAdapter::new();
        assert!(!adapter.is_running());

        // When: start_listener is called
        let start_result = adapter.start_listener().await;

        // Then: the adapter reports running and the call succeeds
        assert!(start_result.is_ok());
        assert!(adapter.is_running());

        // Cleanup
        adapter.stop_listener().await.ok();
    }

    #[tokio::test]
    async fn discord_adapter_stop_clears_running_state() {
        // Given: a running adapter
        let adapter = DiscordChatAdapter::new();
        adapter.start_listener().await.ok();
        assert!(adapter.is_running());

        // When: stop_listener is called
        let stop_result = adapter.stop_listener().await;

        // Then: the adapter reports not running and the call succeeds
        assert!(stop_result.is_ok());
        assert!(!adapter.is_running());
    }

    // --- send_message (not yet implemented) ---

    #[tokio::test]
    async fn discord_adapter_send_message_not_yet_implemented() {
        let adapter = DiscordChatAdapter::new();
        let result = adapter.send_message("channel-1", "hello").await;
        assert!(result.is_err());
        let Err(err) = result else {
            panic!("should be error")
        };
        assert!(err.to_string().contains("send_message not yet implemented"));
    }

    // --- DiscordConfig ---

    #[test]
    fn discord_config_serializes_with_all_fields() {
        let config = DiscordConfig {
            bot_token_env: "DISCORD_BOT_TOKEN".to_owned(),
            notification_channel_id: Some("123456".to_owned()),
        };
        let json = serde_json::to_string(&config)
            .unwrap_or_else(|e| panic!("serialize should succeed: {e}"));
        assert!(json.contains("bot_token_env"));
        assert!(json.contains("DISCORD_BOT_TOKEN"));
        assert!(json.contains("notification_channel_id"));
    }

    #[test]
    fn discord_config_deserializes_from_json() {
        let json = r#"{"bot_token_env":"MY_TOKEN","notification_channel_id":"789"}"#;
        let config: DiscordConfig = serde_json::from_str(json)
            .unwrap_or_else(|e| panic!("deserialize should succeed: {e}"));
        assert_eq!(config.bot_token_env, "MY_TOKEN");
        assert_eq!(config.notification_channel_id, Some("789".to_owned()));
    }

    #[test]
    fn discord_config_deserializes_without_optional_channel() {
        let json = r#"{"bot_token_env":"MY_TOKEN"}"#;
        let config: DiscordConfig = serde_json::from_str(json)
            .unwrap_or_else(|e| panic!("deserialize should succeed: {e}"));
        assert_eq!(config.bot_token_env, "MY_TOKEN");
        assert!(config.notification_channel_id.is_none());
    }

    #[test]
    fn discord_config_default_config_returns_empty_values() {
        let default = DiscordConfig::default_config();
        assert_eq!(default["bot_token_env"], "");
        assert!(
            default.get("notification_channel_id").is_none(),
            "optional field should be absent from default"
        );
    }
}
