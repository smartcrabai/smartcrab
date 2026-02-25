pub mod discord;

use std::sync::{Arc, Mutex};

use async_trait::async_trait;

use crate::error::Result;

/// Trait for chat platform clients.
#[async_trait]
pub trait ChatClient: Send + Sync + 'static {
    /// Send a message to the specified channel.
    async fn send_message(&self, channel: &str, content: &str) -> Result<()>;
}

/// Mock implementation of ChatClient for testing.
pub struct MockChatClient {
    messages: Arc<Mutex<Vec<(String, String)>>>,
}

impl Default for MockChatClient {
    fn default() -> Self {
        Self {
            messages: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl MockChatClient {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns a list of all messages sent via this client as (channel, content) pairs.
    pub fn sent_messages(&self) -> Vec<(String, String)> {
        self.messages.lock().unwrap().clone()
    }
}

#[async_trait]
impl ChatClient for MockChatClient {
    async fn send_message(&self, channel: &str, content: &str) -> Result<()> {
        self.messages
            .lock()
            .unwrap()
            .push((channel.to_string(), content.to_string()));
        Ok(())
    }
}
