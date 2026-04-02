use super::ChatAdapter;
use crate::adapters::AdapterRegistry;

/// Runtime status of a single chat adapter.
#[derive(Debug, Clone)]
pub struct AdapterRuntimeStatus {
    pub is_running: bool,
}

/// Managed state holding the chat adapter registry.
///
/// Inserted via `app.manage(...)` so Tauri commands can access it.
pub struct ChatRuntimeState {
    registry: AdapterRegistry<dyn ChatAdapter>,
}

impl ChatRuntimeState {
    /// Create a new runtime state wrapping the given registry.
    #[must_use]
    pub fn new(registry: AdapterRegistry<dyn ChatAdapter>) -> Self {
        Self { registry }
    }

    /// Get the runtime status of an adapter.
    ///
    /// Delegates `is_running` to the adapter itself (source of truth).
    #[must_use]
    pub fn get_status(&self, adapter_type: &str) -> Option<AdapterRuntimeStatus> {
        let adapter = self.registry.get(adapter_type)?;
        Some(AdapterRuntimeStatus {
            is_running: adapter.is_running(),
        })
    }

    /// Returns all registered adapters as `(id, name)` pairs.
    #[must_use]
    pub fn registered_adapters(&self) -> Vec<(String, String)> {
        self.registry
            .list()
            .into_iter()
            .map(|(id, adapter)| (id, adapter.name().to_owned()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::chat::discord::DiscordChatAdapter;
    use crate::default_chat_registry;
    use std::sync::Arc;

    fn test_runtime() -> ChatRuntimeState {
        let registry = default_chat_registry();
        ChatRuntimeState::new(registry)
    }

    #[test]
    fn new_runtime_initializes_with_all_registered_adapters_stopped() {
        let runtime = test_runtime();
        let status = runtime.get_status("discord");
        assert!(status.is_some());
        let status = status.unwrap_or_else(|| panic!("status should exist"));
        assert!(!status.is_running);
    }

    #[test]
    fn get_status_returns_none_for_unknown_adapter() {
        let runtime = test_runtime();
        assert!(runtime.get_status("slack").is_none());
    }

    #[test]
    fn new_runtime_from_empty_registry_has_no_adapters() {
        let registry = AdapterRegistry::<dyn ChatAdapter>::new();
        let runtime = ChatRuntimeState::new(registry);
        assert!(runtime.get_status("discord").is_none());
    }

    #[test]
    fn runtime_with_multiple_adapters_tracks_all() {
        let mut registry = default_chat_registry();
        let extra: Arc<dyn ChatAdapter> = Arc::new(DiscordChatAdapter::new());
        registry.register("extra".to_owned(), extra);
        let runtime = ChatRuntimeState::new(registry);

        assert!(runtime.get_status("discord").is_some());
        assert!(runtime.get_status("extra").is_some());
    }
}
