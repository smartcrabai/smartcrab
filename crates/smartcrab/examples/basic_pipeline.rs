//! # Basic Pipeline
//!
//! The simplest DirectedGraph: Input → Hidden → Output.
//!
//! ```text
//! [Greeter] → [Formatter] → [Printer]
//! ```
//!
//! Run: `cargo run -p smartcrab --example basic_pipeline`

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Greeting {
    message: String,
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

struct Greeter;

impl Node for Greeter {
    fn name(&self) -> &str {
        "Greeter"
    }
}

#[async_trait]
impl InputNode for Greeter {
    type TriggerData = ();
    type Output = Greeting;
    async fn run(&self, _: ()) -> Result<Greeting> {
        Ok(Greeting {
            message: "Hello, SmartCrab!".into(),
        })
    }
}

struct Formatter;

impl Node for Formatter {
    fn name(&self) -> &str {
        "Formatter"
    }
}

#[async_trait]
impl HiddenNode for Formatter {
    type Input = Greeting;
    type Output = Greeting;
    async fn run(&self, input: Greeting) -> Result<Greeting> {
        Ok(Greeting {
            message: format!("✨ {} ✨", input.message),
        })
    }
}

struct Printer;

impl Node for Printer {
    fn name(&self) -> &str {
        "Printer"
    }
}

#[async_trait]
impl OutputNode for Printer {
    type Input = Greeting;
    async fn run(&self, input: Greeting) -> Result<()> {
        println!("{}", input.message);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let graph = DirectedGraphBuilder::new("basic_pipeline")
        .description("A simple linear pipeline: Greeter → Formatter → Printer")
        .trigger(TriggerKind::Startup)
        .add_input(Greeter)
        .add_hidden(Formatter)
        .add_output(Printer)
        .add_edge("Greeter", "Formatter")
        .add_edge("Formatter", "Printer")
        .build()
        .expect("failed to build graph");

    graph.run().await.expect("graph execution failed");
}
