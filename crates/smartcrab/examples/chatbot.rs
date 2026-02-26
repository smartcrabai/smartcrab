//! # Chatbot Pattern
//!
//! Simulates a chatbot pipeline where a message is received, processed by an
//! AI agent, and the response is sent back.
//!
//! ```text
//! [MessageReceiver] → [AgentProcessor] → [ResponseSender]
//! ```
//!
//! Run: `cargo run -p smartcrab --example chatbot`

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatMessage {
    channel: String,
    author: String,
    content: String,
    response: Option<String>,
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

struct MessageReceiver;

impl Layer for MessageReceiver {
    fn name(&self) -> &str {
        "MessageReceiver"
    }
}

#[async_trait]
impl InputLayer for MessageReceiver {
    type Output = ChatMessage;
    async fn run(&self) -> Result<ChatMessage> {
        println!("💬 Received message from user");
        Ok(ChatMessage {
            channel: "general".into(),
            author: "alice".into(),
            content: "What is SmartCrab?".into(),
            response: None,
        })
    }
}

struct AgentProcessor;

impl Layer for AgentProcessor {
    fn name(&self) -> &str {
        "AgentProcessor"
    }
}

#[async_trait]
impl HiddenLayer for AgentProcessor {
    type Input = ChatMessage;
    type Output = ChatMessage;
    async fn run(&self, mut input: ChatMessage) -> Result<ChatMessage> {
        // In a real application, this would call ClaudeCode or another AI agent
        println!("🤖 Processing message: {}", input.content);
        input.response = Some(format!(
            "SmartCrab is a workflow orchestration engine! (asked by {})",
            input.author
        ));
        Ok(input)
    }
}

struct ResponseSender;

impl Layer for ResponseSender {
    fn name(&self) -> &str {
        "ResponseSender"
    }
}

#[async_trait]
impl OutputLayer for ResponseSender {
    type Input = ChatMessage;
    async fn run(&self, input: ChatMessage) -> Result<()> {
        // In a real application, this would use DiscordClient to send the message
        println!(
            "📤 Sending to #{}: {}",
            input.channel,
            input.response.unwrap_or_default()
        );
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let graph = DirectedGraphBuilder::new("chatbot")
        .description("AI chatbot pipeline: receive → process → respond")
        .add_input(MessageReceiver)
        .add_hidden(AgentProcessor)
        .add_output(ResponseSender)
        .add_edge("MessageReceiver", "AgentProcessor")
        .add_edge("AgentProcessor", "ResponseSender")
        .build()
        .expect("failed to build graph");

    graph.run().await.expect("graph execution failed");
}
