+++
title = "Layer Specification"
description = "Layer specification — trait definitions and code examples for Input/Hidden/Output Layers"
weight = 1
+++

## Overview

A Layer is a processing unit (node) in the DAG and the place where business logic is written in a SmartCrab application. There are three kinds — Input, Hidden, and Output — each with a different signature.

## Common Layer Trait

The base trait implemented by all Layers.

```rust
pub trait Layer: Send + Sync + 'static {
    /// The identifying name of the Layer (used as the span name in traces)
    fn name(&self) -> &str;
}
```

## Input Layer

Receives external events and produces a DTO. Serves as the entry point for the DAG.

### Trait Definition

```rust
#[async_trait]
pub trait InputLayer: Layer {
    /// The type of trigger data (typically `()` is used).
    type TriggerData: Dto;
    type Output: Dto;

    async fn run(&self, trigger: Self::TriggerData) -> Result<Self::Output>;
}
```

### TriggerKind

Specifies when the Layer fires via `DirectedGraphBuilder::trigger()`.

```rust
pub enum TriggerKind {
    /// Executed once at application startup.
    Startup,
    /// Executed on chat events (Discord mentions, DMs, etc.).
    Chat { triggers: Vec<String> },
    /// Executed on a cron schedule.
    Cron { schedule: String },
}
```

### Subtypes

Input Layers have three subtypes. These are distinguished as implementation patterns rather than traits.

| Subtype | TriggerKind | Example Use Case |
|-----------|------------|--------|
| **startup** | `Startup` | Initialization processing at service startup |
| **chat** | `Chat { triggers: vec!["mention", "dm"] }` | Discord chatbot |
| **cron** | `Cron { schedule: "0 * * * * * *" }` | Scheduled batch processing |

### Code Example

```rust
use smartcrab::prelude::*;

pub struct DiscordInput;

impl Layer for DiscordInput {
    fn name(&self) -> &str {
        "DiscordInput"
    }
}

#[async_trait]
impl InputLayer for DiscordInput {
    type TriggerData = ();
    type Output = DiscordMessage;

    async fn run(&self, _: ()) -> Result<Self::Output> {
        // Receive a message from the Discord gateway
        todo!("Implement Discord message listener")
    }
}
```

## Hidden Layer

An intermediate processing Layer that receives a DTO, transforms or processes it, and returns a DTO. Can invoke Claude Code as a subprocess.

### Trait Definition

```rust
#[async_trait]
pub trait HiddenLayer: Layer {
    type Input: Dto;
    type Output: Dto;

    async fn run(&self, input: Self::Input) -> Result<Self::Output>;
}
```

### Claude Code Helper

Provides helper functions for invoking Claude Code from a Hidden Layer.

```rust
use smartcrab::claude::ClaudeCode;

pub struct AiAnalysis;

impl Layer for AiAnalysis {
    fn name(&self) -> &str {
        "AiAnalysis"
    }
}

#[async_trait]
impl HiddenLayer for AiAnalysis {
    type Input = AnalysisInput;
    type Output = AnalysisOutput;

    async fn run(&self, input: Self::Input) -> Result<Self::Output> {
        let prompt = format!(
            "Analyze the following data and return the result in JSON format:\n{}",
            serde_json::to_string_pretty(&input)?
        );

        let response = ClaudeCode::new()
            .with_timeout(Duration::from_secs(120))
            .prompt(&prompt)
            .await?;

        let output: AnalysisOutput = serde_json::from_str(&response)?;
        Ok(output)
    }
}
```

## Output Layer

Receives a DTO and performs final side effects (notifications, persistence, responses, etc.). Can invoke Claude Code as a subprocess.

### Trait Definition

```rust
#[async_trait]
pub trait OutputLayer: Layer {
    type Input: Dto;

    async fn run(&self, input: Self::Input) -> Result<()>;
}
```

### Code Example

```rust
use smartcrab::prelude::*;

pub struct SlackNotifier {
    webhook_url: String,
}

impl Layer for SlackNotifier {
    fn name(&self) -> &str {
        "SlackNotifier"
    }
}

#[async_trait]
impl OutputLayer for SlackNotifier {
    type Input = NotificationPayload;

    async fn run(&self, input: Self::Input) -> Result<()> {
        // Send a message to Slack Webhook
        reqwest::Client::new()
            .post(&self.webhook_url)
            .json(&serde_json::json!({
                "text": input.message,
            }))
            .send()
            .await?;
        Ok(())
    }
}
```

### Output Layer Using Claude Code

```rust
pub struct AiReport;

impl Layer for AiReport {
    fn name(&self) -> &str {
        "AiReport"
    }
}

#[async_trait]
impl OutputLayer for AiReport {
    type Input = ReportData;

    async fn run(&self, input: Self::Input) -> Result<()> {
        let prompt = format!(
            "Generate a report from the following data and write it to report.md:\n{}",
            serde_json::to_string_pretty(&input)?
        );

        ClaudeCode::new()
            .with_timeout(Duration::from_secs(300))
            .prompt(&prompt)
            .await?;

        Ok(())
    }
}
```

## Naming Conventions

| Element | Convention | Example |
|------|------|-----|
| Layer struct name | PascalCase, role-descriptive name | `HttpInput`, `DataAnalyzer`, `SlackNotifier` |
| `name()` return value | Same as struct name | `"HttpInput"`, `"DataAnalyzer"` |
| File name | snake_case | `http_input.rs`, `data_analyzer.rs` |

## File Placement Conventions

```
src/
└── layer/
    ├── mod.rs
    ├── input/
    │   ├── mod.rs
    │   ├── http_input.rs
    │   ├── chat_input.rs
    │   └── cron_input.rs
    ├── hidden/
    │   ├── mod.rs
    │   ├── data_analyzer.rs
    │   └── ai_analysis.rs
    └── output/
        ├── mod.rs
        ├── slack_notifier.rs
        └── ai_report.rs
```
