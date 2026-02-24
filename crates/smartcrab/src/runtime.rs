use tokio::signal;
use tracing::{error, info, instrument};

use crate::dag::Dag;
use crate::error::Result;

/// Runtime that manages multiple DAGs and handles graceful shutdown.
pub struct Runtime {
    dags: Vec<Dag>,
}

impl Runtime {
    pub fn new() -> Self {
        Self { dags: Vec::new() }
    }

    /// Add a DAG to be executed.
    pub fn add_dag(mut self, dag: Dag) -> Self {
        self.dags.push(dag);
        self
    }

    /// Run all DAGs concurrently and wait for completion or shutdown signal.
    #[instrument(skip(self), fields(dag_count = self.dags.len()))]
    pub async fn run(self) -> Result<()> {
        info!(count = self.dags.len(), "starting runtime");

        let mut handles = Vec::new();
        for dag in self.dags {
            let name = dag.name().to_owned();
            let handle = tokio::spawn(async move {
                info!(dag = %name, "spawning DAG");
                if let Err(e) = dag.run().await {
                    error!(dag = %name, error = %e, "DAG failed");
                    return Err(e);
                }
                Ok(())
            });
            handles.push(handle);
        }

        tokio::select! {
            _ = async {
                for handle in handles {
                    if let Ok(Err(e)) = handle.await {
                        error!(error = %e, "DAG error");
                    }
                }
            } => {
                info!("all DAGs completed");
            }
            _ = shutdown_signal() => {
                info!("shutdown signal received, stopping");
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
    use crate::dag::DagBuilder;
    use crate::layer::{InputLayer, Layer, OutputLayer};

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct Msg {
        v: String,
    }

    struct In;
    impl Layer for In {
        fn name(&self) -> &str {
            "In"
        }
    }
    #[async_trait]
    impl InputLayer for In {
        type Output = Msg;
        async fn run(&self) -> Result<Msg> {
            Ok(Msg { v: "ok".into() })
        }
    }

    struct Out;
    impl Layer for Out {
        fn name(&self) -> &str {
            "Out"
        }
    }
    #[async_trait]
    impl OutputLayer for Out {
        type Input = Msg;
        async fn run(&self, _input: Msg) -> Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn test_runtime_runs_multiple_dags() {
        let dag1 = DagBuilder::new("dag1")
            .add_input(In)
            .add_output(Out)
            .add_edge("In", "Out")
            .build()
            .unwrap();

        // We can't reuse the same struct instances, so define separate ones
        struct In2;
        impl Layer for In2 {
            fn name(&self) -> &str {
                "In2"
            }
        }
        #[async_trait]
        impl InputLayer for In2 {
            type Output = Msg;
            async fn run(&self) -> Result<Msg> {
                Ok(Msg { v: "ok2".into() })
            }
        }
        struct Out2;
        impl Layer for Out2 {
            fn name(&self) -> &str {
                "Out2"
            }
        }
        #[async_trait]
        impl OutputLayer for Out2 {
            type Input = Msg;
            async fn run(&self, _input: Msg) -> Result<()> {
                Ok(())
            }
        }

        let dag2 = DagBuilder::new("dag2")
            .add_input(In2)
            .add_output(Out2)
            .add_edge("In2", "Out2")
            .build()
            .unwrap();

        let runtime = Runtime::new().add_dag(dag1).add_dag(dag2);
        let result = runtime.run().await;
        assert!(result.is_ok());
    }
}
