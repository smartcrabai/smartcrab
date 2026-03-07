+++
title = "CLI Tool Design"
description = "CLI ツール設計 — Rails ライク開発体験、コマンド体系、テンプレート"
weight = 5
+++

## 設計思想

SmartCrab CLI は Rails ライクな開発体験を提供する。開発者はフレームワークの内部で開発し、コードジェネレータにより定型コードの作成を自動化する。

### Rails との対比

| Rails | SmartCrab | 説明 |
|-------|-----------|------|
| `rails new` | `crab new` | プロジェクト生成 |
| `rails generate model` | `crab generate dto` | データ構造の生成 |
| `rails generate controller` | `crab generate layer` | 処理単位の生成 |
| N/A | `crab generate graph` | Graph 定義の生成 |
| `rails server` | `crab run` | アプリケーション実行 |

## コマンド体系

```
crab
├── new <project-name>       # 新規プロジェクト生成
├── generate (g)             # コードジェネレータ
│   ├── node <name>          # Node 生成
│   ├── dto <name>           # DTO 生成
│   └── graph <name>         # Graph 定義生成
├── viz [graph]              # Graph 定義の可視化
└── run                      # アプリケーション実行
```

### CLI フレームワーク

`clap` crate を使用する。

## プロジェクト生成テンプレート設計

`crab new <project-name>` で生成されるプロジェクト構造:

```
<project-name>/
├── Cargo.toml
├── SmartCrab.toml           # SmartCrab 設定ファイル
├── Dockerfile
├── compose.yml              # Jaeger 等の開発用サービス
├── src/
│   ├── main.rs              # エントリーポイント（Runtime 起動）
│   ├── dto/
│   │   └── mod.rs
│   ├── layer/
│   │   ├── mod.rs
│   │   ├── input/
│   │   │   └── mod.rs
│   │   ├── hidden/
│   │   │   └── mod.rs
│   │   └── output/
│   │       └── mod.rs
│   └── graph/
│       └── mod.rs
└── tests/
    └── integration/
        └── mod.rs
```

### 生成される `main.rs`

```rust
use smartcrab::prelude::*;
use smartcrab::runtime::Runtime;

mod dto;
mod node;
mod graph;

#[tokio::main]
async fn main() -> Result<()> {
    smartcrab::telemetry::init()?;

    Runtime::new()
        // .add_graph(graph::my_graph()?)
        .run()
        .await
}
```

### 生成される `SmartCrab.toml`

```toml
[project]
name = "<project-name>"
version = "0.1.0"

[telemetry]
enabled = true
exporter = "otlp"

[claude_code]
timeout_secs = 300
```

## Node ジェネレータ設計

`crab generate layer <name>` で Node のボイラープレートを生成する。

### 生成対象

| オプション | 生成ファイル |
|-----------|-------------|
| `--type input` | `src/node/input/<name>.rs` |
| `--type hidden` | `src/node/hidden/<name>.rs` |
| `--type output` | `src/node/output/<name>.rs` |

### 生成テンプレート例（Hidden Layer）

```rust
// src/node/hidden/{{name}}.rs
use smartcrab::prelude::*;
use crate::dto::{/*{ name | pascal_case }*/Input, /*{ name | pascal_case }*/Output};

pub struct /*{ name | pascal_case }*/ ;

impl Node for /*{ name | pascal_case }*/ {
    fn name(&self) -> &str {
        "/*{ name | pascal_case }*/"
    }
}

#[async_trait]
impl HiddenNode for /*{ name | pascal_case }*/ {
    type Input = /*{ name | pascal_case }*/Input;
    type Output = /*{ name | pascal_case }*/Output;

    async fn run(&self, input: Self::Input) -> Result<Self::Output> {
        todo!("Implement /*{ name | pascal_case }*/ logic")
    }
}
```

### Input Node のサブタイプ指定

```bash
crab generate layer webhook_receiver --type input --input-type http
crab generate layer daily_check --type input --input-type cron
crab generate layer discord_listener --type input --input-type chat
```

`--input-type` により、サブタイプに応じたボイラープレートが生成される。

### Output Node のサブタイプ指定

```bash
crab generate layer discord_notifier --type output --output-type discord
```

`--output-type discord` を指定すると、Discord Webhook への送信に必要なボイラープレート（`webhook_url` フィールド、メッセージ送信処理）があらかじめ含まれた状態で Node が生成される。

## DTO ジェネレータ設計

`crab generate dto <name>` で DTO 構造体を生成する。

### `--fields` オプション

```bash
crab generate dto analysis_result --fields "severity:String,score:f64,tags:Vec<String>"
```

生成結果:

```rust
use smartcrab::Dto;

#[derive(Dto)]
pub struct AnalysisResult {
    pub severity: String,
    pub score: f64,
    pub tags: Vec<String>,
}
```

`--fields` を省略した場合は空のフィールドで生成される。

## Graph ジェネレータ設計

`crab generate graph <name>` で Graph 定義関数のボイラープレートを生成する。

### 生成テンプレート

```rust
// src/graph/{{name}}.rs
use smartcrab::prelude::*;

pub fn /*{ name | snake_case }*/() -> Result<DirectedGraph> {
    DirectedGraphBuilder::new("/*{ name | snake_case }*/")
        // .add_node(...)
        // .add_edge(...)
        .build()
}
```

## テンプレートエンジン

コードジェネレータのテンプレートでは以下の変数が使用できる。

### テンプレート変数

| 変数 | 説明 | 例 |
|------|------|-----|
| `/*{ name }*/` | 入力された名前そのまま | `data_analyzer` |
| `/*{ name \| pascal_case }*/` | PascalCase 変換 | `DataAnalyzer` |
| `/*{ name \| snake_case }*/` | snake_case 変換 | `data_analyzer` |

### mod.rs の自動更新

ジェネレータは新しいファイルを生成するだけでなく、対応する `mod.rs` に `pub mod` 宣言を自動追加する。

```bash
$ crab generate layer data_analyzer --type hidden

Created: src/node/hidden/data_analyzer.rs
Updated: src/node/hidden/mod.rs  (added: pub mod data_analyzer;)
Created: src/dto/data_analyzer.rs  (DataAnalyzerInput, DataAnalyzerOutput)
Updated: src/dto/mod.rs  (added: pub mod data_analyzer;)
```
