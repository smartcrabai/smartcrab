+++
title = "Layer Specification"
description = "Layer 仕様 — Input/Hidden/Output 各 Node のトレイト定義とコード例"
weight = 1
+++

## 概要

Layer は Graph 内の処理単位（ノード）であり、SmartCrab アプリケーションのビジネスロジックを記述する場所である。Input / Hidden / Output の 3 種があり、それぞれ異なるシグネチャを持つ。

## 共通 Node トレイト

全 Node が実装するベーストレイト。

```rust
pub trait Layer: Send + Sync + 'static {
    /// Node の識別名（トレースの span 名に使用）
    fn name(&self) -> &str;
}
```

## Input Layer

外部イベントを受けて DTO を生成する。Graph のエントリーポイントとなる。

### トレイト定義

```rust
#[async_trait]
pub trait InputNode: Node {
    /// トリガーデータの型（通常は `()` を使用）。
    type TriggerData: Dto;
    type Output: Dto;

    async fn run(&self, trigger: Self::TriggerData) -> Result<Self::Output>;
}
```

### TriggerKind

`DirectedGraphBuilder::trigger()` で発火タイミングを明示する。

```rust
pub enum TriggerKind {
    /// アプリ起動時に一度だけ実行。
    Startup,
    /// チャットイベント（Discord メンション・DM 等）で実行。
    Chat { triggers: Vec<String> },
    /// cron スケジュールで実行。
    Cron { schedule: String },
}
```

### サブタイプ

Input Node には 3 つのサブタイプがある。これらはトレイトではなく実装パターンとして区別される。

| サブタイプ | TriggerKind | 用途例 |
|-----------|------------|--------|
| **startup** | `Startup` | サービス起動時の初期化処理 |
| **chat** | `Chat { triggers: vec!["mention", "dm"] }` | Discord チャットボット |
| **cron** | `Cron { schedule: "0 * * * * * *" }` | 定期バッチ処理 |

### コード例

```rust
use smartcrab::prelude::*;

pub struct DiscordInput;

impl Node for DiscordInput {
    fn name(&self) -> &str {
        "DiscordInput"
    }
}

#[async_trait]
impl InputNode for DiscordInput {
    type TriggerData = ();
    type Output = DiscordMessage;

    async fn run(&self, _: ()) -> Result<Self::Output> {
        // Discord ゲートウェイからメッセージを受信する
        todo!("Implement Discord message listener")
    }
}
```

## Hidden Layer

DTO を受け取り、変換・加工して DTO を返す中間処理 Layer。Claude Code を子プロセスとして呼び出すことができる。

### トレイト定義

```rust
#[async_trait]
pub trait HiddenNode: Node {
    type Input: Dto;
    type Output: Dto;

    async fn run(&self, input: Self::Input) -> Result<Self::Output>;
}
```

### Claude Code ヘルパー

Hidden Node から Claude Code を呼び出すためのヘルパー関数を提供する。

```rust
use smartcrab::claude::ClaudeCode;

pub struct AiAnalysis;

impl Node for AiAnalysis {
    fn name(&self) -> &str {
        "AiAnalysis"
    }
}

#[async_trait]
impl HiddenNode for AiAnalysis {
    type Input = AnalysisInput;
    type Output = AnalysisOutput;

    async fn run(&self, input: Self::Input) -> Result<Self::Output> {
        let prompt = format!(
            "以下のデータを分析してJSON形式で結果を返してください:\n{}",
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

DTO を受け取り、最終的な副作用（通知、保存、応答等）を実行する。Claude Code を子プロセスとして呼び出すことができる。

### トレイト定義

```rust
#[async_trait]
pub trait OutputNode: Node {
    type Input: Dto;

    async fn run(&self, input: Self::Input) -> Result<()>;
}
```

### コード例

```rust
use smartcrab::prelude::*;

pub struct SlackNotifier {
    webhook_url: String,
}

impl Node for SlackNotifier {
    fn name(&self) -> &str {
        "SlackNotifier"
    }
}

#[async_trait]
impl OutputNode for SlackNotifier {
    type Input = NotificationPayload;

    async fn run(&self, input: Self::Input) -> Result<()> {
        // Slack Webhook にメッセージを送信
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

### Claude Code を使った Output Layer

```rust
pub struct AiReport;

impl Node for AiReport {
    fn name(&self) -> &str {
        "AiReport"
    }
}

#[async_trait]
impl OutputNode for AiReport {
    type Input = ReportData;

    async fn run(&self, input: Self::Input) -> Result<()> {
        let prompt = format!(
            "以下のデータからレポートを生成し、report.md に書き出してください:\n{}",
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

## 命名規約

| 要素 | 規約 | 例 |
|------|------|-----|
| Node 構造体名 | PascalCase、役割を表す名前 | `HttpInput`, `DataAnalyzer`, `SlackNotifier` |
| `name()` 戻り値 | 構造体名と同一 | `"HttpInput"`, `"DataAnalyzer"` |
| ファイル名 | snake_case | `http_input.rs`, `data_analyzer.rs` |

## ファイル配置規約

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
