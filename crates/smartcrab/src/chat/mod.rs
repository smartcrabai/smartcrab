pub mod discord;

use async_trait::async_trait;

use crate::error::Result;

/// Trait for chat platform clients.
#[async_trait]
pub trait ChatClient: Send + Sync + 'static {
    /// Send a message to the specified channel.
    async fn send_message(&self, channel: &str, content: &str) -> Result<()>;
}
