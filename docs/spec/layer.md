# Layer Specification

## 概要

Layer は DAG 内の処理単位（ノード）であり、SmartCrab アプリケーションのビジネスロジックを記述する場所である。Input / Hidden / Output の 3 種があり、それぞれ異なるシグネチャを持つ。

## 共通 Layer トレイト

全 Layer が実装するベーストレイト。

```rust
pub trait Layer: Send + Sync + 'static {
    /// Layer の識別名（トレースの span 名に使用）
    fn name(&self) -> &str;
}
```

## Input Layer

外部イベントを受けて DTO を生成する。DAG のエントリーポイントとなる。

### トレイト定義

```rust
#[async_trait]
pub trait InputLayer: Layer {
    type Output: Dto;

    async fn run(&self) -> Result<Self::Output>;
}
```

### サブタイプ

Input Layer には 3 つのサブタイプがある。これらはトレイトではなく実装パターンとして区別される。

| サブタイプ | トリガー | 用途例 |
|-----------|---------|--------|
| **chat** | Discord DM / メンション等 | チャットボット |
| **cron** | 時刻ベースのスケジュール | 定期バッチ処理 |
| **http** | HTTP リクエスト受信 | Web API |

### コード例

```rust
use smartcrab::prelude::*;

pub struct HttpInput {
    addr: SocketAddr,
}

impl Layer for HttpInput {
    fn name(&self) -> &str {
        "HttpInput"
    }
}

#[async_trait]
impl InputLayer for HttpInput {
    type Output = HttpRequestDto;

    async fn run(&self) -> Result<Self::Output> {
        // HTTPサーバーを起動し、リクエストを待ち受ける
        let request = self.accept_request().await?;
        Ok(HttpRequestDto {
            method: request.method().to_string(),
            path: request.uri().path().to_string(),
            body: request.body_string().await?,
        })
    }
}
```

## Hidden Layer

DTO を受け取り、変換・加工して DTO を返す中間処理 Layer。Claude Code を子プロセスとして呼び出すことができる。

### トレイト定義

```rust
#[async_trait]
pub trait HiddenLayer: Layer {
    type Input: Dto;
    type Output: Dto;

    async fn run(&self, input: Self::Input) -> Result<Self::Output>;
}
```

### Claude Code ヘルパー

Hidden Layer から Claude Code を呼び出すためのヘルパー関数を提供する。

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
pub trait OutputLayer: Layer {
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

impl Layer for SlackNotifier {
    fn name(&self) -> &str {
        "SlackNotifier"
    }
}

#[async_trait]
impl OutputLayer for SlackNotifier {
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
| Layer 構造体名 | PascalCase、役割を表す名前 | `HttpInput`, `DataAnalyzer`, `SlackNotifier` |
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
