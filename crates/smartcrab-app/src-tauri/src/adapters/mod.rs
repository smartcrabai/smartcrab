pub mod chat;
pub mod llm;

use std::collections::HashMap;
use std::sync::Arc;

/// Generic adapter registry — stores adapters by ID.
///
/// Any type that implements a supported adapter trait (`ChatAdapter`,
/// `LlmAdapter`, etc.) can be registered here by its unique string ID.
/// Upper layers look up adapters at runtime, making the system extensible
/// without modifying existing code.
pub struct AdapterRegistry<T: ?Sized> {
    adapters: HashMap<String, Arc<T>>,
}

impl<T: ?Sized> Default for AdapterRegistry<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: ?Sized> AdapterRegistry<T> {
    /// Creates an empty registry.
    #[must_use]
    pub fn new() -> Self {
        Self {
            adapters: HashMap::new(),
        }
    }

    /// Registers an adapter under the given `id`.
    ///
    /// If an adapter with the same ID already exists it is replaced.
    pub fn register(&mut self, id: String, adapter: Arc<T>) {
        self.adapters.insert(id, adapter);
    }

    /// Looks up an adapter by `id`.
    #[must_use]
    pub fn get(&self, id: &str) -> Option<Arc<T>> {
        self.adapters.get(id).cloned()
    }

    /// Returns all registered adapters as `(id, adapter)` pairs.
    #[must_use]
    pub fn list(&self) -> Vec<(String, Arc<T>)> {
        self.adapters
            .iter()
            .map(|(k, v)| (k.clone(), Arc::clone(v)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A minimal trait for testing the generic registry.
    trait DummyAdapter: Send + Sync {
        fn name(&self) -> &str;
    }

    struct TestAdapter {
        label: String,
    }

    impl DummyAdapter for TestAdapter {
        fn name(&self) -> &str {
            &self.label
        }
    }

    fn make_adapter(label: &str) -> Arc<TestAdapter> {
        Arc::new(TestAdapter {
            label: label.to_owned(),
        })
    }

    #[test]
    fn register_and_get() {
        let mut registry = AdapterRegistry::<dyn DummyAdapter>::new();
        registry.register("test".to_owned(), make_adapter("test"));

        let found = registry.get("test");
        assert!(found.is_some());
        assert_eq!(found.map(|a| a.name().to_owned()), Some("test".to_owned()));
    }

    #[test]
    fn get_nonexistent_returns_none() {
        let registry = AdapterRegistry::<dyn DummyAdapter>::new();
        assert!(registry.get("nope").is_none());
    }

    #[test]
    fn list_returns_all() {
        let mut registry = AdapterRegistry::<dyn DummyAdapter>::new();
        registry.register("a".to_owned(), make_adapter("A"));
        registry.register("b".to_owned(), make_adapter("B"));

        let items = registry.list();
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn default_creates_empty_registry() {
        let registry = AdapterRegistry::<dyn DummyAdapter>::default();
        assert!(registry.list().is_empty());
    }

    #[test]
    fn register_same_id_overwrites_previous() {
        let mut registry = AdapterRegistry::<dyn DummyAdapter>::new();
        registry.register("alpha".to_owned(), make_adapter("first"));
        registry.register("alpha".to_owned(), make_adapter("second"));

        assert_eq!(registry.list().len(), 1);
        assert_eq!(
            registry.get("alpha").map(|a| a.name().to_owned()),
            Some("second".to_owned())
        );
    }
}
