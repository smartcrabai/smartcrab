use std::collections::HashMap;
use std::sync::Arc;

use tokio::signal;
use tracing::{error, info, instrument, warn};

use crate::chat::ChatGateway;
use crate::discord::DiscordGateway;
use crate::error::Result;
use crate::graph::{DirectedGraph, TriggerKind};

/// Runtime that manages multiple DirectedGraphs and handles graceful shutdown.
///
/// Graphs are classified by their [`TriggerKind`]:
/// - **Startup** (or no trigger): run once immediately.
/// - **Cron**: run on a cron schedule via the built-in scheduler.
/// - **Chat**: dispatched via registered [`ChatGateway`] implementations.
pub struct Runtime {
    graphs: Vec<DirectedGraph>,
    chat_gateways: Vec<Box<dyn ChatGateway>>,
}

impl Runtime {
    pub fn new() -> Self {
        Self {
            graphs: Vec::new(),
            chat_gateways: Vec::new(),
        }
    }

    /// Add a DirectedGraph to be executed.
    pub fn add_graph(mut self, graph: DirectedGraph) -> Self {
        self.graphs.push(graph);
        self
    }

    /// Register a chat gateway.
    pub fn chat_gateway(mut self, gateway: impl ChatGateway) -> Self {
        self.chat_gateways.push(Box::new(gateway));
        self
    }

    /// Convenience: set Discord bot token (creates and registers a `DiscordGateway`).
    ///
    /// If not set, the runtime falls back to the `DISCORD_TOKEN` environment
    /// variable when chat graphs are present.
    pub fn discord_token(mut self, token: impl Into<String>) -> Self {
        self.chat_gateways
            .push(Box::new(DiscordGateway::new(token)));
        self
    }

    /// Run all DirectedGraphs and wait for completion or shutdown signal.
    ///
    /// - Startup/no-trigger graphs are spawned immediately and run once.
    /// - Cron-triggered graphs are handed to the cron scheduler.
    /// - Chat-triggered graphs are dispatched via registered [`ChatGateway`]s.
    #[instrument(skip(self), fields(graph_count = self.graphs.len()))]
    pub async fn run(mut self) -> Result<()> {
        info!(count = self.graphs.len(), "starting runtime");

        let mut startup_graphs = Vec::new();
        let mut cron_graphs: Vec<Arc<DirectedGraph>> = Vec::new();
        let mut chat_graphs: Vec<Arc<DirectedGraph>> = Vec::new();

        for graph in self.graphs {
            match graph.trigger_kind() {
                Some(TriggerKind::Cron { .. }) => {
                    info!(graph = %graph.name(), "classified as cron");
                    cron_graphs.push(Arc::new(graph));
                }
                Some(TriggerKind::Chat { .. }) => {
                    info!(graph = %graph.name(), "classified as chat");
                    chat_graphs.push(Arc::new(graph));
                }
                Some(TriggerKind::Startup) | None => {
                    info!(graph = %graph.name(), "classified as startup");
                    startup_graphs.push(graph);
                }
            }
        }

        // Auto-create a DiscordGateway from environment if chat graphs exist
        // and no gateways have been registered (backward compatibility).
        if !chat_graphs.is_empty() && self.chat_gateways.is_empty() {
            if let Ok(token) = std::env::var("DISCORD_TOKEN") {
                self.chat_gateways
                    .push(Box::new(DiscordGateway::new(token)));
            } else {
                return Err(crate::error::SmartCrabError::Chat {
                    platform: "chat".into(),
                    message: format!(
                        "no chat gateway registered and DISCORD_TOKEN not set for {} chat graph(s)",
                        chat_graphs.len()
                    ),
                });
            }
        }

        // Route each chat graph to the appropriate gateway.
        // platform == Some(p) → find gateway where gw.platform() == p
        // platform == None    → use the first gateway
        let mut gateway_graphs: HashMap<usize, Vec<Arc<DirectedGraph>>> = HashMap::new();
        for graph in &chat_graphs {
            let platform = if let Some(TriggerKind::Chat { platform, .. }) = graph.trigger_kind() {
                platform.as_deref()
            } else {
                None
            };
            let idx = match platform {
                Some(p) => match self.chat_gateways.iter().position(|gw| gw.platform() == p) {
                    Some(i) => i,
                    None => {
                        warn!(platform = %p, "no gateway found for platform, falling back to gateway 0");
                        0
                    }
                },
                None => 0,
            };
            gateway_graphs
                .entry(idx)
                .or_default()
                .push(Arc::clone(graph));
        }

        info!(
            startup = startup_graphs.len(),
            cron = cron_graphs.len(),
            chat = chat_graphs.len(),
            gateways = self.chat_gateways.len(),
            "graphs classified"
        );

        // Spawn each category as a tokio task.
        let startup_handle = tokio::spawn(Self::run_startup_graphs(startup_graphs));

        let cron_handle = if !cron_graphs.is_empty() {
            Some(tokio::spawn(crate::scheduler::run_cron_graphs(cron_graphs)))
        } else {
            None
        };

        // Spawn one task per gateway.
        let mut chat_handles = Vec::new();
        for (idx, gateway) in self.chat_gateways.into_iter().enumerate() {
            let graphs = gateway_graphs.remove(&idx).unwrap_or_default();
            info!(platform = %gateway.platform(), bot_graphs = graphs.len(), "spawning chat gateway");
            chat_handles.push(tokio::spawn(async move { gateway.run(graphs).await }));
        }

        let has_long_running = cron_handle.is_some() || !chat_handles.is_empty();

        // Wait for startup graphs first.
        let startup_result = match startup_handle.await {
            Ok(Ok(())) => {
                info!("all startup graphs completed");
                Ok(())
            }
            Ok(Err(e)) => {
                error!(error = %e, "startup graphs failed");
                Err(e)
            }
            Err(e) => {
                error!(error = %e, "startup task panicked");
                Err(crate::error::SmartCrabError::Other(format!(
                    "startup task panicked: {e}"
                )))
            }
        };

        // If no long-running tasks, propagate startup result.
        if !has_long_running {
            return startup_result;
        }
        // Startup failed — propagate before running long-running tasks.
        startup_result?;

        // Wait for long-running tasks or shutdown signal.
        // All long-running tasks (cron + chat) are awaited concurrently so that
        // a failure in one does not silence errors from another.
        let long_running_fut = async {
            let mut join_set = tokio::task::JoinSet::new();

            if let Some(handle) = cron_handle {
                join_set.spawn(async move {
                    match handle.await {
                        Ok(Err(e)) => error!(error = %e, "cron scheduler failed"),
                        Err(e) => error!(error = %e, "cron task panicked"),
                        _ => {}
                    }
                });
            }

            for handle in chat_handles {
                join_set.spawn(async move {
                    match handle.await {
                        Ok(Err(e)) => error!(error = %e, "chat gateway failed"),
                        Err(e) => error!(error = %e, "chat gateway task panicked"),
                        _ => {}
                    }
                });
            }

            while join_set.join_next().await.is_some() {}
        };

        tokio::select! {
            _ = long_running_fut => {
                info!("long-running tasks completed");
            }
            _ = shutdown_signal() => {
                info!("shutdown signal received, stopping");
            }
        }

        Ok(())
    }

    async fn run_startup_graphs(graphs: Vec<DirectedGraph>) -> Result<()> {
        let mut handles = Vec::new();
        for graph in graphs {
            let name = graph.name().to_owned();
            handles.push(tokio::spawn(async move {
                info!(graph = %name, "spawning startup graph");
                if let Err(e) = graph.run().await {
                    error!(graph = %name, error = %e, "startup graph failed");
                    return Err(e);
                }
                Ok(())
            }));
        }

        for handle in handles {
            match handle.await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => return Err(e),
                Err(e) => {
                    return Err(crate::error::SmartCrabError::Other(format!(
                        "startup task panicked: {e}"
                    )));
                }
            }
        }

        Ok(())
    }
}

impl Default for Runtime {
    fn default() -> Self {
        Self::new()
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use serde::{Deserialize, Serialize};

    use super::*;
    use crate::graph::DirectedGraphBuilder;
    use crate::node::{InputNode, Node, OutputNode};

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct Msg {
        v: String,
    }

    struct In;
    impl Node for In {
        fn name(&self) -> &str {
            "In"
        }
    }
    #[async_trait]
    impl InputNode for In {
        type TriggerData = ();
        type Output = Msg;
        async fn run(&self, _: ()) -> Result<Msg> {
            Ok(Msg { v: "ok".into() })
        }
    }

    struct Out;
    impl Node for Out {
        fn name(&self) -> &str {
            "Out"
        }
    }
    #[async_trait]
    impl OutputNode for Out {
        type Input = Msg;
        async fn run(&self, _input: Msg) -> Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn test_runtime_runs_multiple_graphs() {
        let graph1 = DirectedGraphBuilder::new("graph1")
            .add_input(In)
            .add_output(Out)
            .add_edge("In", "Out")
            .build()
            .unwrap();

        struct In2;
        impl Node for In2 {
            fn name(&self) -> &str {
                "In2"
            }
        }
        #[async_trait]
        impl InputNode for In2 {
            type TriggerData = ();
            type Output = Msg;
            async fn run(&self, _: ()) -> Result<Msg> {
                Ok(Msg { v: "ok2".into() })
            }
        }
        struct Out2;
        impl Node for Out2 {
            fn name(&self) -> &str {
                "Out2"
            }
        }
        #[async_trait]
        impl OutputNode for Out2 {
            type Input = Msg;
            async fn run(&self, _input: Msg) -> Result<()> {
                Ok(())
            }
        }

        let graph2 = DirectedGraphBuilder::new("graph2")
            .add_input(In2)
            .add_output(Out2)
            .add_edge("In2", "Out2")
            .build()
            .unwrap();

        let runtime = Runtime::new().add_graph(graph1).add_graph(graph2);
        let result = runtime.run().await;
        assert!(result.is_ok());
    }
}
