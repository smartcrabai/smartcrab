//! # Multi-Transform Pipeline
//!
//! A pipeline with multiple hidden layers chained together.
//!
//! ```text
//! [DataSource] → [Normalizer] → [Enricher] → [Scorer] → [Reporter]
//! ```
//!
//! Run: `cargo run -p smartcrab --example multi_transform`

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Record {
    name: String,
    value: f64,
    tags: Vec<String>,
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

struct DataSource;

impl Layer for DataSource {
    fn name(&self) -> &str {
        "DataSource"
    }
}

#[async_trait]
impl InputLayer for DataSource {
    type TriggerData = ();
    type Output = Record;
    async fn run(&self, _: ()) -> Result<Record> {
        Ok(Record {
            name: "  Sample Record  ".into(),
            value: 42.5,
            tags: vec![],
        })
    }
}

struct Normalizer;

impl Layer for Normalizer {
    fn name(&self) -> &str {
        "Normalizer"
    }
}

#[async_trait]
impl HiddenLayer for Normalizer {
    type Input = Record;
    type Output = Record;
    async fn run(&self, mut input: Record) -> Result<Record> {
        input.name = input.name.trim().to_lowercase();
        Ok(input)
    }
}

struct Enricher;

impl Layer for Enricher {
    fn name(&self) -> &str {
        "Enricher"
    }
}

#[async_trait]
impl HiddenLayer for Enricher {
    type Input = Record;
    type Output = Record;
    async fn run(&self, mut input: Record) -> Result<Record> {
        input.tags.push("enriched".into());
        input.tags.push("v2".into());
        Ok(input)
    }
}

struct Scorer;

impl Layer for Scorer {
    fn name(&self) -> &str {
        "Scorer"
    }
}

#[async_trait]
impl HiddenLayer for Scorer {
    type Input = Record;
    type Output = Record;
    async fn run(&self, mut input: Record) -> Result<Record> {
        input.value = (input.value * 2.0).round();
        input.tags.push("scored".into());
        Ok(input)
    }
}

struct Reporter;

impl Layer for Reporter {
    fn name(&self) -> &str {
        "Reporter"
    }
}

#[async_trait]
impl OutputLayer for Reporter {
    type Input = Record;
    async fn run(&self, input: Record) -> Result<()> {
        println!(
            "Report: name={}, value={}, tags={:?}",
            input.name, input.value, input.tags
        );
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let graph = DirectedGraphBuilder::new("multi_transform")
        .description("Multi-stage data transformation pipeline")
        .trigger(TriggerKind::Startup)
        .add_input(DataSource)
        .add_hidden(Normalizer)
        .add_hidden(Enricher)
        .add_hidden(Scorer)
        .add_output(Reporter)
        .add_edge("DataSource", "Normalizer")
        .add_edge("Normalizer", "Enricher")
        .add_edge("Enricher", "Scorer")
        .add_edge("Scorer", "Reporter")
        .build()
        .expect("failed to build graph");

    graph.run().await.expect("graph execution failed");
}
