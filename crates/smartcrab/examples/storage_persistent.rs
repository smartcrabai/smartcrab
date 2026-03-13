//! # Storage Persistent
//!
//! Demonstrates `FileStorage` for data that survives process restarts.
//! The example writes deployment records, drops the storage, reopens it,
//! and confirms all data is still present.
//!
//! ```text
//! [RecordDeployment] → [UpdateHistory] → [PrintReport]
//! ```
//!
//! Run: `cargo run -p smartcrab --example storage_persistent`

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Deployment {
    version: String,
    environment: String,
    deployed_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DeployInfo {
    id: String,
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

struct RecordDeployment {
    storage: Arc<dyn Storage>,
}

impl Node for RecordDeployment {
    fn name(&self) -> &'static str {
        "RecordDeployment"
    }
}

#[async_trait]
impl InputNode for RecordDeployment {
    type TriggerData = ();
    type Output = DeployInfo;
    async fn run(&self, _: ()) -> Result<DeployInfo> {
        let deploy_id = "deploy-001";
        let deployment = Deployment {
            version: "v2.3.1".into(),
            environment: "production".into(),
            deployed_by: "ci-bot".into(),
        };

        self.storage
            .set_typed(&format!("deploy:{deploy_id}"), &deployment)
            .await?;
        println!(
            "[RecordDeployment] recorded {} to {}",
            deployment.version, deployment.environment
        );
        Ok(DeployInfo {
            id: deploy_id.into(),
        })
    }
}

struct UpdateHistory {
    storage: Arc<dyn Storage>,
}

impl Node for UpdateHistory {
    fn name(&self) -> &'static str {
        "UpdateHistory"
    }
}

#[async_trait]
impl HiddenNode for UpdateHistory {
    type Input = DeployInfo;
    type Output = DeployInfo;
    async fn run(&self, input: DeployInfo) -> Result<DeployInfo> {
        let count = self
            .storage
            .get("history:count")
            .await?
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0)
            + 1;

        self.storage.set("history:count", count.to_string()).await?;
        self.storage
            .set(&format!("history:entry:{count}"), input.id.clone())
            .await?;

        println!("[UpdateHistory] total deployments so far: {count}");
        Ok(input)
    }
}

struct PrintReport {
    storage: Arc<dyn Storage>,
}

impl Node for PrintReport {
    fn name(&self) -> &'static str {
        "PrintReport"
    }
}

#[async_trait]
impl OutputNode for PrintReport {
    type Input = DeployInfo;
    async fn run(&self, input: DeployInfo) -> Result<()> {
        let deploy: Option<Deployment> = self
            .storage
            .get_typed(&format!("deploy:{}", input.id))
            .await?;

        if let Some(d) = deploy {
            println!(
                "[PrintReport] deploy={} env={} by={}",
                d.version, d.environment, d.deployed_by
            );
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let storage_path = std::env::temp_dir().join("smartcrab_deploy.json");

    // --- First run: write data ---
    println!("=== First run (writing data) ===");
    {
        let storage: Arc<dyn Storage> = Arc::new(FileStorage::open(&storage_path).await?);

        let graph = DirectedGraphBuilder::new("storage_persistent")
            .description("Record a deployment to FileStorage")
            .trigger(TriggerKind::Startup)
            .add_input(RecordDeployment {
                storage: Arc::clone(&storage),
            })
            .add_hidden(UpdateHistory {
                storage: Arc::clone(&storage),
            })
            .add_output(PrintReport {
                storage: Arc::clone(&storage),
            })
            .add_edge("RecordDeployment", "UpdateHistory")
            .add_edge("UpdateHistory", "PrintReport")
            .build()?;

        graph.run().await?;
    }
    // storage is dropped here — file is already flushed on every write

    // --- Second run: reopen and verify persistence ---
    println!("\n=== Second run (verifying persistence after storage drop) ===");
    {
        let storage = FileStorage::open(&storage_path).await?;

        let count = storage.get("history:count").await?;
        println!(
            "history:count = {}",
            count.as_deref().unwrap_or("<missing>")
        );

        let deployment: Option<Deployment> = storage.get_typed("deploy:deploy-001").await?;
        match deployment {
            Some(d) => println!("deploy:deploy-001 = {} ({})", d.version, d.environment),
            None => println!("deploy:deploy-001 = <missing>"),
        }
    }

    // --- Cleanup ---
    tokio::fs::remove_file(&storage_path).await.ok();
    println!("\nCleaned up {}", storage_path.display());
    Ok(())
}
