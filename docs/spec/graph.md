# DirectedGraph Specification

## 概要

DirectedGraph（有向グラフ）は Layer の実行順序と条件分岐を定義するグラフ構造である。ビルダーパターンで構築し、`build()` で検証済みの実行可能な DirectedGraph を生成する。

DAG とは異なり、サイクル（有向閉路）を含むグラフもサポートする。

## DirectedGraphBuilder API

### `DirectedGraphBuilder::new`

```rust
pub fn new(name: impl Into<String>) -> Self
```

新しい DirectedGraphBuilder を作成する。`name` はトレースの span 名に使用される。

### `add_input`

```rust
pub fn add_input<L: InputLayer>(self, layer: L) -> Self
```

Input Layer を追加する。

### `add_hidden`

```rust
pub fn add_hidden<L: HiddenLayer>(self, layer: L) -> Self
```

Hidden Layer を追加する。

### `add_output`

```rust
pub fn add_output<L: OutputLayer>(self, layer: L) -> Self
```

Output Layer を追加する。

### `add_edge`

```rust
pub fn add_edge(self, from: &str, to: &str) -> Self
```

無条件エッジを追加する。`from` ノードの実行完了後、`to` ノードが実行される。

### `add_conditional_edge`

```rust
pub fn add_conditional_edge<F, I>(
    self,
    from: &str,
    condition: F,
    branches: I,
) -> Self
where
    F: Fn(&dyn DtoObject) -> Option<String> + Send + Sync + 'static,
    I: IntoIterator<Item = (String, String)>,
```

条件付きエッジを追加する。`from` ノードの出力 DTO を `condition` クロージャに渡し、戻り値に対応する分岐先ノードに遷移する。

- `Some(branch_key)` → 指定されたブランチに遷移
- `None` → グラフ実行を終了

### `add_exit_condition`

```rust
pub fn add_exit_condition<F>(self, from: &str, condition: F) -> Self
where
    F: Fn(&dyn Dto) -> Option<String> + Send + Sync + 'static,
```

終了条件を追加する。`from` ノードの実行後に条件クロージャが評価され、`None` を返した場合はグラフ全体の実行を終了する。

### `build`

```rust
pub fn build(self) -> Result<DirectedGraph>
```

Graph を検証し、実行可能な `DirectedGraph` インスタンスを返す。検証に失敗した場合は `Err` を返す。

検証内容:
- DTO 型整合性チェック
- 条件分岐の分岐先存在チェック
- Input Layer の存在チェック
- ノード名の一意性チェック

※ DAG と異なり、循環検出と到達不能ノード検出は行わない。

## 条件クロージャのシグネチャ

```rust
Fn(&dyn DtoObject) -> Option<String> + Send + Sync + 'static
```

- 入力: 前段 Layer の出力 DTO の参照（`&dyn DtoObject`）
- 出力: 分岐先のラベル（`branches` のキーに対応）、または `None` で終了
- `Send + Sync`: 非同期タスク間で安全に共有可能
- `'static`: Graph のライフタイム中有効

## 実行セマンティクス

### 基本動作

Graph は以下のループで実行される:

1. 実行可能なノードを探す（全ての入力依存が完了している）
2. 実行可能なノードがない場合 → 終了
3. 実行可能なノードを並列実行
4. 各ノードの結果を保存
5. 終了条件をチェック（終了条件が `None` を返したら終了）
6. 1に戻る

### 依存関係の解決

- 無条件エッジ: `from` ノードの出力が `to` ノードの入力として使用される
- 条件付きエッジ: 条件の評価結果に基づいて分岐先が決定される

### 終了条件

以下のいずれかの条件でグラフの実行が終了する:

1. 実行可能なノードがなくなった場合
2. 終了条件（`add_exit_condition`）が `None` を返した場合
3. いずれかのノードがエラーを返した場合

## コード例

### 基本的な Graph

```rust
use smartcrab::prelude::*;

let graph = DirectedGraphBuilder::new("simple_pipeline")
    .add_input(HttpInput::new("0.0.0.0:3000"))
    .add_hidden(DataProcessor::new())
    .add_output(JsonResponder::new())
    .add_edge("HttpInput", "DataProcessor")
    .add_edge("DataProcessor", "JsonResponder")
    .build()?;

graph.run().await?;
```

### 条件分岐 Graph

```rust
use smartcrab::prelude::*;

let graph = DirectedGraphBuilder::new("ai_routing")
    .add_input(ChatInput::new(discord_token))
    .add_hidden(MessageAnalyzer::new())
    .add_hidden(AiResponder::new())
    .add_hidden(TemplateResponder::new())
    .add_output(DiscordOutput::new(discord_token))
    .add_edge("ChatInput", "MessageAnalyzer")
    .add_conditional_edge(
        "MessageAnalyzer",
        |output: &dyn DtoObject| {
            let result = output.downcast_ref::<AnalysisOutput>().unwrap();
            if result.complexity_score > 0.7 {
                Some("ai".to_owned())
            } else {
                Some("template".to_owned())
            }
        },
        vec![("ai".to_owned(), "AiResponder".to_owned()), ("template".to_owned(), "TemplateResponder".to_owned())],
    )
    .add_edge("AiResponder", "DiscordOutput")
    .add_edge("TemplateResponder", "DiscordOutput")
    .build()?;
```

### サイクルを含む Graph

```rust
use smartcrab::prelude::*;

let graph = DirectedGraphBuilder::new("feedback_loop")
    .add_input(SourceLayer)
    .add_hidden(ProcessLayer)
    .add_hidden(FeedbackLayer)
    .add_output(ExitLayer)
    .add_edge("Source", "Process")
    .add_edge("Process", "Feedback")
    .add_edge("Feedback", "Feedback")  // 自己ループ
    .add_edge("Feedback", "Exit")
    .add_exit_condition("Feedback", |output| {
        if output.downcast_ref::<FeedbackOutput>().unwrap().should_continue {
            Some("continue".to_owned())
        } else {
            None  // 終了
        }
    })
    .build()?;
```

### 複数 Graph 同時実行

```rust
use smartcrab::prelude::*;
use smartcrab::runtime::Runtime;

#[tokio::main]
async fn main() -> Result<()> {
    // Graph 1: HTTP API
    let api_graph = DirectedGraphBuilder::new("api")
        .add_input(HttpInput::new("0.0.0.0:3000"))
        .add_hidden(RequestHandler::new())
        .add_output(JsonResponder::new())
        .add_edge("HttpInput", "RequestHandler")
        .add_edge("RequestHandler", "JsonResponder")
        .build()?;

    // Graph 2: 定期バッチ
    let batch_graph = DirectedGraphBuilder::new("batch")
        .add_input(CronInput::new("0 */6 * * * * *"))
        .add_hidden(DataCollector::new())
        .add_hidden(AiSummarizer::new())
        .add_output(SlackNotifier::new(webhook))
        .add_edge("CronInput", "DataCollector")
        .add_edge("DataCollector", "AiSummarizer")
        .add_edge("AiSummarizer", "SlackNotifier")
        .build()?;

    // 全 Graph を並行実行
    Runtime::new()
        .add_graph(api_graph)
        .add_graph(batch_graph)
        .run()
        .await
}
```
