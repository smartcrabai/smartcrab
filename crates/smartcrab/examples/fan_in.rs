//! # Fan-In Pattern
//!
//! Multiple independent input sources converge into a single processing node.
//!
//! ```text
//! [ApiSource]  ──→ [Aggregator] → [Dashboard]
//! [DbSource]   ──→
//! ```
//!
//! Run: `cargo run -p smartcrab --example fan_in`

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DataPoint {
    source: String,
    value: f64,
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

struct ApiSource;

impl Layer for ApiSource {
    fn name(&self) -> &str {
        "ApiSource"
    }
}

#[async_trait]
impl InputLayer for ApiSource {
    type TriggerData = ();
    type Output = DataPoint;
    async fn run(&self, _: ()) -> Result<DataPoint> {
        Ok(DataPoint {
            source: "api".into(),
            value: 99.5,
        })
    }
}

struct DbSource;

impl Layer for DbSource {
    fn name(&self) -> &str {
        "DbSource"
    }
}

#[async_trait]
impl InputLayer for DbSource {
    type TriggerData = ();
    type Output = DataPoint;
    async fn run(&self, _: ()) -> Result<DataPoint> {
        Ok(DataPoint {
            source: "database".into(),
            value: 75.0,
        })
    }
}

struct Aggregator;

impl Layer for Aggregator {
    fn name(&self) -> &str {
        "Aggregator"
    }
}

#[async_trait]
impl HiddenLayer for Aggregator {
    type Input = DataPoint;
    type Output = DataPoint;
    async fn run(&self, input: DataPoint) -> Result<DataPoint> {
        println!("📥 Aggregating from {}: {}", input.source, input.value);
        Ok(DataPoint {
            source: format!("aggregated({})", input.source),
            value: input.value,
        })
    }
}

struct Dashboard;

impl Layer for Dashboard {
    fn name(&self) -> &str {
        "Dashboard"
    }
}

#[async_trait]
impl OutputLayer for Dashboard {
    type Input = DataPoint;
    async fn run(&self, input: DataPoint) -> Result<()> {
        println!("📊 Dashboard: {} = {}", input.source, input.value);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let graph = DirectedGraphBuilder::new("fan_in")
        .description("Multiple data sources converge into a single aggregator")
        .trigger(TriggerKind::Startup)
        .add_input(ApiSource)
        .add_input(DbSource)
        .add_hidden(Aggregator)
        .add_output(Dashboard)
        .add_edge("ApiSource", "Aggregator")
        .add_edge("DbSource", "Aggregator")
        .add_edge("Aggregator", "Dashboard")
        .build()
        .expect("failed to build graph");

    graph.run().await.expect("graph execution failed");
}
