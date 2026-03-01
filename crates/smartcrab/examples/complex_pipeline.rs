//! # Complex Pipeline
//!
//! A complex graph combining conditional branching, fan-out, and multi-stage
//! processing. Demonstrates how multiple patterns compose in a single graph.
//!
//! ```text
//! [Ingest] → [Validate] ──"valid"──→ [Enrich] → [IndexOutput]
//!                        └─"invalid"─→ [Quarantine]
//! ```
//!
//! Run: `cargo run -p smartcrab --example complex_pipeline`

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use smartcrab::prelude::*;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Document {
    id: u64,
    body: String,
    status: String,
    score: f64,
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

struct Ingest;

impl Layer for Ingest {
    fn name(&self) -> &str {
        "Ingest"
    }
}

#[async_trait]
impl InputLayer for Ingest {
    type TriggerData = ();
    type Output = Document;
    async fn run(&self, _: ()) -> Result<Document> {
        println!("📨 Ingesting document...");
        Ok(Document {
            id: 1001,
            body: "SmartCrab is a workflow orchestration engine.".into(),
            status: String::new(),
            score: 0.0,
        })
    }
}

struct Validate;

impl Layer for Validate {
    fn name(&self) -> &str {
        "Validate"
    }
}

#[async_trait]
impl HiddenLayer for Validate {
    type Input = Document;
    type Output = Document;
    async fn run(&self, mut input: Document) -> Result<Document> {
        let is_valid = !input.body.is_empty() && input.body.len() < 10_000;
        input.status = if is_valid {
            "valid".into()
        } else {
            "invalid".into()
        };
        println!("✅ Validation: {}", input.status);
        Ok(input)
    }
}

struct Enrich;

impl Layer for Enrich {
    fn name(&self) -> &str {
        "Enrich"
    }
}

#[async_trait]
impl HiddenLayer for Enrich {
    type Input = Document;
    type Output = Document;
    async fn run(&self, mut input: Document) -> Result<Document> {
        input.score = input.body.split_whitespace().count() as f64 * 1.5;
        println!("🔧 Enriched: score={}", input.score);
        Ok(input)
    }
}

struct IndexOutput;

impl Layer for IndexOutput {
    fn name(&self) -> &str {
        "IndexOutput"
    }
}

#[async_trait]
impl OutputLayer for IndexOutput {
    type Input = Document;
    async fn run(&self, input: Document) -> Result<()> {
        println!(
            "📦 Indexed document #{}: score={}, body={}...",
            input.id,
            input.score,
            &input.body[..input.body.len().min(40)]
        );
        Ok(())
    }
}

struct Quarantine;

impl Layer for Quarantine {
    fn name(&self) -> &str {
        "Quarantine"
    }
}

#[async_trait]
impl OutputLayer for Quarantine {
    type Input = Document;
    async fn run(&self, input: Document) -> Result<()> {
        println!("🚫 Quarantined document #{}: {}", input.id, input.status);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    let graph = DirectedGraphBuilder::new("complex_pipeline")
        .description("Complex document processing with validation, branching, and enrichment")
        .trigger(TriggerKind::Startup)
        .add_input(Ingest)
        .add_hidden(Validate)
        .add_hidden(Enrich)
        .add_output(IndexOutput)
        .add_output(Quarantine)
        .add_edge("Ingest", "Validate")
        .add_conditional_edge(
            "Validate",
            |dto| {
                let doc: &Document = dto.as_any().downcast_ref()?;
                Some(doc.status.clone())
            },
            vec![
                ("valid".to_owned(), "Enrich".to_owned()),
                ("invalid".to_owned(), "Quarantine".to_owned()),
            ],
        )
        .add_edge("Enrich", "IndexOutput")
        .build()
        .expect("failed to build graph");

    graph.run().await.expect("graph execution failed");
}
