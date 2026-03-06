+++
title = "Data Flow"
description = "データフロー設計 — Node 間のデータの流れ、型安全性、エラーハンドリング"
weight = 2
+++

## 全体フロー

SmartCrab のデータフローは Input → DTO → Hidden → DTO → Output の流れで構成される。各 Node 間のデータ受け渡しは型安全な DTO を介して行われる。

{% mermaid() %}
flowchart LR
    subgraph Input["Input Layer"]
        I[chat / cron / http]
    end
    subgraph DTO1["DTO"]
        D1["InputOutput"]
    end
    subgraph Hidden["Hidden Layer"]
        H[変換・加工・AI判定]
    end
    subgraph DTO2["DTO"]
        D2["HiddenOutput"]
    end
    subgraph Output["Output Layer"]
        O[通知・保存・応答]
    end

    I -->|"Result&lt;DTO&gt;"| D1
    D1 -->|"DTO"| H
    H -->|"Result&lt;DTO&gt;"| D2
    D2 -->|"DTO"| O
    O -->|"Result&lt;()&gt;"| Done["完了"]
{% end %}

## Node のシグネチャ設計

各 Node はジェネリクスで入出力の DTO 型を指定する。

```rust
// Input Layer: 入力なし → DTO を生成
#[async_trait]
pub trait InputNode: Send + Sync {
    type Output: Dto;
    async fn run(&self) -> Result<Self::Output>;
}

// Hidden Layer: DTO を受け取り → DTO を返す
#[async_trait]
pub trait HiddenNode: Send + Sync {
    type Input: Dto;
    type Output: Dto;
    async fn run(&self, input: Self::Input) -> Result<Self::Output>;
}

// Output Layer: DTO を受け取り → 副作用を実行
#[async_trait]
pub trait OutputNode: Send + Sync {
    type Input: Dto;
    async fn run(&self, input: Self::Input) -> Result<()>;
}
```

## 条件分岐におけるデータフロー

条件付きエッジでは、先行 Node の出力 DTO を参照して分岐先を決定する。クロージャはDTO の参照を受け取り、分岐先の識別子を返す。

{% mermaid() %}
flowchart TD
    A[Hidden Node A] -->|"AnalysisOutput"| Cond{"条件判定クロージャ<br/>Fn(&AnalysisOutput) → &str"}
    Cond -->|"needs_ai"| B[Hidden Node B<br/>Claude Code 呼び出し]
    Cond -->|"simple"| C[Hidden Node C<br/>通常処理]
    B --> D[Output Layer]
    C --> D
{% end %}

### 条件クロージャのシグネチャ

```rust
// 条件クロージャは DTO の参照を受け取り、分岐先のエッジラベルを返す
Fn(&dyn Dto) -> &str
```

条件クロージャが返す文字列は `add_conditional_edge` で定義した分岐先マップのキーに対応する。

## エラーハンドリング戦略

エラーは 2 つのレベルで処理される。

### Node 内エラー

各 Node の `run` メソッドは `Result` を返す。Layer 内で発生するエラーは Node の責務で適切な `Error` 型に変換する。

```rust
// Node 内でのエラーハンドリング例
async fn run(&self, input: Self::Input) -> Result<Self::Output> {
    let response = self.client.get(&input.url)
        .await
        .map_err(|e| SmartCrabError::LayerExecution {
            layer: "FetchData",
            source: e.into(),
        })?;
    // ...
}
```

### Graph レベルエラー

Layer が `Err` を返した場合、Graph エンジンは実行を停止し、エラーを呼び出し元に伝播する。

{% mermaid() %}
flowchart TD
    A[Layer A] -->|Ok| B[Layer B]
    B -->|Err| Stop["Graph 実行停止<br/>エラーをトレースに記録"]
    B -->|Ok| C[Layer C]
    C -->|Ok| Done["完了"]
{% end %}

- エラー発生時、該当 Node の span にエラー情報が記録される
- Graph は即座に実行を停止する（後続の Node は実行されない）
- 他の Graph の実行には影響しない（Graph 間は独立）

## 型安全性の保証範囲

### コンパイル時保証

- 各 Node の `Input` / `Output` 関連型による DTO 型の一致
- `Dto` トレイトの derive 要件（`Serialize`, `Deserialize`, `Clone`, `Send`, `Sync`）

### 実行時検証

- Graph ビルド時のエッジの型整合性チェック（隣接 Node の Output 型と Input 型の一致）
- 条件分岐の網羅性チェック（全分岐先が存在するか）
- Graph の構造検証（循環検出、到達不能ノード検出）

```
コンパイル時                     実行時（Graph ビルド時）
┌─────────────────────┐      ┌──────────────────────────┐
│ Node の型パラメータ  │      │ エッジの型整合性           │
│ Dto の derive 要件    │      │ 条件分岐の網羅性           │
│ Send + Sync 境界     │      │ Graph 構造検証（循環、到達性） │
└─────────────────────┘      └──────────────────────────┘
```

型パラメータによる静的チェックで可能な範囲の安全性をコンパイル時に保証し、Graph の構造に関する検証は `build()` 時に実行時チェックとして行う。
