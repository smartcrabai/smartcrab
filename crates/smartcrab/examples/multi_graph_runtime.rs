//! # Multi-Graph Runtime
//!
//! Demonstrates running multiple independent DirectedGraphs concurrently
//! using the Runtime.
//!
//! ```text
//! Graph 1: [HealthChecker] → [HealthReporter]
//! Graph 2: [TaskPoller] → [TaskExecutor] → [TaskReporter]
//! ```
//!
//! Run: `cargo run -p smartcrab --example multi_graph_runtime`

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HealthStatus {
    service: String,
    healthy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Task {
    id: u64,
    name: String,
    status: String,
}

// ---------------------------------------------------------------------------
// Graph 1: Health Check Pipeline
// ---------------------------------------------------------------------------

struct HealthChecker;

impl Layer for HealthChecker {
    fn name(&self) -> &str {
        "HealthChecker"
    }
}

#[async_trait]
impl InputLayer for HealthChecker {
    type TriggerData = ();
    type Output = HealthStatus;
    async fn run(&self, _: ()) -> Result<HealthStatus> {
        println!("🏥 Checking service health...");
        Ok(HealthStatus {
            service: "api-gateway".into(),
            healthy: true,
        })
    }
}

struct HealthReporter;

impl Layer for HealthReporter {
    fn name(&self) -> &str {
        "HealthReporter"
    }
}

#[async_trait]
impl OutputLayer for HealthReporter {
    type Input = HealthStatus;
    async fn run(&self, input: HealthStatus) -> Result<()> {
        let icon = if input.healthy { "✅" } else { "❌" };
        println!(
            "{icon} Health: {} is {}",
            input.service,
            if input.healthy { "UP" } else { "DOWN" }
        );
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Graph 2: Task Processing Pipeline
// ---------------------------------------------------------------------------

struct TaskPoller;

impl Layer for TaskPoller {
    fn name(&self) -> &str {
        "TaskPoller"
    }
}

#[async_trait]
impl InputLayer for TaskPoller {
    type TriggerData = ();
    type Output = Task;
    async fn run(&self, _: ()) -> Result<Task> {
        println!("📋 Polling for tasks...");
        Ok(Task {
            id: 1,
            name: "deploy-v2".into(),
            status: "pending".into(),
        })
    }
}

struct TaskExecutor;

impl Layer for TaskExecutor {
    fn name(&self) -> &str {
        "TaskExecutor"
    }
}

#[async_trait]
impl HiddenLayer for TaskExecutor {
    type Input = Task;
    type Output = Task;
    async fn run(&self, mut input: Task) -> Result<Task> {
        println!("⚡ Executing task: {}", input.name);
        input.status = "completed".into();
        Ok(input)
    }
}

struct TaskReporter;

impl Layer for TaskReporter {
    fn name(&self) -> &str {
        "TaskReporter"
    }
}

#[async_trait]
impl OutputLayer for TaskReporter {
    type Input = Task;
    async fn run(&self, input: Task) -> Result<()> {
        println!("📊 Task #{} ({}): {}", input.id, input.name, input.status);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let health_graph = DirectedGraphBuilder::new("health_check")
        .description("Periodic health check pipeline")
        .trigger(TriggerKind::Startup)
        .add_input(HealthChecker)
        .add_output(HealthReporter)
        .add_edge("HealthChecker", "HealthReporter")
        .build()
        .expect("failed to build health graph");

    let task_graph = DirectedGraphBuilder::new("task_processing")
        .description("Task polling and execution pipeline")
        .trigger(TriggerKind::Startup)
        .add_input(TaskPoller)
        .add_hidden(TaskExecutor)
        .add_output(TaskReporter)
        .add_edge("TaskPoller", "TaskExecutor")
        .add_edge("TaskExecutor", "TaskReporter")
        .build()
        .expect("failed to build task graph");

    let runtime = Runtime::new().add_graph(health_graph).add_graph(task_graph);

    runtime.run().await.expect("runtime execution failed");
}
