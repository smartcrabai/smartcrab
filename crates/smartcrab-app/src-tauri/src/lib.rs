pub mod adapters;
pub mod error;

use crate::adapters::AdapterRegistry;
use crate::adapters::chat::ChatAdapter;
use crate::adapters::chat::discord::DiscordChatAdapter;
use crate::adapters::llm::LlmAdapter;
use crate::adapters::llm::claude::ClaudeLlmAdapter;

use std::sync::Arc;

/// Builds the default chat adapter registry with all built-in adapters.
#[must_use]
pub fn default_chat_registry() -> AdapterRegistry<dyn ChatAdapter> {
    let mut registry: AdapterRegistry<dyn ChatAdapter> = AdapterRegistry::new();
    let adapter: Arc<dyn ChatAdapter> = Arc::new(DiscordChatAdapter::new());
    registry.register("discord".to_owned(), adapter);
    registry
}

/// Builds the default LLM adapter registry with all built-in adapters.
#[must_use]
pub fn default_llm_registry() -> AdapterRegistry<dyn LlmAdapter> {
    let mut registry: AdapterRegistry<dyn LlmAdapter> = AdapterRegistry::new();
    let adapter: Arc<dyn LlmAdapter> = Arc::new(ClaudeLlmAdapter::new());
    registry.register("claude".to_owned(), adapter);
    registry
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_chat_registry_contains_discord() {
        let registry = default_chat_registry();
        let discord = registry.get("discord");
        assert!(discord.is_some());
        assert_eq!(
            discord.map(|a| a.id().to_owned()),
            Some("discord".to_owned())
        );
    }

    #[test]
    fn default_llm_registry_contains_claude() {
        let registry = default_llm_registry();
        let claude = registry.get("claude");
        assert!(claude.is_some());
        assert_eq!(claude.map(|a| a.id().to_owned()), Some("claude".to_owned()));
    }

    /// Demonstrates that adding a new adapter requires only implementing
    /// the trait and registering it — no changes to existing code.
    #[test]
    fn extensibility_new_adapter_via_trait_impl() {
        use async_trait::async_trait;

        use crate::adapters::chat::{ChatAdapter, ChatCapabilities};
        use crate::error::AppError;

        struct SlackAdapter;

        #[async_trait]
        impl ChatAdapter for SlackAdapter {
            fn id(&self) -> &'static str {
                "slack"
            }
            fn name(&self) -> &'static str {
                "Slack"
            }
            fn capabilities(&self) -> &ChatCapabilities {
                &ChatCapabilities {
                    threads: true,
                    reactions: true,
                    file_upload: true,
                    streaming: false,
                    direct_message: true,
                    group_message: true,
                }
            }
            async fn send_message(&self, _: &str, _: &str) -> Result<(), AppError> {
                Ok(())
            }
            async fn start_listener(&self) -> Result<(), AppError> {
                Ok(())
            }
            async fn stop_listener(&self) -> Result<(), AppError> {
                Ok(())
            }
            fn is_running(&self) -> bool {
                false
            }
        }

        let mut registry = default_chat_registry();
        let slack_adapter: Arc<dyn ChatAdapter> = Arc::new(SlackAdapter);
        registry.register("slack".to_owned(), slack_adapter);

        assert_eq!(registry.list().len(), 2);
        assert!(registry.get("slack").is_some());
        assert!(registry.get("discord").is_some());
    }
}
