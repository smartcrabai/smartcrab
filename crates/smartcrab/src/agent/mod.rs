pub mod claudecode;

use async_trait::async_trait;

use crate::error::Result;

/// Trait for AI agent executors.
#[async_trait]
pub trait AgentExecutor: Send + Sync + 'static {
    /// Execute the agent with the given prompt and return the response.
    async fn execute(&self, prompt: &str) -> Result<String>;
}
