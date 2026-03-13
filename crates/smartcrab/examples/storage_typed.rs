//! # Storage Typed
//!
//! Demonstrates `StorageExt` for JSON-serialized structs and `keys(prefix)`
//! for namespace-based key enumeration.
//!
//! ```text
//! [GenerateTasks] → [ProcessTask] → [Summarize]
//! ```
//!
//! Run: `cargo run -p smartcrab --example storage_typed`

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Task {
    id: u32,
    description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TaskResult {
    task_id: u32,
    output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BatchInfo {
    task_ids: Vec<u32>,
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

struct GenerateTasks {
    storage: Arc<dyn Storage>,
}

impl Node for GenerateTasks {
    fn name(&self) -> &'static str {
        "GenerateTasks"
    }
}

#[async_trait]
impl InputNode for GenerateTasks {
    type TriggerData = ();
    type Output = BatchInfo;
    async fn run(&self, _: ()) -> Result<BatchInfo> {
        let tasks = vec![
            Task {
                id: 1,
                description: "Fetch weather data".into(),
            },
            Task {
                id: 2,
                description: "Parse API response".into(),
            },
            Task {
                id: 3,
                description: "Send notification".into(),
            },
        ];

        let mut ids = Vec::new();
        for task in &tasks {
            self.storage
                .set_typed(&format!("task:{}", task.id), task)
                .await?;
            ids.push(task.id);
        }
        println!("[GenerateTasks] stored {} tasks", tasks.len());
        Ok(BatchInfo { task_ids: ids })
    }
}

struct ProcessTask {
    storage: Arc<dyn Storage>,
}

impl Node for ProcessTask {
    fn name(&self) -> &'static str {
        "ProcessTask"
    }
}

#[async_trait]
impl HiddenNode for ProcessTask {
    type Input = BatchInfo;
    type Output = BatchInfo;
    async fn run(&self, input: BatchInfo) -> Result<BatchInfo> {
        for id in &input.task_ids {
            let task: Task = self
                .storage
                .get_typed(&format!("task:{id}"))
                .await?
                .ok_or_else(|| SmartCrabError::Other(format!("task not found: task:{id}")))?;

            let result = TaskResult {
                task_id: *id,
                output: format!("completed: {}", task.description),
            };
            self.storage
                .set_typed(&format!("result:{id}"), &result)
                .await?;
        }

        self.storage
            .set("stats:total", input.task_ids.len().to_string())
            .await?;

        println!("[ProcessTask] processed {} tasks", input.task_ids.len());
        Ok(input)
    }
}

struct Summarize {
    storage: Arc<dyn Storage>,
}

impl Node for Summarize {
    fn name(&self) -> &'static str {
        "Summarize"
    }
}

#[async_trait]
impl OutputNode for Summarize {
    type Input = BatchInfo;
    async fn run(&self, _input: BatchInfo) -> Result<()> {
        let total = self
            .storage
            .get("stats:total")
            .await?
            .unwrap_or_else(|| "0".into());
        println!("[Summarize] total tasks processed: {total}");

        let mut result_keys = self.storage.keys(Some("result:")).await?;
        result_keys.sort();
        for key in &result_keys {
            let result: Option<TaskResult> = self.storage.get_typed(key).await?;
            if let Some(r) = result {
                println!("  task #{}: {}", r.task_id, r.output);
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let storage: Arc<dyn Storage> = Arc::new(InMemoryStorage::new());

    let graph = DirectedGraphBuilder::new("storage_typed")
        .description("Typed JSON storage with key prefix namespaces")
        .trigger(TriggerKind::Startup)
        .add_input(GenerateTasks {
            storage: Arc::clone(&storage),
        })
        .add_hidden(ProcessTask {
            storage: Arc::clone(&storage),
        })
        .add_output(Summarize {
            storage: Arc::clone(&storage),
        })
        .add_edge("GenerateTasks", "ProcessTask")
        .add_edge("ProcessTask", "Summarize")
        .build()?;

    graph.run().await?;
    Ok(())
}
