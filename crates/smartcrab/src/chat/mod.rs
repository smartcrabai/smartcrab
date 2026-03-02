pub mod discord;

use std::sync::{Arc, Mutex};

use async_trait::async_trait;

use crate::error::Result;
use crate::graph::DirectedGraph;

/// Trait for chat platform clients.
#[async_trait]
pub trait ChatClient: Send + Sync + 'static {
    /// Send a message to the specified channel.
    async fn send_message(&self, channel: &str, content: &str) -> Result<()>;
}

/// Trait for chat platform gateway connections (receiving side).
///
/// Connects to a chat platform's real-time event stream and dispatches
/// incoming messages to registered graphs via `run_with_trigger()`.
#[async_trait]
pub trait ChatGateway: Send + Sync + 'static {
    /// Returns the platform identifier (e.g. "discord", "slack").
    fn platform(&self) -> &str;

    /// Run the gateway, blocking until shutdown.
    async fn run(&self, graphs: Vec<Arc<DirectedGraph>>) -> Result<()>;
}

/// Mock implementation of ChatGateway for testing.
pub struct MockChatGateway {
    platform_name: String,
}

impl MockChatGateway {
    pub fn new(platform: impl Into<String>) -> Self {
        Self {
            platform_name: platform.into(),
        }
    }
}

#[async_trait]
impl ChatGateway for MockChatGateway {
    fn platform(&self) -> &str {
        &self.platform_name
    }

    async fn run(&self, graphs: Vec<Arc<DirectedGraph>>) -> Result<()> {
        for graph in &graphs {
            graph.run().await?;
        }
        Ok(())
    }
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
