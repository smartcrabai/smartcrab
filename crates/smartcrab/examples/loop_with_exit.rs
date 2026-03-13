//! # Loop with Exit Condition
//!
//! A graph with a self-loop that keeps executing until an exit condition is met.
//!
//! ```text
//! [Seed] → [Accumulator] ──(loop)──→ [Accumulator]
//!                │
//!             (exit when sum ≥ 10)
//! ```
//!
//! Run: `cargo run -p smartcrab --example loop_with_exit`

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Counter {
    value: u32,
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

struct Seed;

impl Node for Seed {
    fn name(&self) -> &'static str {
        "Seed"
    }
}

#[async_trait]
impl InputNode for Seed {
    type TriggerData = ();
    type Output = Counter;
    async fn run(&self, _: ()) -> Result<Counter> {
        println!("🌱 Seeding with value=1");
        Ok(Counter { value: 1 })
    }
}

struct Accumulator {
    iteration: Arc<AtomicU32>,
}

impl Node for Accumulator {
    fn name(&self) -> &'static str {
        "Accumulator"
    }
}

#[async_trait]
impl HiddenNode for Accumulator {
    type Input = Counter;
    type Output = Counter;
    async fn run(&self, input: Counter) -> Result<Counter> {
        let iter = self.iteration.fetch_add(1, Ordering::SeqCst) + 1;
        let new_value = input.value + iter;
        println!(
            "🔄 Iteration {iter}: {} + {iter} = {new_value}",
            input.value
        );
        Ok(Counter { value: new_value })
    }
}

struct ResultPrinter;

impl Node for ResultPrinter {
    fn name(&self) -> &'static str {
        "ResultPrinter"
    }
}

#[async_trait]
impl OutputNode for ResultPrinter {
    type Input = Counter;
    async fn run(&self, input: Counter) -> Result<()> {
        println!("✅ Final value: {}", input.value);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let graph = DirectedGraphBuilder::new("loop_with_exit")
        .description("Accumulates values in a loop until threshold is reached")
        .trigger(TriggerKind::Startup)
        .add_input(Seed)
        .add_hidden(Accumulator {
            iteration: Arc::new(AtomicU32::new(0)),
        })
        .add_output(ResultPrinter)
        .add_edge("Seed", "Accumulator")
        .add_edge("Accumulator", "Accumulator")
        .add_edge("Accumulator", "ResultPrinter")
        .add_exit_condition("Accumulator", |dto| {
            if let Some(counter) = dto.as_any().downcast_ref::<Counter>()
                && counter.value >= 10
            {
                return None; // exit
            }
            Some("continue".into()) // keep looping
        })
        .build()?;

    graph.run().await?;
    Ok(())
}
