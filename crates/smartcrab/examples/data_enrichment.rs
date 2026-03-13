//! # Data Enrichment Pipeline
//!
//! A multi-stage data processing pipeline that fetches, validates, enriches,
//! transforms, and stores data.
//!
//! ```text
//! [FetchData] → [Validate] → [Enrich] → [Transform] → [Store]
//! ```
//!
//! Run: `cargo run -p smartcrab --example data_enrichment`

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UserProfile {
    id: u64,
    name: String,
    email: String,
    verified: bool,
    enrichments: Vec<String>,
    score: Option<f64>,
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

struct FetchData;

impl Node for FetchData {
    fn name(&self) -> &'static str {
        "FetchData"
    }
}

#[async_trait]
impl InputNode for FetchData {
    type TriggerData = ();
    type Output = UserProfile;
    async fn run(&self, _: ()) -> Result<UserProfile> {
        println!("📡 Fetching user profile...");
        Ok(UserProfile {
            id: 42,
            name: "Alice Smith".into(),
            email: "alice@example.com".into(),
            verified: false,
            enrichments: vec![],
            score: None,
        })
    }
}

struct ValidateProfile;

impl Node for ValidateProfile {
    fn name(&self) -> &'static str {
        "ValidateProfile"
    }
}

#[async_trait]
impl HiddenNode for ValidateProfile {
    type Input = UserProfile;
    type Output = UserProfile;
    async fn run(&self, mut input: UserProfile) -> Result<UserProfile> {
        let has_email = input.email.contains('@');
        let has_name = !input.name.is_empty();
        input.verified = has_email && has_name;
        println!(
            "✅ Validation: email={}, name={}, verified={}",
            has_email, has_name, input.verified
        );
        Ok(input)
    }
}

struct EnrichProfile;

impl Node for EnrichProfile {
    fn name(&self) -> &'static str {
        "EnrichProfile"
    }
}

#[async_trait]
impl HiddenNode for EnrichProfile {
    type Input = UserProfile;
    type Output = UserProfile;
    async fn run(&self, mut input: UserProfile) -> Result<UserProfile> {
        input.enrichments.push("geo:US".into());
        input.enrichments.push("segment:enterprise".into());
        input.enrichments.push("source:api".into());
        println!("🔧 Enriched with {} tags", input.enrichments.len());
        Ok(input)
    }
}

struct TransformProfile;

impl Node for TransformProfile {
    fn name(&self) -> &'static str {
        "TransformProfile"
    }
}

#[async_trait]
impl HiddenNode for TransformProfile {
    type Input = UserProfile;
    type Output = UserProfile;
    async fn run(&self, mut input: UserProfile) -> Result<UserProfile> {
        let base = if input.verified { 80.0_f64 } else { 40.0_f64 };
        let bonus = f64::from(u32::try_from(input.enrichments.len()).unwrap_or(u32::MAX)) * 5.0;
        let score = base + bonus;
        input.score = Some(score);
        input.name = input.name.to_uppercase();
        println!("🔄 Transformed: score={score:.1}");
        Ok(input)
    }
}

struct StoreProfile;

impl Node for StoreProfile {
    fn name(&self) -> &'static str {
        "StoreProfile"
    }
}

#[async_trait]
impl OutputNode for StoreProfile {
    type Input = UserProfile;
    async fn run(&self, input: UserProfile) -> Result<()> {
        println!(
            "💾 Stored: id={}, name={}, score={:.1}, enrichments={:?}",
            input.id,
            input.name,
            input.score.unwrap_or(0.0),
            input.enrichments
        );
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let graph = DirectedGraphBuilder::new("data_enrichment")
        .description("Multi-stage user profile enrichment pipeline")
        .trigger(TriggerKind::Startup)
        .add_input(FetchData)
        .add_hidden(ValidateProfile)
        .add_hidden(EnrichProfile)
        .add_hidden(TransformProfile)
        .add_output(StoreProfile)
        .add_edge("FetchData", "ValidateProfile")
        .add_edge("ValidateProfile", "EnrichProfile")
        .add_edge("EnrichProfile", "TransformProfile")
        .add_edge("TransformProfile", "StoreProfile")
        .build()?;

    graph.run().await?;
    Ok(())
}
