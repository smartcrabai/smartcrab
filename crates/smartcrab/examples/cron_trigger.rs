//! # Cron Trigger
//!
//! A pipeline triggered on a cron schedule.
//! The `TriggerKind::Cron` configuration declares the schedule string
//! that activates this graph periodically.
//!
//! ```text
//! [ScheduledPoller] -> [ReportBuilder] -> [NotificationSender]
//! ```
//!
//! Run: `cargo run -p smartcrab --example cron_trigger`

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Snapshot {
    timestamp_secs: u64,
    metric: String,
    value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Report {
    summary: String,
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

struct ScheduledPoller;

impl Node for ScheduledPoller {
    fn name(&self) -> &str {
        "ScheduledPoller"
    }
}

#[async_trait]
impl InputNode for ScheduledPoller {
    type TriggerData = ();
    type Output = Snapshot;
    async fn run(&self, _: ()) -> Result<Snapshot> {
        // In production: wait for next tick, then poll the data source
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        println!("[cron] Cron fired at t={now}");
        Ok(Snapshot {
            timestamp_secs: now,
            metric: "cpu_usage".into(),
            value: 42.7,
        })
    }
}

struct ReportBuilder;

impl Node for ReportBuilder {
    fn name(&self) -> &str {
        "ReportBuilder"
    }
}

#[async_trait]
impl HiddenNode for ReportBuilder {
    type Input = Snapshot;
    type Output = Report;
    async fn run(&self, input: Snapshot) -> Result<Report> {
        println!("[report] Building report for metric={}", input.metric);
        Ok(Report {
            summary: format!(
                "[t={}] {}: {:.1}",
                input.timestamp_secs, input.metric, input.value
            ),
        })
    }
}

struct NotificationSender;

impl Node for NotificationSender {
    fn name(&self) -> &str {
        "NotificationSender"
    }
}

#[async_trait]
impl OutputNode for NotificationSender {
    type Input = Report;
    async fn run(&self, input: Report) -> Result<()> {
        // In production: post to Discord / Slack / etc.
        println!("[notify] Sending notification: {}", input.summary);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let graph = DirectedGraphBuilder::new("cron_pipeline")
        .description("Cron-triggered pipeline: poll -> build report -> notify")
        .trigger(TriggerKind::Cron {
            schedule: "0 * * * * * *".into(),
        })
        .add_input(ScheduledPoller)
        .add_hidden(ReportBuilder)
        .add_output(NotificationSender)
        .add_edge("ScheduledPoller", "ReportBuilder")
        .add_edge("ReportBuilder", "NotificationSender")
        .build()
        .expect("failed to build graph");

    println!(
        "Trigger: {:?}",
        graph.trigger_kind().expect("trigger must be set")
    );
    graph.run().await.expect("graph execution failed");
}
