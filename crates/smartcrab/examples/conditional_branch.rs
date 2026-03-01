//! # Conditional Branching
//!
//! A graph that routes data through different paths based on a condition.
//!
//! ```text
//!                  ┌──"positive"──→ [Celebrate]
//! [Sensor] → [Classifier] ──"negative"──→ [Alert] → [Logger]
//! ```
//!
//! Run: `cargo run -p smartcrab --example conditional_branch`

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SensorData {
    temperature: f64,
    label: String,
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

struct Sensor;

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

struct Classifier;

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

struct Celebrate;

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

struct Alert;

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

struct Logger;

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let graph = DirectedGraphBuilder::new("conditional_branch")
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
        .expect("failed to build graph");

    graph.run().await.expect("graph execution failed");
}
