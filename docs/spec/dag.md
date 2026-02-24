# DAG Specification

## 概要

DAG（Directed Acyclic Graph）は Layer の実行順序と条件分岐を定義するグラフ構造である。ビルダーパターンで構築し、`build()` で検証済みの実行可能な DAG を生成する。

## DagBuilder API

### `DagBuilder::new`

```rust
pub fn new(name: impl Into<String>) -> Self
```

新しい DagBuilder を作成する。`name` はトレースの span 名に使用される。

### `add_node`

```rust
pub fn add_node(self, layer: impl Layer + 'static) -> Self
```

DAG にノードを追加する。ノードの識別子は `layer.name()` の戻り値が使用される。同一名のノードが既に存在する場合、`build()` 時にエラーとなる。

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
    F: Fn(&dyn Dto) -> &str + Send + Sync + 'static,
    I: IntoIterator<Item = (&str, &str)>,
```

条件付きエッジを追加する。`from` ノードの出力 DTO を `condition` クロージャに渡し、戻り値に対応する分岐先ノードに遷移する。

**パラメータ:**

| パラメータ | 説明 |
|-----------|------|
| `from` | 分岐元ノードの名前 |
| `condition` | DTO の参照を受け取り、分岐先のラベル（`&str`）を返すクロージャ |
| `branches` | `(ラベル, 遷移先ノード名)` のペアのイテレータ |

### `build`

```rust
pub fn build(self) -> Result<Dag>
```

DAG を検証し、実行可能な `Dag` インスタンスを返す。検証に失敗した場合は `Err` を返す。

検証内容:
- 循環検出
- 到達不能ノード検出
- DTO 型整合性チェック
- 条件分岐の分岐先存在チェック
- Input Layer の存在チェック
- ノード名の一意性チェック

## 条件クロージャのシグネチャ

```rust
Fn(&dyn Dto) -> &str + Send + Sync + 'static
```

- 入力: 前段 Layer の出力 DTO の参照（`&dyn Dto`）
- 出力: 分岐先のラベル（`branches` のキーに対応）
- `Send + Sync`: 非同期タスク間で安全に共有可能
- `'static`: DAG のライフタイム中有効

## 実行セマンティクス

### 順序保証

- 無条件エッジ: `from` ノードが `Ok` を返した後に `to` ノードが実行される
- 条件付きエッジ: `from` ノードが `Ok` を返した後、条件クロージャが評価され、選択された分岐先のみが実行される
- 同一ノードから複数の無条件エッジが出ている場合、後続ノードは並列実行される

### 並列実行条件

以下の条件を全て満たす場合、ノードは並列実行される:

1. 共通の親ノードから複数の無条件エッジが出ている
2. 各後続ノード間に依存関係がない

```rust
// Node A → Node B, Node C が並列実行される例
let dag = DagBuilder::new("parallel_example")
    .add_node(a)
    .add_node(b)
    .add_node(c)
    .add_node(d)
    .add_edge("A", "B")
    .add_edge("A", "C")  // B と C は並列実行
    .add_edge("B", "D")
    .add_edge("C", "D")  // D は B, C 両方の完了を待つ
    .build()?;
```

### エラー時挙動

| 状況 | 挙動 |
|------|------|
| Layer が `Err` を返した | DAG 実行を即座に停止。エラーを呼び出し元に伝播 |
| 条件クロージャのパニック | `catch_unwind` でキャッチし、DAG エラーとして処理 |
| 条件クロージャが未知のラベルを返した | DAG エラー（`UnknownBranchLabel`） |

## 複数 DAG 同時実行

1 プロセスで複数の DAG を同時実行できる。

```rust
use smartcrab::runtime::Runtime;

let runtime = Runtime::new()
    .add_dag(http_dag)
    .add_dag(cron_dag)
    .add_dag(chat_dag);

// 全 DAG を並行実行（tokio::spawn で各 DAG を独立タスクとして起動）
runtime.run().await?;
```

### シグナルハンドリング

```rust
// Runtime::run() の内部動作
tokio::select! {
    result = futures::future::join_all(dag_tasks) => {
        // 全 DAG が正常完了
    }
    _ = tokio::signal::ctrl_c() => {
        // シャットダウンシグナル → 全 DAG に停止を通知
        shutdown_tx.send(())?;
    }
}
```

- SIGTERM / SIGINT 受信時、`broadcast` チャネルで全 DAG に停止を通知
- 実行中の Layer は完了を待つ（途中中断しない）
- 後続 Layer は実行しない

## バリデーション仕様

### `build()` 時の検証

| 検証項目 | エラー型 | 説明 |
|---------|---------|------|
| 循環検出 | `DagError::CycleDetected { path }` | DAG に循環パスが存在 |
| 到達不能ノード | `DagError::UnreachableNode { name }` | 入力ノードから到達不能 |
| 型不一致 | `DagError::TypeMismatch { from, to, expected, actual }` | エッジの DTO 型が不一致 |
| 分岐先不在 | `DagError::MissingBranch { from, label }` | 条件分岐のラベルに対応するノードがない |
| 入力ノードなし | `DagError::NoInputNode` | Input Layer が存在しない |
| 名前重複 | `DagError::DuplicateNodeName { name }` | 同名ノードが複数登録 |

### 実行時の検証

| 検証項目 | エラー型 | 説明 |
|---------|---------|------|
| 未知の分岐ラベル | `DagError::UnknownBranchLabel { from, label }` | 条件クロージャが未定義のラベルを返した |

## コード例

### 基本的な DAG

```rust
use smartcrab::prelude::*;

let dag = DagBuilder::new("simple_pipeline")
    .add_node(HttpInput::new("0.0.0.0:3000"))
    .add_node(DataProcessor::new())
    .add_node(JsonResponder::new())
    .add_edge("HttpInput", "DataProcessor")
    .add_edge("DataProcessor", "JsonResponder")
    .build()?;

dag.run().await?;
```

### 条件分岐 DAG

```rust
use smartcrab::prelude::*;

let dag = DagBuilder::new("ai_routing")
    .add_node(ChatInput::new(discord_token))
    .add_node(MessageAnalyzer::new())
    .add_node(AiResponder::new())
    .add_node(TemplateResponder::new())
    .add_node(DiscordOutput::new(discord_token))
    .add_edge("ChatInput", "MessageAnalyzer")
    .add_conditional_edge(
        "MessageAnalyzer",
        |output: &dyn Dto| {
            let result = output.downcast_ref::<AnalysisOutput>().unwrap();
            if result.complexity_score > 0.7 {
                "ai"
            } else {
                "template"
            }
        },
        [("ai", "AiResponder"), ("template", "TemplateResponder")],
    )
    .add_edge("AiResponder", "DiscordOutput")
    .add_edge("TemplateResponder", "DiscordOutput")
    .build()?;
```

### 複数 DAG 同時実行

```rust
use smartcrab::prelude::*;
use smartcrab::runtime::Runtime;

#[tokio::main]
async fn main() -> Result<()> {
    // DAG 1: HTTP API
    let api_dag = DagBuilder::new("api")
        .add_node(HttpInput::new("0.0.0.0:3000"))
        .add_node(RequestHandler::new())
        .add_node(JsonResponder::new())
        .add_edge("HttpInput", "RequestHandler")
        .add_edge("RequestHandler", "JsonResponder")
        .build()?;

    // DAG 2: 定期バッチ
    let batch_dag = DagBuilder::new("batch")
        .add_node(CronInput::new("0 */6 * * *"))
        .add_node(DataCollector::new())
        .add_node(AiSummarizer::new())
        .add_node(SlackNotifier::new(webhook))
        .add_edge("CronInput", "DataCollector")
        .add_edge("DataCollector", "AiSummarizer")
        .add_edge("AiSummarizer", "SlackNotifier")
        .build()?;

    // 全 DAG を並行実行
    Runtime::new()
        .add_dag(api_dag)
        .add_dag(batch_dag)
        .run()
        .await
}
```
