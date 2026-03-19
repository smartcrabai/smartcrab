//! # Fan-Out Pattern
//!
//! A single input fans out to multiple independent output nodes.
//!
//! ```text
//!              +-> [ConsoleOutput]
//! [EventSource] -> [FileOutput]
//!              +-> [MetricsOutput]
//! ```
//!
//! Run: `cargo run -p smartcrab --example fan_out`

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Event {
    kind: String,
    payload: String,
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

struct EventSource;

impl Node for EventSource {
    fn name(&self) -> &str {
        "EventSource"
    }
}

#[async_trait]
impl InputNode for EventSource {
    type TriggerData = ();
    type Output = Event;
    async fn run(&self, _: ()) -> Result<Event> {
        Ok(Event {
            kind: "user.signup".into(),
            payload: r#"{"user":"alice"}"#.into(),
        })
    }
}

struct ConsoleOutput;

impl Node for ConsoleOutput {
    fn name(&self) -> &str {
        "ConsoleOutput"
    }
}

#[async_trait]
impl OutputNode for ConsoleOutput {
    type Input = Event;
    async fn run(&self, input: Event) -> Result<()> {
        println!("[console] Console: [{}] {}", input.kind, input.payload);
        Ok(())
    }
}

struct FileOutput;

impl Node for FileOutput {
    fn name(&self) -> &str {
        "FileOutput"
    }
}

#[async_trait]
impl OutputNode for FileOutput {
    type Input = Event;
    async fn run(&self, input: Event) -> Result<()> {
        println!("[file] File: would write {} to events.log", input.kind);
        Ok(())
    }
}

struct MetricsOutput;

impl Node for MetricsOutput {
    fn name(&self) -> &str {
        "MetricsOutput"
    }
}

#[async_trait]
impl OutputNode for MetricsOutput {
    type Input = Event;
    async fn run(&self, input: Event) -> Result<()> {
        println!("[metrics] Metrics: recorded event type={}", input.kind);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let graph = DirectedGraphBuilder::new("fan_out")
        .description("Single event source fans out to multiple outputs")
        .trigger(TriggerKind::Startup)
        .add_input(EventSource)
        .add_output(ConsoleOutput)
        .add_output(FileOutput)
        .add_output(MetricsOutput)
        .add_edge("EventSource", "ConsoleOutput")
        .add_edge("EventSource", "FileOutput")
        .add_edge("EventSource", "MetricsOutput")
        .build()
        .expect("failed to build graph");

    graph.run().await.expect("graph execution failed");
}
