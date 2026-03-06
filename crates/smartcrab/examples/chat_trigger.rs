//! # Chat Trigger
//!
//! A pipeline triggered by a real Discord event (mention or DM).
//! The graph is registered with `Runtime`, which spins up a Poise/serenity
//! bot that dispatches incoming messages to the graph.
//!
//! ```text
//! [MessageInput] → [AgentProcessor] → [MessageOutput]
//! ```
//!
//! Requires `DISCORD_TOKEN` environment variable.
//!
//! Run: `DISCORD_TOKEN=<token> cargo run -p smartcrab --example chat_trigger`

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::chat::ChatClient;
use smartcrab::chat::discord::{DiscordClient, DiscordMessage};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatReply {
    channel: String,
    content: String,
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

struct MessageInput;

impl Node for MessageInput {
    fn name(&self) -> &str {
        "MessageInput"
    }
}

#[async_trait]
impl InputNode for MessageInput {
    type TriggerData = DiscordMessage;
    type Output = DiscordMessage;
    async fn run(&self, msg: DiscordMessage) -> Result<DiscordMessage> {
        println!("💬 Received message from {}: {}", msg.author, msg.content);
        Ok(msg)
    }
}

struct AgentProcessor;

impl Node for AgentProcessor {
    fn name(&self) -> &str {
        "AgentProcessor"
    }
}

#[async_trait]
impl HiddenNode for AgentProcessor {
    type Input = DiscordMessage;
    type Output = ChatReply;
    async fn run(&self, input: DiscordMessage) -> Result<ChatReply> {
        println!("🤖 Processing: {}", input.content);
        Ok(ChatReply {
            channel: input.channel_id.clone(),
            content: format!(
                "Hi {}! SmartCrab is a workflow orchestration engine.",
                input.author
            ),
        })
    }
}

struct MessageOutput {
    client: DiscordClient,
}

impl Node for MessageOutput {
    fn name(&self) -> &str {
        "MessageOutput"
    }
}

#[async_trait]
impl OutputNode for MessageOutput {
    type Input = ChatReply;
    async fn run(&self, input: ChatReply) -> Result<()> {
        println!("📤 #{}: {}", input.channel, input.content);
        self.client
            .send_message(&input.channel, &input.content)
            .await?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let token = std::env::var("DISCORD_TOKEN").expect("DISCORD_TOKEN is not set");
    let client = DiscordClient::new(&token);

    let graph = DirectedGraphBuilder::new("chat_pipeline")
        .description("Chat-triggered pipeline: receive → process → reply")
        .trigger(TriggerKind::discord(
            vec!["mention".into(), "dm".into()],
            None,
        ))
        .add_input(MessageInput)
        .add_hidden(AgentProcessor)
        .add_output(MessageOutput { client })
        .add_edge("MessageInput", "AgentProcessor")
        .add_edge("AgentProcessor", "MessageOutput")
        .build()
        .expect("failed to build graph");

    println!("🤖 Starting Discord bot (mention or DM to trigger)");
    println!("   Press Ctrl-C to stop");

    Runtime::new()
        .add_graph(graph)
        .run()
        .await
        .expect("runtime failed");
}
