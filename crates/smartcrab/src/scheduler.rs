use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use cron::Schedule;
use tracing::{error, info};

use crate::error::{Result, SmartCrabError};
use crate::graph::{DirectedGraph, TriggerKind};

struct CronEntry {
    schedule: Schedule,
    graph: Arc<DirectedGraph>,
}

/// Run all Cron-triggered graphs on their schedules.
///
/// Uses `tokio::time::interval(60s)` to tick every minute, then checks which
/// graphs should fire based on their cron expressions.
pub async fn run_cron_graphs(graphs: Vec<Arc<DirectedGraph>>) -> Result<()> {
    if graphs.is_empty() {
        // Nothing to schedule — block forever so tokio::select! doesn't exit.
        return std::future::pending().await;
    }

    let mut entries = Vec::new();
    for graph in &graphs {
        if let Some(TriggerKind::Cron { schedule }) = graph.trigger_kind() {
            let sched = Schedule::from_str(schedule).map_err(|e| {
                SmartCrabError::CronSchedule(format!(
                    "invalid cron expression '{}' for graph '{}': {e}",
                    schedule,
                    graph.name()
                ))
            })?;
            entries.push(CronEntry {
                schedule: sched,
                graph: Arc::clone(graph),
            });
            info!(graph = %graph.name(), schedule = %schedule, "registered cron graph");
        }
    }

    if entries.is_empty() {
        return std::future::pending().await;
    }

    // Track last fire time per entry to avoid double-firing.
    let mut last_fired: Vec<Option<chrono::DateTime<Utc>>> = vec![None; entries.len()];

    let mut interval = tokio::time::interval(Duration::from_secs(60));
    // First tick fires immediately — use it to bootstrap.
    interval.tick().await;

    loop {
        interval.tick().await;
        let now = Utc::now();

        for (i, entry) in entries.iter().enumerate() {
            // Check if a scheduled time occurred in the last 60-second window.
            // Using `after(prev_threshold)` catches exact-aligned times that
            // `upcoming(Utc).next()` (strictly after *now*) would miss.
            let prev_threshold = now - chrono::Duration::seconds(60);
            let should_fire = entry
                .schedule
                .after(&prev_threshold)
                .next()
                .is_some_and(|next| {
                    next <= now && last_fired[i].is_none_or(|last| (now - last).num_seconds() >= 59)
                });

            if should_fire {
                last_fired[i] = Some(now);
                let graph = Arc::clone(&entry.graph);
                let name = graph.name().to_owned();
                info!(graph = %name, "cron trigger fired");
                tokio::spawn(async move {
                    if let Err(e) = graph.run().await {
                        error!(graph = %name, error = %e, "cron graph execution failed");
                    }
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use serde::{Deserialize, Serialize};

    use super::*;
    use crate::graph::DirectedGraphBuilder;
    use crate::layer::{InputLayer, Layer, OutputLayer};

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct Msg {
        v: String,
    }

    struct TestIn;
    impl Layer for TestIn {
        fn name(&self) -> &str {
            "TestIn"
        }
    }
    #[async_trait]
    impl InputLayer for TestIn {
        type TriggerData = ();
        type Output = Msg;
        async fn run(&self, _: ()) -> Result<Msg> {
            Ok(Msg { v: "cron".into() })
        }
    }

    struct TestOut;
    impl Layer for TestOut {
        fn name(&self) -> &str {
            "TestOut"
        }
    }
    #[async_trait]
    impl OutputLayer for TestOut {
        type Input = Msg;
        async fn run(&self, _input: Msg) -> Result<()> {
            Ok(())
        }
    }

    #[test]
    fn test_cron_schedule_parsing() {
        // Verify that standard cron expressions parse correctly.
        let sched = Schedule::from_str("0 * * * * * *");
        assert!(sched.is_ok(), "every-minute cron expression should parse");
    }

    #[test]
    fn test_invalid_cron_schedule() {
        let graph = Arc::new(
            DirectedGraphBuilder::new("bad_cron")
                .trigger(TriggerKind::Cron {
                    schedule: "not a cron expr".into(),
                })
                .add_input(TestIn)
                .add_output(TestOut)
                .add_edge("TestIn", "TestOut")
                .build()
                .unwrap(),
        );

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(async {
            tokio::time::timeout(Duration::from_millis(100), run_cron_graphs(vec![graph])).await
        });

        // Should get the CronSchedule error before timeout.
        match result {
            Ok(Err(SmartCrabError::CronSchedule(_))) => {} // expected
            other => panic!("expected CronSchedule error, got: {:?}", other),
        }
    }
}
