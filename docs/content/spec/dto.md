+++
title = "DTO Specification"
description = "DTO specification — the Dto trait, naming conventions, conversions, and code examples"
weight = 2
+++

## Overview

A DTO (Data Transfer Object) is a type-safe Rust struct used to pass data between Layers. Implementing the `Dto` trait guarantees the serialization, cloning, and thread-safety required by the framework.

## Dto Trait Definition

`Dto` is a marker trait that requires the necessary bounds as supertraits.

```rust
use serde::{Deserialize, Serialize};
use std::fmt::Debug;

pub trait Dto: Serialize + for<'de> Deserialize<'de> + Clone + Debug + Send + Sync + 'static {}
```

### Derive Macro

A derive macro is provided to simplify implementing the `Dto` trait.

```rust
use smartcrab::Dto;

#[derive(Dto)]
pub struct MyData {
    pub message: String,
    pub count: u32,
}
```

The above is equivalent to:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MyData {
    pub message: String,
    pub count: u32,
}

impl Dto for MyData {}
```

## Naming Conventions

DTOs are named based on the Layer that produces them.

| Pattern | Description | Example |
|---------|------|-----|
| `<LayerName>Input` | Input DTO for a Layer | `AnalyzerInput` |
| `<LayerName>Output` | Output DTO for a Layer | `AnalyzerOutput` |

A Layer's `Input` associated type matches the `Output` DTO of the preceding Layer. For this reason, it is common for adjacent Layers to share the same DTO type.

```
FetchLayer::Output = FetchOutput
AnalyzeLayer::Input = FetchOutput   ← Same type
AnalyzeLayer::Output = AnalyzeOutput
```

## DTO Conversion

When passing data between non-adjacent Layers, or when DTO structures differ, define conversions using the `From` / `Into` traits.

```rust
#[derive(Dto)]
pub struct RawEvent {
    pub source: String,
    pub payload: String,
    pub timestamp: u64,
}

#[derive(Dto)]
pub struct ProcessedEvent {
    pub source: String,
    pub data: serde_json::Value,
}

impl From<RawEvent> for ProcessedEvent {
    fn from(raw: RawEvent) -> Self {
        Self {
            source: raw.source,
            data: serde_json::from_str(&raw.payload).unwrap_or_default(),
        }
    }
}
```

## File Placement

DTOs are placed in the `src/dto/` directory.

```
src/
└── dto/
    ├── mod.rs          # pub mod declarations and common re-exports
    ├── fetch.rs        # FetchOutput, etc.
    ├── analyze.rs      # AnalyzeInput, AnalyzeOutput, etc.
    └── notify.rs       # NotifyInput, etc.
```

Re-exports in `mod.rs`:

```rust
mod fetch;
mod analyze;
mod notify;

pub use fetch::*;
pub use analyze::*;
pub use notify::*;
```

## Code Examples

### Basic DTOs

```rust
use smartcrab::Dto;

#[derive(Dto)]
pub struct ChatMessage {
    pub user_id: String,
    pub channel: String,
    pub content: String,
}

#[derive(Dto)]
pub struct AnalysisResult {
    pub needs_ai: bool,
    pub summary: String,
    pub confidence: f64,
}

#[derive(Dto)]
pub struct NotificationPayload {
    pub recipient: String,
    pub message: String,
}
```

### Nested DTOs

A DTO's fields can contain another DTO. The field types must also implement `Serialize` + `Deserialize`.

```rust
use smartcrab::Dto;

#[derive(Dto)]
pub struct Metadata {
    pub source: String,
    pub timestamp: u64,
}

#[derive(Dto)]
pub struct EnrichedEvent {
    pub metadata: Metadata,
    pub data: String,
    pub tags: Vec<String>,
}
```

### Enum DTOs

Enum types can also be defined as DTOs.

```rust
use smartcrab::Dto;

#[derive(Dto)]
pub enum ProcessingResult {
    Success { output: String },
    Skipped { reason: String },
    NeedsReview { details: String },
}
```
