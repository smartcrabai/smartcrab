+++
title = "DirectedGraph Specification"
description = "DirectedGraph 仕様 — DirectedGraphBuilder API、実行セマンティクス、バリデーション"
weight = 3
+++

# sakoku-ignore-next-line
## 概要

# sakoku-ignore-next-line
DirectedGraph（有向グラフ）は Node の実行順序と条件分岐を定義するグラフ構造である。ビルダーパターンで構築し、`build()` で検証済みの実行可能な DirectedGraph を生成する。

# sakoku-ignore-next-line
DAG とは異なり、サイクル（有向閉路）を含むグラフもサポートする。

# sakoku-ignore-next-line
## DirectedGraphBuilder API

# sakoku-ignore-next-line
### `DirectedGraphBuilder::new`

```rust
pub fn new(name: impl Into<String>) -> Self
```

# sakoku-ignore-next-line
新しい DirectedGraphBuilder を作成する。`name` はトレースの span 名に使用される。

# sakoku-ignore-next-line
### `add_input`

```rust
pub fn add_input<L: InputNode>(self, node: L) -> Self
```

# sakoku-ignore-next-line
Input Node を追加する。

# sakoku-ignore-next-line
### `add_hidden`

```rust
pub fn add_hidden<L: HiddenNode>(self, node: L) -> Self
```

# sakoku-ignore-next-line
Hidden Node を追加する。

# sakoku-ignore-next-line
### `add_output`

```rust
pub fn add_output<L: OutputNode>(self, node: L) -> Self
```

# sakoku-ignore-next-line
Output Node を追加する。

# sakoku-ignore-next-line
### `add_edge`

```rust
pub fn add_edge(self, from: &str, to: &str) -> Self
```

# sakoku-ignore-next-line
無条件エッジを追加する。`from` ノードの実行完了後、`to` ノードが実行される。

# sakoku-ignore-next-line
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

# sakoku-ignore-next-line
条件付きエッジを追加する。`from` ノードの出力 DTO を `condition` クロージャに渡し、戻り値に対応する分岐先ノードに遷移する。

# sakoku-ignore-next-line
- `Some(branch_key)` → 指定されたブランチに遷移
# sakoku-ignore-next-line
- `None` → グラフ実行を終了

# sakoku-ignore-next-line
### `add_exit_condition`

```rust
pub fn add_exit_condition<F>(self, from: &str, condition: F) -> Self
where
    F: Fn(&dyn DtoObject) -> Option<String> + Send + Sync + 'static,
```

# sakoku-ignore-next-line
終了条件を追加する。`from` ノードの実行後に条件クロージャが評価され、`None` を返した場合はグラフ全体の実行を終了する。

# sakoku-ignore-next-line
### `build`

```rust
pub fn build(self) -> Result<DirectedGraph>
```

# sakoku-ignore-next-line
Graph を検証し、実行可能な `DirectedGraph` インスタンスを返す。検証に失敗した場合は `Err` を返す。

# sakoku-ignore-next-line
検証内容:
# sakoku-ignore-next-line
- DTO 型整合性チェック
# sakoku-ignore-next-line
- 条件分岐の分岐先存在チェック
# sakoku-ignore-next-line
- Input Node の存在チェック
# sakoku-ignore-next-line
- ノード名の一意性チェック

# sakoku-ignore-next-line
※ DAG と異なり、循環検出と到達不能ノード検出は行わない。

# sakoku-ignore-next-line
## 条件クロージャのシグネチャ

```rust
Fn(&dyn DtoObject) -> Option<String> + Send + Sync + 'static
```

# sakoku-ignore-next-line
- 入力: 前段 Node の出力 DTO の参照（`&dyn DtoObject`）
# sakoku-ignore-next-line
- 出力: 分岐先のラベル（`branches` のキーに対応）、または `None` で終了
# sakoku-ignore-next-line
- `Send + Sync`: 非同期タスク間で安全に共有可能
# sakoku-ignore-next-line
- `'static`: Graph のライフタイム中有効

# sakoku-ignore-next-line
## 実行セマンティクス

# sakoku-ignore-next-line
### 基本動作

# sakoku-ignore-next-line
Graph は以下のループで実行される:

# sakoku-ignore-next-line
1. 実行可能なノードを探す（全ての入力依存が完了している）
# sakoku-ignore-next-line
2. 実行可能なノードがない場合 → 終了
# sakoku-ignore-next-line
3. 実行可能なノードを並列実行
# sakoku-ignore-next-line
4. 各ノードの結果を保存
# sakoku-ignore-next-line
5. 終了条件をチェック（終了条件が `None` を返したら終了）
# sakoku-ignore-next-line
6. 1に戻る

# sakoku-ignore-next-line
### 依存関係の解決

# sakoku-ignore-next-line
- 無条件エッジ: `from` ノードの出力が `to` ノードの入力として使用される
# sakoku-ignore-next-line
- 条件付きエッジ: 条件の評価結果に基づいて分岐先が決定される

# sakoku-ignore-next-line
### 終了条件

# sakoku-ignore-next-line
以下のいずれかの条件でグラフの実行が終了する:

# sakoku-ignore-next-line
1. 実行可能なノードがなくなった場合
# sakoku-ignore-next-line
2. 終了条件（`add_exit_condition`）が `None` を返した場合
# sakoku-ignore-next-line
3. いずれかのノードがエラーを返した場合

# sakoku-ignore-next-line
## コード例

# sakoku-ignore-next-line
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

# sakoku-ignore-next-line
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

# sakoku-ignore-next-line
### サイクルを含む Graph

```rust
use smartcrab::prelude::*;

let graph = DirectedGraphBuilder::new("feedback_loop")
    .add_input(SourceNode::new())
    .add_hidden(ProcessNode::new())
    .add_hidden(FeedbackNode::new())
    .add_output(ExitNode::new())
    .add_edge("SourceNode", "ProcessNode")
    .add_edge("ProcessNode", "FeedbackNode")
# sakoku-ignore-next-line
    .add_edge("FeedbackNode", "FeedbackNode")  // 自己ループ
    .add_edge("FeedbackNode", "ExitNode")
    .add_exit_condition("FeedbackNode", |output| {
        if output.downcast_ref::<FeedbackOutput>().unwrap().should_continue {
            Some("continue".to_owned())
        } else {
# sakoku-ignore-next-line
            None  // 終了
        }
    })
    .build()?;
```

# sakoku-ignore-next-line
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

# sakoku-ignore-next-line
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

# sakoku-ignore-next-line
    // 全 Graph を並行実行
    Runtime::new()
        .add_graph(api_graph)
        .add_graph(batch_graph)
        .run()
        .await
}
```
