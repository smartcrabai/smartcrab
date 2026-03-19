//! # Storage Counter
//!
//! Demonstrates the simplest storage usage: sharing `InMemoryStorage` across
//! layers and accumulating state across multiple graph runs.
//!
//! ```text
//! [ReadCount] -> [IncrementCount] -> [PrintCount]
//! ```
//!
//! Run: `cargo run -p smartcrab --example storage_counter`

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Count(u32);

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

struct ReadCount {
    storage: Arc<dyn Storage>,
}

impl Node for ReadCount {
    fn name(&self) -> &str {
        "ReadCount"
    }
}

#[async_trait]
impl InputNode for ReadCount {
    type TriggerData = ();
    type Output = Count;
    async fn run(&self, _: ()) -> Result<Count> {
        let n = self
            .storage
            .get("counter")
            .await?
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        Ok(Count(n))
    }
}

struct IncrementCount {
    storage: Arc<dyn Storage>,
}

impl Node for IncrementCount {
    fn name(&self) -> &str {
        "IncrementCount"
    }
}

#[async_trait]
impl HiddenNode for IncrementCount {
    type Input = Count;
    type Output = Count;
    async fn run(&self, input: Count) -> Result<Count> {
        let new_count = input.0 + 1;
        self.storage.set("counter", new_count.to_string()).await?;
        Ok(Count(new_count))
    }
}

struct PrintCount;

impl Node for PrintCount {
    fn name(&self) -> &str {
        "PrintCount"
    }
}

#[async_trait]
impl OutputNode for PrintCount {
    type Input = Count;
    async fn run(&self, input: Count) -> Result<()> {
        println!("counter = {}", input.0);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let storage: Arc<dyn Storage> = Arc::new(InMemoryStorage::new());

    let graph = DirectedGraphBuilder::new("storage_counter")
        .description("Accumulate a counter across multiple runs using InMemoryStorage")
        .trigger(TriggerKind::Startup)
        .add_input(ReadCount {
            storage: Arc::clone(&storage),
        })
        .add_hidden(IncrementCount {
            storage: Arc::clone(&storage),
        })
        .add_output(PrintCount)
        .add_edge("ReadCount", "IncrementCount")
        .add_edge("IncrementCount", "PrintCount")
        .build()
        .expect("failed to build graph");

    for _ in 0..3 {
        graph.run().await.expect("graph execution failed");
    }
}
