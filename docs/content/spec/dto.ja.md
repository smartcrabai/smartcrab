+++
title = "DTO Specification"
description = "DTO 仕様 — Dto トレイト、命名規約、変換、コード例"
weight = 2
+++

## 概要

DTO（Data Transfer Object）は Layer 間のデータ受け渡しに使う型安全な Rust 構造体である。`Dto` トレイトを実装することで、フレームワークが要求するシリアライズ・クローン・スレッド安全性を保証する。

## Dto トレイト定義

`Dto` はマーカートレイトであり、必要な境界をスーパートレイトとして要求する。

```rust
use serde::{Deserialize, Serialize};
use std::fmt::Debug;

pub trait Dto: Serialize + for<'de> Deserialize<'de> + Clone + Debug + Send + Sync + 'static {}
```

### derive マクロ

`Dto` トレイトの実装を簡略化する derive マクロを提供する。

```rust
use smartcrab::Dto;

#[derive(Dto)]
pub struct MyData {
    pub message: String,
    pub count: u32,
}
```

上記は以下と等価:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MyData {
    pub message: String,
    pub count: u32,
}

impl Dto for MyData {}
```

## 命名規約

DTO はそれを生成する Layer の名前に基づいて命名する。

| パターン | 説明 | 例 |
|---------|------|-----|
| `<LayerName>Input` | Layer の入力 DTO | `AnalyzerInput` |
| `<LayerName>Output` | Layer の出力 DTO | `AnalyzerOutput` |

Layer の `Input` 関連型は前段 Layer の `Output` DTO と一致する。このため、隣接する Layer 間で同一の DTO 型を共有することが一般的である。

```
FetchLayer::Output = FetchOutput
AnalyzeLayer::Input = FetchOutput   ← 同一の型
AnalyzeLayer::Output = AnalyzeOutput
```

## DTO 間変換

隣接しない Layer 間でデータを受け渡す場合や、DTO の構造が異なる場合は `From` / `Into` トレイトで変換を定義する。

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

## ファイル配置

DTO は `src/dto/` ディレクトリに配置する。

```
src/
└── dto/
    ├── mod.rs          # pub mod 宣言と共通 re-export
    ├── fetch.rs        # FetchOutput 等
    ├── analyze.rs      # AnalyzeInput, AnalyzeOutput 等
    └── notify.rs       # NotifyInput 等
```

`mod.rs` での re-export:

```rust
mod fetch;
mod analyze;
mod notify;

pub use fetch::*;
pub use analyze::*;
pub use notify::*;
```

## コード例

### 基本的な DTO

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

### ネストした DTO

DTO のフィールドに別の DTO を含めることができる。フィールドの型も `Serialize` + `Deserialize` を実装している必要がある。

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

### Enum DTO

Enum 型の DTO も定義可能。

```rust
use smartcrab::Dto;

#[derive(Dto)]
pub enum ProcessingResult {
    Success { output: String },
    Skipped { reason: String },
    NeedsReview { details: String },
}
```
