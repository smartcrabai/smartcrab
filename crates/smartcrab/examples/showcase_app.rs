//! # Showcase Application
//!
//! Demonstrates running multiple example graphs together as a single
//! application using `Runtime`. Covers Startup / Chat / Cron triggers
//! and a variety of pipeline patterns (linear, conditional branch, diamond).
//!
//! Run: `cargo run -p smartcrab --example showcase_app`

use smartcrab::prelude::*;

// ===========================================================================
// Graph 1: Basic Pipeline (Startup) — linear: Greeter → Formatter → Printer
// ===========================================================================
mod basic_pipeline {
    use async_trait::async_trait;
    use serde::{Deserialize, Serialize};
    use smartcrab::prelude::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct Greeting {
        message: String,
    }

    pub struct Greeter;
    impl Layer for Greeter {
        fn name(&self) -> &str {
            "Greeter"
        }
    }
    #[async_trait]
    impl InputLayer for Greeter {
        type TriggerData = ();
        type Output = Greeting;
        async fn run(&self, _: ()) -> Result<Greeting> {
            Ok(Greeting {
                message: "Hello, SmartCrab!".into(),
            })
        }
    }

    pub struct Formatter;
    impl Layer for Formatter {
        fn name(&self) -> &str {
            "Formatter"
        }
    }
    #[async_trait]
    impl HiddenLayer for Formatter {
        type Input = Greeting;
        type Output = Greeting;
        async fn run(&self, input: Greeting) -> Result<Greeting> {
            Ok(Greeting {
                message: format!("✨ {} ✨", input.message),
            })
        }
    }

    pub struct Printer;
    impl Layer for Printer {
        fn name(&self) -> &str {
            "Printer"
        }
    }
    #[async_trait]
    impl OutputLayer for Printer {
        type Input = Greeting;
        async fn run(&self, input: Greeting) -> Result<()> {
            println!("{}", input.message);
            Ok(())
        }
    }

    pub fn build() -> std::result::Result<DirectedGraph, GraphError> {
        DirectedGraphBuilder::new("basic_pipeline")
            .description("Linear pipeline: Greeter → Formatter → Printer")
            .trigger(TriggerKind::Startup)
            .add_input(Greeter)
            .add_hidden(Formatter)
            .add_output(Printer)
            .add_edge("Greeter", "Formatter")
            .add_edge("Formatter", "Printer")
            .build()
    }
}

// ===========================================================================
// Graph 2: Conditional Branch (Startup) — Sensor → Classifier → branches
// ===========================================================================
mod conditional_branch {
    use async_trait::async_trait;
    use serde::{Deserialize, Serialize};
    use smartcrab::prelude::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct SensorData {
        temperature: f64,
        label: String,
    }

    pub struct Sensor;
    impl Layer for Sensor {
        fn name(&self) -> &str {
            "Sensor"
        }
    }
    #[async_trait]
    impl InputLayer for Sensor {
        type TriggerData = ();
        type Output = SensorData;
        async fn run(&self, _: ()) -> Result<SensorData> {
            Ok(SensorData {
                temperature: -5.0,
                label: String::new(),
            })
        }
    }

    pub struct Classifier;
    impl Layer for Classifier {
        fn name(&self) -> &str {
            "Classifier"
        }
    }
    #[async_trait]
    impl HiddenLayer for Classifier {
        type Input = SensorData;
        type Output = SensorData;
        async fn run(&self, mut input: SensorData) -> Result<SensorData> {
            input.label = if input.temperature >= 0.0 {
                "positive".into()
            } else {
                "negative".into()
            };
            Ok(input)
        }
    }

    pub struct Celebrate;
    impl Layer for Celebrate {
        fn name(&self) -> &str {
            "Celebrate"
        }
    }
    #[async_trait]
    impl OutputLayer for Celebrate {
        type Input = SensorData;
        async fn run(&self, input: SensorData) -> Result<()> {
            println!("🎉 Temperature is positive: {}°C", input.temperature);
            Ok(())
        }
    }

    pub struct Alert;
    impl Layer for Alert {
        fn name(&self) -> &str {
            "Alert"
        }
    }
    #[async_trait]
    impl HiddenLayer for Alert {
        type Input = SensorData;
        type Output = SensorData;
        async fn run(&self, input: SensorData) -> Result<SensorData> {
            println!("⚠️  Temperature is negative: {}°C", input.temperature);
            Ok(input)
        }
    }

    pub struct Logger;
    impl Layer for Logger {
        fn name(&self) -> &str {
            "Logger"
        }
    }
    #[async_trait]
    impl OutputLayer for Logger {
        type Input = SensorData;
        async fn run(&self, input: SensorData) -> Result<()> {
            println!(
                "📝 Logged: temp={}, label={}",
                input.temperature, input.label
            );
            Ok(())
        }
    }

    pub fn build() -> std::result::Result<DirectedGraph, GraphError> {
        DirectedGraphBuilder::new("conditional_branch")
            .description("Routes sensor data based on temperature classification")
            .trigger(TriggerKind::Startup)
            .add_input(Sensor)
            .add_hidden(Classifier)
            .add_output(Celebrate)
            .add_hidden(Alert)
            .add_output(Logger)
            .add_edge("Sensor", "Classifier")
            .add_conditional_edge(
                "Classifier",
                |dto| {
                    let data: &SensorData = dto.as_any().downcast_ref()?;
                    Some(data.label.clone())
                },
                vec![
                    ("positive".to_owned(), "Celebrate".to_owned()),
                    ("negative".to_owned(), "Alert".to_owned()),
                ],
            )
            .add_edge("Alert", "Logger")
            .build()
    }
}

// ===========================================================================
// Graph 3: Diamond (Startup) — fan-out + fan-in
// ===========================================================================
mod diamond {
    use async_trait::async_trait;
    use serde::{Deserialize, Serialize};
    use smartcrab::prelude::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct Text {
        content: String,
    }

    pub struct TextInput;
    impl Layer for TextInput {
        fn name(&self) -> &str {
            "TextInput"
        }
    }
    #[async_trait]
    impl InputLayer for TextInput {
        type TriggerData = ();
        type Output = Text;
        async fn run(&self, _: ()) -> Result<Text> {
            Ok(Text {
                content: "SmartCrab".into(),
            })
        }
    }

    pub struct UpperCase;
    impl Layer for UpperCase {
        fn name(&self) -> &str {
            "UpperCase"
        }
    }
    #[async_trait]
    impl HiddenLayer for UpperCase {
        type Input = Text;
        type Output = Text;
        async fn run(&self, input: Text) -> Result<Text> {
            Ok(Text {
                content: input.content.to_uppercase(),
            })
        }
    }

    pub struct Reverse;
    impl Layer for Reverse {
        fn name(&self) -> &str {
            "Reverse"
        }
    }
    #[async_trait]
    impl HiddenLayer for Reverse {
        type Input = Text;
        type Output = Text;
        async fn run(&self, input: Text) -> Result<Text> {
            Ok(Text {
                content: input.content.chars().rev().collect(),
            })
        }
    }

    pub struct Merger;
    impl Layer for Merger {
        fn name(&self) -> &str {
            "Merger"
        }
    }
    #[async_trait]
    impl HiddenLayer for Merger {
        type Input = Text;
        type Output = Text;
        async fn run(&self, input: Text) -> Result<Text> {
            println!("🔀 Merging: {}", input.content);
            Ok(input)
        }
    }

    pub struct Display;
    impl Layer for Display {
        fn name(&self) -> &str {
            "Display"
        }
    }
    #[async_trait]
    impl OutputLayer for Display {
        type Input = Text;
        async fn run(&self, input: Text) -> Result<()> {
            println!("📄 Result: {}", input.content);
            Ok(())
        }
    }

    pub fn build() -> std::result::Result<DirectedGraph, GraphError> {
        DirectedGraphBuilder::new("diamond")
            .description("Diamond-shaped graph with parallel processing paths")
            .trigger(TriggerKind::Startup)
            .add_input(TextInput)
            .add_hidden(UpperCase)
            .add_hidden(Reverse)
            .add_hidden(Merger)
            .add_output(Display)
            .add_edge("TextInput", "UpperCase")
            .add_edge("TextInput", "Reverse")
            .add_edge("UpperCase", "Merger")
            .add_edge("Reverse", "Merger")
            .add_edge("Merger", "Display")
            .build()
    }
}

// ===========================================================================
// Graph 4: Chat Trigger — MessageInput → AgentProcessor → MessageOutput
// ===========================================================================
mod chat_pipeline {
    use async_trait::async_trait;
    use serde::{Deserialize, Serialize};
    use smartcrab::chat::ChatClient;
    use smartcrab::chat::discord::{DiscordClient, DiscordMessage};
    use smartcrab::prelude::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ChatReply {
        channel: String,
        content: String,
    }

    pub struct MessageInput;
    impl Layer for MessageInput {
        fn name(&self) -> &str {
            "MessageInput"
        }
    }
    #[async_trait]
    impl InputLayer for MessageInput {
        type TriggerData = DiscordMessage;
        type Output = DiscordMessage;
        async fn run(&self, msg: DiscordMessage) -> Result<DiscordMessage> {
            println!("💬 Received message from {}: {}", msg.author, msg.content);
            Ok(msg)
        }
    }

    pub struct AgentProcessor;
    impl Layer for AgentProcessor {
        fn name(&self) -> &str {
            "AgentProcessor"
        }
    }
    #[async_trait]
    impl HiddenLayer for AgentProcessor {
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

    pub struct MessageOutput {
        pub client: Option<DiscordClient>,
    }
    impl Layer for MessageOutput {
        fn name(&self) -> &str {
            "MessageOutput"
        }
    }
    #[async_trait]
    impl OutputLayer for MessageOutput {
        type Input = ChatReply;
        async fn run(&self, input: ChatReply) -> Result<()> {
            println!("📤 #{}: {}", input.channel, input.content);
            if let Some(client) = &self.client {
                client.send_message(&input.channel, &input.content).await?;
            }
            Ok(())
        }
    }

    pub fn build() -> std::result::Result<DirectedGraph, GraphError> {
        let client = std::env::var("DISCORD_TOKEN").ok().map(DiscordClient::new);
        DirectedGraphBuilder::new("chat_pipeline")
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
    }
}

// ===========================================================================
// Graph 5: Cron Trigger — ScheduledPoller → ReportBuilder → NotificationSender
// ===========================================================================
mod cron_pipeline {
    use async_trait::async_trait;
    use serde::{Deserialize, Serialize};
    use smartcrab::prelude::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct Snapshot {
        timestamp_secs: u64,
        metric: String,
        value: f64,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct Report {
        summary: String,
    }

    pub struct ScheduledPoller;
    impl Layer for ScheduledPoller {
        fn name(&self) -> &str {
            "ScheduledPoller"
        }
    }
    #[async_trait]
    impl InputLayer for ScheduledPoller {
        type TriggerData = ();
        type Output = Snapshot;
        async fn run(&self, _: ()) -> Result<Snapshot> {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            println!("⏰ Cron fired at t={now}");
            Ok(Snapshot {
                timestamp_secs: now,
                metric: "cpu_usage".into(),
                value: 42.7,
            })
        }
    }

    pub struct ReportBuilder;
    impl Layer for ReportBuilder {
        fn name(&self) -> &str {
            "ReportBuilder"
        }
    }
    #[async_trait]
    impl HiddenLayer for ReportBuilder {
        type Input = Snapshot;
        type Output = Report;
        async fn run(&self, input: Snapshot) -> Result<Report> {
            println!("📊 Building report for metric={}", input.metric);
            Ok(Report {
                summary: format!(
                    "[t={}] {}: {:.1}",
                    input.timestamp_secs, input.metric, input.value
                ),
            })
        }
    }

    pub struct NotificationSender;
    impl Layer for NotificationSender {
        fn name(&self) -> &str {
            "NotificationSender"
        }
    }
    #[async_trait]
    impl OutputLayer for NotificationSender {
        type Input = Report;
        async fn run(&self, input: Report) -> Result<()> {
            println!("📢 Sending notification: {}", input.summary);
            Ok(())
        }
    }

    pub fn build() -> std::result::Result<DirectedGraph, GraphError> {
        DirectedGraphBuilder::new("cron_pipeline")
            .description("Cron-triggered pipeline: poll → build report → notify")
            .trigger(TriggerKind::Cron {
                schedule: "0 * * * * * *".into(),
            })
            .add_input(ScheduledPoller)
            .add_hidden(ReportBuilder)
            .add_output(NotificationSender)
            .add_edge("ScheduledPoller", "ReportBuilder")
            .add_edge("ReportBuilder", "NotificationSender")
            .build()
    }
}

// ===========================================================================
// Main — bundle all graphs into a single Runtime
// ===========================================================================

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    println!("🦀 SmartCrab Showcase App");
    println!("=========================");
    println!("Running 5 graphs concurrently:");
    println!("  1. basic_pipeline    (Startup) — linear pipeline");
    println!("  2. conditional_branch (Startup) — conditional routing");
    println!("  3. diamond           (Startup) — fan-out + fan-in");
    println!("  4. chat_pipeline     (Chat)    — chat trigger");
    println!("  5. cron_pipeline     (Cron)    — cron trigger");
    println!();

    let runtime = Runtime::new()
        .add_graph(basic_pipeline::build().expect("failed to build basic_pipeline"))
        .add_graph(conditional_branch::build().expect("failed to build conditional_branch"))
        .add_graph(diamond::build().expect("failed to build diamond"))
        .add_graph(chat_pipeline::build().expect("failed to build chat_pipeline"))
        .add_graph(cron_pipeline::build().expect("failed to build cron_pipeline"));

    // Note: runtime.run() blocks indefinitely here because cron_pipeline runs
    // on a recurring schedule. In practice this line only returns on a
    // shutdown signal (SIGINT / SIGTERM). The success message below is
    // therefore only reached if the runtime is shut down gracefully.
    runtime.run().await.expect("runtime execution failed");

    println!();
    println!("✅ All graphs completed successfully!");
}
