//! # Diamond Pattern
//!
//! A diamond-shaped dependency graph where an input splits into two parallel
//! hidden layers, then converges into a merge point before the output.
//!
//! ```text
//!              ┌→ [UpperCase] ─┐
//! [TextInput] ─┤               ├→ [Merger] → [Display]
//!              └→ [Reverse]   ─┘
//! ```
//!
//! Run: `cargo run -p smartcrab --example diamond`

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Text {
    content: String,
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

struct TextInput;

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

struct UpperCase;

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

struct Reverse;

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

struct Merger;

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

struct Display;

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let graph = DirectedGraphBuilder::new("diamond")
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
        .expect("failed to build graph");

    graph.run().await.expect("graph execution failed");
}
