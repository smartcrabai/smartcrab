+++
title = "Graph Engine"
description = "Graph エンジン設計 — 実行エンジン、条件分岐、検証、ライフサイクル"
weight = 3
+++

# sakoku-ignore-next-line
## 概念モデル

# sakoku-ignore-next-line
SmartCrab の Graph（有向グラフ）は、Node の実行順序と条件分岐を定義するグラフ構造である。

# sakoku-ignore-next-line
- **Node**: 1 つの Node に対応する。実行時に Node の `run` メソッドを呼び出す
# sakoku-ignore-next-line
- **Edge**: Node 間の遷移を表す。無条件エッジと条件付きエッジの 2 種がある

{% mermaid() %}
# sakoku-ignore-next-line
flowchart TD
# sakoku-ignore-next-line
    subgraph Graph
        A["Node A<br/>(Input Node)"]
        B["Node B<br/>(Hidden Node)"]
        C["Node C<br/>(Hidden Node)"]
        D["Node D<br/>(Output Node)"]

# sakoku-ignore-next-line
        A -->|"無条件エッジ"| B
# sakoku-ignore-next-line
        B -->|"条件付きエッジ<br/>needs_ai = true"| C
# sakoku-ignore-next-line
        B -->|"条件付きエッジ<br/>needs_ai = false"| D
# sakoku-ignore-next-line
        C -->|"無条件エッジ"| D
    end
{% end %}

# sakoku-ignore-next-line
## ビルダーパターン API 設計

# sakoku-ignore-next-line
Graph はビルダーパターンで構築する。メソッドチェーンにより宣言的に定義でき、最後に `build()` で検証済みの Graph を生成する。

```rust
let graph = DirectedGraphBuilder::new("my_pipeline")
    .add_input(HttpInput::new(addr))
    .add_hidden(DataAnalyzer::new())
    .add_hidden(AiProcessor::new())
    .add_hidden(SimpleProcessor::new())
    .add_output(SlackNotifier::new(webhook))
    .add_edge("HttpInput", "DataAnalyzer")
    .add_conditional_edge(
        "DataAnalyzer",
        |output: &AnalysisOutput| {
            if output.needs_ai { "ai" } else { "simple" }
        },
        [
            ("ai", "AiProcessor"),
            ("simple", "SimpleProcessor"),
        ],
    )
    .add_edge("AiProcessor", "SlackNotifier")
    .add_edge("SimpleProcessor", "SlackNotifier")
    .build()?;
```

# sakoku-ignore-next-line
### 設計方針

# sakoku-ignore-next-line
- **型消去**: `add_input` / `add_hidden` / `add_output` は各 Node trait を受け取り、内部で `Box<dyn Layer>` として保持する。これにより異なる型の Node を同一の Graph に混在できる
# sakoku-ignore-next-line
- **名前ベースの参照**: エッジは Node の `name()` で Node を参照する。型パラメータの爆発を避けるための設計判断
# sakoku-ignore-next-line
- **遅延検証**: 型整合性やグラフ構造の検証は `build()` 時にまとめて実行する

# sakoku-ignore-next-line
## 実行エンジン設計

# sakoku-ignore-next-line
### トポロジカルソート

# sakoku-ignore-next-line
`build()` 時に Graph のノードをトポロジカルソートし、実行順序を決定する。

{% mermaid() %}
# sakoku-ignore-next-line
flowchart TD
# sakoku-ignore-next-line
    subgraph "トポロジカルソート結果"
        direction TB
        Step1["Step 1: HttpInput"]
        Step2["Step 2: DataAnalyzer"]
# sakoku-ignore-next-line
        Step3["Step 3a: AiProcessor / Step 3b: SimpleProcessor<br/>(条件分岐)"]
        Step4["Step 4: SlackNotifier"]
    end
    Step1 --> Step2 --> Step3 --> Step4
{% end %}

# sakoku-ignore-next-line
### 実行フロー

{% mermaid() %}
# sakoku-ignore-next-line
flowchart TD
# sakoku-ignore-next-line
    Start([Graph 実行開始]) --> ExecNode[現在の Node を実行]
# sakoku-ignore-next-line
    ExecNode --> CheckResult{Result は?}
# sakoku-ignore-next-line
    CheckResult -->|Ok| HasEdge{後続エッジは?}
# sakoku-ignore-next-line
    CheckResult -->|Err| Error([エラー: Graph 停止])
# sakoku-ignore-next-line
    HasEdge -->|無条件エッジ| NextNode[次の Node へ]
# sakoku-ignore-next-line
    HasEdge -->|条件付きエッジ| EvalCond[条件クロージャを評価]
# sakoku-ignore-next-line
    HasEdge -->|エッジなし| Done([Graph 完了])
# sakoku-ignore-next-line
    EvalCond --> SelectBranch[分岐先 Node を選択]
    SelectBranch --> NextNode
    NextNode --> ExecNode
{% end %}

# sakoku-ignore-next-line
### 並列実行

# sakoku-ignore-next-line
同一 Node から複数の無条件エッジが出ている場合、後続 Node を並列実行できる。

{% mermaid() %}
flowchart TD
    A[Node A] --> B[Node B]
    A --> C[Node C]
    B --> D[Node D]
    C --> D
{% end %}

# sakoku-ignore-next-line
上記の場合、Node B と Node C は並列実行される。Node D は B と C の両方が完了してから実行される。

# sakoku-ignore-next-line
## 条件分岐の実装設計

# sakoku-ignore-next-line
### AI 起動判定パターン

# sakoku-ignore-next-line
SmartCrab の中核機能は「条件に基づいて AI を起動するかどうかを判断する」ことである。典型的なパターン:

{% mermaid() %}
# sakoku-ignore-next-line
flowchart TD
# sakoku-ignore-next-line
    Input[Input Layer<br/>イベント受信] --> Analyze[Hidden Layer<br/>ルールベース分析]
# sakoku-ignore-next-line
    Analyze --> Cond{"条件判定<br/>AIが必要か?"}
# sakoku-ignore-next-line
    Cond -->|"needs_ai"| AI[Hidden Layer<br/>Claude Code 実行]
# sakoku-ignore-next-line
    Cond -->|"simple"| Simple[Hidden Layer<br/>テンプレート応答]
    AI --> Output[Output Layer]
    Simple --> Output
{% end %}

# sakoku-ignore-next-line
条件判定の例:

```rust
# sakoku-ignore-next-line
// 複雑度スコアに基づく AI 起動判定
|output: &AnalysisOutput| {
    if output.complexity_score > 0.7 { "needs_ai" } else { "simple" }
}

# sakoku-ignore-next-line
// キーワードに基づく判定
|output: &AnalysisOutput| {
    if output.requires_reasoning { "needs_ai" } else { "simple" }
}

# sakoku-ignore-next-line
// 複数の分岐先
|output: &ClassificationOutput| {
    match output.category.as_str() {
        "bug_report" => "ai_triage",
        "feature_request" => "template_response",
        "question" => "ai_answer",
        _ => "fallback",
    }
}
```

# sakoku-ignore-next-line
## Graph 検証

# sakoku-ignore-next-line
`build()` 時に以下の検証を実行する。いずれかの検証に失敗した場合は `Err` を返す。

# sakoku-ignore-next-line
### 循環検出

# sakoku-ignore-next-line
`build()` 時に深さ優先探索（DFS）で循環を検出する。

# sakoku-ignore-next-line
### 到達不能ノード検出

# sakoku-ignore-next-line
入力ノード（入次数 0 のノード）から到達できないノードを検出する。

# sakoku-ignore-next-line
### 型整合性チェック

# sakoku-ignore-next-line
エッジで接続された 2 つの Node について、`build()` 時に前段の `Output` 型と後段の `Input` 型の一致を検証する。

# sakoku-ignore-next-line
### 検証エラーの種類

# sakoku-ignore-next-line
| エラー | 説明 |
|--------|------|
# sakoku-ignore-next-line
| `CycleDetected` | Graph に循環が存在する |
# sakoku-ignore-next-line
| `UnreachableNode` | 入力ノードから到達不能なノードが存在する |
# sakoku-ignore-next-line
| `TypeMismatch` | 隣接ノード間の DTO 型が不一致 |
# sakoku-ignore-next-line
| `MissingBranch` | 条件付きエッジの分岐先ノードが存在しない |
# sakoku-ignore-next-line
| `NoInputNode` | Graph に入力ノード（Input Layer）が存在しない |
# sakoku-ignore-next-line
| `DuplicateNodeName` | 同一名のノードが複数登録されている |

# sakoku-ignore-next-line
## Graph ライフサイクル

{% mermaid() %}
# sakoku-ignore-next-line
stateDiagram-v2
    [*] --> Building: DirectedGraphBuilder::new()
    Building --> Building: add_input / add_hidden / add_output / add_edge
# sakoku-ignore-next-line
    Building --> Ready: build() 成功
# sakoku-ignore-next-line
    Building --> [*]: build() 失敗（検証エラー）
# sakoku-ignore-next-line
    Ready --> Running: run()
# sakoku-ignore-next-line
    Running --> Running: Node 実行中
# sakoku-ignore-next-line
    Running --> Completed: 全 Node 完了
# sakoku-ignore-next-line
    Running --> Failed: Node がエラーを返した
# sakoku-ignore-next-line
    Running --> ShuttingDown: シャットダウンシグナル受信
# sakoku-ignore-next-line
    ShuttingDown --> Failed: 現在の Node 完了後に停止
    Completed --> [*]
    Failed --> [*]
{% end %}

# sakoku-ignore-next-line
### グレースフルシャットダウン

# sakoku-ignore-next-line
SIGTERM / SIGINT を受信した場合:

# sakoku-ignore-next-line
1. 実行中の Node の完了を待つ（途中で中断しない）
# sakoku-ignore-next-line
2. 後続の Node は実行しない
# sakoku-ignore-next-line
3. OpenTelemetry の span をクローズし、トレースをフラッシュする
# sakoku-ignore-next-line
4. 終了コード 0 で終了する

# sakoku-ignore-next-line
複数 Graph が同時実行されている場合、シャットダウンシグナルは全 Graph に伝播する。
