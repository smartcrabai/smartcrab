use std::collections::HashMap;
use std::sync::Arc;

use tokio::signal;
use tracing::{error, info, instrument, warn};

use crate::chat::ChatGateway;
use crate::discord::DiscordGateway;
use crate::error::Result;
use crate::graph::{DirectedGraph, TriggerKind};

/// Runtime that manages multiple `DirectedGraph`s and handles graceful shutdown.
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
    #[must_use]
    pub fn new() -> Self {
        Self {
            graphs: Vec::new(),
            chat_gateways: Vec::new(),
        }
    }

    /// Add a `DirectedGraph` to be executed.
    #[must_use]
    pub fn add_graph(mut self, graph: DirectedGraph) -> Self {
        self.graphs.push(graph);
        self
    }

    /// Register a chat gateway.
    #[must_use]
    pub fn chat_gateway(mut self, gateway: impl ChatGateway) -> Self {
        self.chat_gateways.push(Box::new(gateway));
        self
    }

    /// Convenience: set Discord bot token (creates and registers a `DiscordGateway`).
    ///
    /// If not set, the runtime falls back to the `DISCORD_TOKEN` environment
    /// variable when chat graphs are present.
    #[must_use]
    pub fn discord_token(mut self, token: impl Into<String>) -> Self {
        self.chat_gateways
            .push(Box::new(DiscordGateway::new(token)));
        self
    }

    /// Run all `DirectedGraph`s and wait for completion or shutdown signal.
    ///
    /// - Startup/no-trigger graphs are spawned immediately and run once.
    /// - Cron-triggered graphs are handed to the cron scheduler.
    /// - Chat-triggered graphs are dispatched via registered [`ChatGateway`]s.
    ///
    /// # Errors
    ///
    /// Returns an error if no chat gateway is registered and the `DISCORD_TOKEN`
    /// environment variable is not set when chat graphs are present, or if any
    /// startup graph fails.
    #[instrument(skip(self), fields(graph_count = self.graphs.len()))]
    pub async fn run(mut self) -> Result<()> {
        info!(count = self.graphs.len(), "starting runtime");

        let (startup_graphs, cron_graphs, chat_graphs) = Self::classify_graphs(self.graphs);

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

        let gateway_graphs = Self::build_gateway_routing(&chat_graphs, &self.chat_gateways);

        info!(
            startup = startup_graphs.len(),
            cron = cron_graphs.len(),
            chat = chat_graphs.len(),
            gateways = self.chat_gateways.len(),
            "graphs classified"
        );

        let startup_handle = tokio::spawn(Self::run_startup_graphs(startup_graphs));

        let cron_handle = if cron_graphs.is_empty() {
            None
        } else {
            Some(tokio::spawn(crate::scheduler::run_cron_graphs(cron_graphs)))
        };

        let mut chat_handles = Vec::new();
        for (idx, gateway) in self.chat_gateways.into_iter().enumerate() {
            let graphs = gateway_graphs.get(&idx).cloned().unwrap_or_default();
            info!(platform = %gateway.platform(), bot_graphs = graphs.len(), "spawning chat gateway");
            chat_handles.push(tokio::spawn(async move { gateway.run(graphs).await }));
        }

        let has_long_running = cron_handle.is_some() || !chat_handles.is_empty();

        let startup_result = Self::await_startup(startup_handle).await;

        if !has_long_running {
            return startup_result;
        }
        startup_result?;

        Self::run_long_running(cron_handle, chat_handles).await;

        Ok(())
    }

    fn classify_graphs(
        graphs: Vec<DirectedGraph>,
    ) -> (
        Vec<DirectedGraph>,
        Vec<Arc<DirectedGraph>>,
        Vec<Arc<DirectedGraph>>,
    ) {
        let mut startup = Vec::new();
        let mut cron = Vec::new();
        let mut chat = Vec::new();
        for graph in graphs {
            match graph.trigger_kind() {
                Some(TriggerKind::Cron { .. }) => {
                    info!(graph = %graph.name(), "classified as cron");
                    cron.push(Arc::new(graph));
                }
                Some(TriggerKind::Chat { .. }) => {
                    info!(graph = %graph.name(), "classified as chat");
                    chat.push(Arc::new(graph));
                }
                Some(TriggerKind::Startup) | None => {
                    info!(graph = %graph.name(), "classified as startup");
                    startup.push(graph);
                }
            }
        }
        (startup, cron, chat)
    }

    fn build_gateway_routing(
        chat_graphs: &[Arc<DirectedGraph>],
        gateways: &[Box<dyn ChatGateway>],
    ) -> HashMap<usize, Vec<Arc<DirectedGraph>>> {
        let mut gateway_graphs: HashMap<usize, Vec<Arc<DirectedGraph>>> = HashMap::new();
        for graph in chat_graphs {
            let platform = if let Some(TriggerKind::Chat { platform, .. }) = graph.trigger_kind() {
                platform.as_deref()
            } else {
                None
            };
            let idx = if let Some(p) = platform {
                gateways
                    .iter()
                    .position(|gw| gw.platform() == p)
                    .unwrap_or_else(|| {
                        warn!(platform = %p, "no gateway found for platform, falling back to gateway 0");
                        0
                    })
            } else {
                0
            };
            gateway_graphs
                .entry(idx)
                .or_default()
                .push(Arc::clone(graph));
        }
        gateway_graphs
    }

    async fn await_startup(startup_handle: tokio::task::JoinHandle<Result<()>>) -> Result<()> {
        match startup_handle.await {
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
        }
    }

    async fn run_long_running(
        cron_handle: Option<tokio::task::JoinHandle<Result<()>>>,
        chat_handles: Vec<tokio::task::JoinHandle<Result<()>>>,
    ) {
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
            () = long_running_fut => {
                info!("long-running tasks completed");
            }
            () = shutdown_signal() => {
                info!("shutdown signal received, stopping");
            }
        }
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
    let ctrl_c = async { if let Ok(()) = signal::ctrl_c().await {} };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) = signal::unix::signal(signal::unix::SignalKind::terminate()) {
            sig.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
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
        fn name(&self) -> &'static str {
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
        fn name(&self) -> &'static str {
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

    struct In2;
    impl Node for In2 {
        fn name(&self) -> &'static str {
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
        fn name(&self) -> &'static str {
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

    #[tokio::test]
    async fn test_runtime_runs_multiple_graphs() -> Result<()> {
        let graph1 = DirectedGraphBuilder::new("graph1")
            .add_input(In)
            .add_output(Out)
            .add_edge("In", "Out")
            .build()
            .map_err(crate::error::SmartCrabError::Graph)?;

        let graph2 = DirectedGraphBuilder::new("graph2")
            .add_input(In2)
            .add_output(Out2)
            .add_edge("In2", "Out2")
            .build()
            .map_err(crate::error::SmartCrabError::Graph)?;

        Runtime::new()
            .add_graph(graph1)
            .add_graph(graph2)
            .run()
            .await
    }
}
