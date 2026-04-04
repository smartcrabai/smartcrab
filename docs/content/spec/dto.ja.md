+++
title = "DTO Specification"
description = "DTO 仕様 — Dto トレイト、命名規約、変換、コード例"
weight = 2
+++

# sakoku-ignore-next-line
## 概要

# sakoku-ignore-next-line
DTO（Data Transfer Object）は Node 間のデータ受け渡しに使う型安全な Rust 構造体である。 `Dto` トレイトを実装することで、フレームワークが要求するシリアライズ・クローン・スレッド安全性を保証する。

# sakoku-ignore-next-line
## Dto トレイト定義

# sakoku-ignore-next-line
`Dto` はマーカートレイトであり、必要な境界をスーパートレイトとして要求する。

```rust
use serde::{Deserialize, Serialize};
use std::fmt::Debug;

pub trait Dto: Serialize + for<'de> Deserialize<'de> + Clone + Debug + Send + Sync + 'static {}
```

# sakoku-ignore-next-line
### derive マクロ

# sakoku-ignore-next-line
`Dto` トレイトの実装を簡略化する derive マクロを提供する。

```rust
use smartcrab::Dto;

#[derive(Dto)]
pub struct MyData {
    pub message: String,
    pub count: u32,
}
```

# sakoku-ignore-next-line
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

# sakoku-ignore-next-line
## 命名規約

# sakoku-ignore-next-line
DTO はそれを生成する Node の名前に基づいて命名する。

# sakoku-ignore-next-line
| パターン | 説明 | 例 |
|---------|------|-----|
# sakoku-ignore-next-line
| `<NodeName>Input` | Node の入力 DTO | `AnalyzerInput` |
# sakoku-ignore-next-line
| `<NodeName>Output` | Node の出力 DTO | `AnalyzerOutput` |

# sakoku-ignore-next-line
Node の `Input` 関連型は前段 Node の `Output` DTO と一致する。このため、隣接する Node 間で同一の DTO 型を共有することが一般的である。

```
# sakoku-ignore-next-line
FetchLayer::Output = FetchOutput
# sakoku-ignore-next-line
AnalyzeLayer::Input = FetchOutput   ← 同一の型
AnalyzeLayer::Output = AnalyzeOutput
```

# sakoku-ignore-next-line
## DTO 間変換

# sakoku-ignore-next-line
隣接しない Node 間でデータを受け渡す場合や、DTO の構造が異なる場合は `From` / `Into` トレイトで変換を定義する。

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

# sakoku-ignore-next-line
## ファイル配置

# sakoku-ignore-next-line
DTO は `src/dto/` ディレクトリに配置する。

```
# sakoku-ignore-next-line
src/
# sakoku-ignore-next-line
└── dto/
# sakoku-ignore-next-line
    ├── mod.rs          # pub mod 宣言と共通 re-export
# sakoku-ignore-next-line
    ├── fetch.rs        # FetchOutput 等
# sakoku-ignore-next-line
    ├── analyze.rs      # AnalyzeInput, AnalyzeOutput 等
# sakoku-ignore-next-line
    └── notify.rs       # NotifyInput 等
```

# sakoku-ignore-next-line
`mod.rs` での re-export:

```rust
mod fetch;
mod analyze;
mod notify;

pub use fetch::*;
pub use analyze::*;
pub use notify::*;
```

# sakoku-ignore-next-line
## コード例

# sakoku-ignore-next-line
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

# sakoku-ignore-next-line
### ネストした DTO

# sakoku-ignore-next-line
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

# sakoku-ignore-next-line
### Enum DTO

# sakoku-ignore-next-line
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
