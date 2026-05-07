+++
title = "Data Flow"
description = "データフロー設計 — Node 間のデータの流れ、型安全性、エラーハンドリング"
weight = 2
+++

# sakoku-ignore-next-line
## 全体フロー

# sakoku-ignore-next-line
SmartCrab のデータフローは Input → DTO → Hidden → DTO → Output の流れで構成される。各 Node 間のデータ受け渡しは型安全な DTO を介して行われる。

{% mermaid() %}
# sakoku-ignore-next-line
flowchart TD
# sakoku-ignore-next-line
    subgraph Input["Input Layer"]
        I[chat / cron / http]
    end
# sakoku-ignore-next-line
    subgraph DTO1["DTO"]
        D1["InputOutput"]
    end
# sakoku-ignore-next-line
    subgraph Hidden["Hidden Layer"]
# sakoku-ignore-next-line
        H[変換・加工・AI判定]
    end
# sakoku-ignore-next-line
    subgraph DTO2["DTO"]
        D2["HiddenOutput"]
    end
# sakoku-ignore-next-line
    subgraph Output["Output Layer"]
# sakoku-ignore-next-line
        O[通知・保存・応答]
    end

    I -->|"Result&lt;DTO&gt;"| D1
    D1 -->|"DTO"| H
    H -->|"Result&lt;DTO&gt;"| D2
    D2 -->|"DTO"| O
# sakoku-ignore-next-line
    O -->|"Result&lt;()&gt;"| Done["完了"]
{% end %}

# sakoku-ignore-next-line
## Node のシグネチャ設計

# sakoku-ignore-next-line
各 Node は関連型で入出力の DTO 型を指定する。トレイトの完全な定義は [Node Spec](/ja/spec/node) を参照。

# sakoku-ignore-next-line
- **InputNode**: 入力なし → DTO を生成
# sakoku-ignore-next-line
- **HiddenNode**: DTO を受け取り → DTO を返す
# sakoku-ignore-next-line
- **OutputNode**: DTO を受け取り → 副作用を実行

# sakoku-ignore-next-line
## 条件分岐におけるデータフロー

# sakoku-ignore-next-line
条件付きエッジでは、先行 Node の出力 DTO を参照して分岐先を決定する。クロージャは DTO の参照を受け取り、分岐先の識別子を返す。

{% mermaid() %}
# sakoku-ignore-next-line
flowchart TD
# sakoku-ignore-next-line
    A[Hidden Node A] -->|"AnalysisOutput"| Cond{"条件判定クロージャ<br/>Fn(&AnalysisOutput) → &str"}
# sakoku-ignore-next-line
    Cond -->|"needs_ai"| B[Hidden Node B<br/>Claude Code 呼び出し]
# sakoku-ignore-next-line
    Cond -->|"simple"| C[Hidden Node C<br/>通常処理]
    B --> D[Output Layer]
    C --> D
{% end %}

# sakoku-ignore-next-line
条件クロージャが返す文字列は `add_conditional_edge` で定義した分岐先マップのキーに対応する。

# sakoku-ignore-next-line
## エラーハンドリング戦略

# sakoku-ignore-next-line
エラーは 2 つのレベルで処理される。

# sakoku-ignore-next-line
### Node 内エラー

# sakoku-ignore-next-line
各 Node の `run` メソッドは `Result` を返す。Layer 内で発生するエラーは Node の責務で適切な `Error` 型に変換する。

```rust
# sakoku-ignore-next-line
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

# sakoku-ignore-next-line
### Graph レベルエラー

# sakoku-ignore-next-line
Layer が `Err` を返した場合、Graph エンジンは実行を停止し、エラーを呼び出し元に伝播する。

{% mermaid() %}
# sakoku-ignore-next-line
flowchart TD
    A[Layer A] -->|Ok| B[Layer B]
# sakoku-ignore-next-line
    B -->|Err| Stop["Graph 実行停止<br/>エラーをトレースに記録"]
    B -->|Ok| C[Layer C]
# sakoku-ignore-next-line
    C -->|Ok| Done["完了"]
{% end %}

# sakoku-ignore-next-line
- エラー発生時、該当 Node の span にエラー情報が記録される
# sakoku-ignore-next-line
- Graph は即座に実行を停止する（後続の Node は実行されない）
# sakoku-ignore-next-line
- 他の Graph の実行には影響しない（Graph 間は独立）

# sakoku-ignore-next-line
## 型安全性の保証範囲

# sakoku-ignore-next-line
### コンパイル時保証

# sakoku-ignore-next-line
- 各 Node の `Input` / `Output` 関連型による DTO 型の一致
# sakoku-ignore-next-line
- `Dto` トレイトの derive 要件（`Serialize`, `Deserialize`, `Clone`, `Send`, `Sync`）

# sakoku-ignore-next-line
### 実行時検証

# sakoku-ignore-next-line
- Graph ビルド時のエッジの型整合性チェック（隣接 Node の Output 型と Input 型の一致）
# sakoku-ignore-next-line
- 条件分岐の網羅性チェック（全分岐先が存在するか）
# sakoku-ignore-next-line
- Graph の構造検証（循環検出、到達不能ノード検出）

# sakoku-ignore-next-line
型パラメータによる静的チェックで可能な範囲の安全性をコンパイル時に保証し、Graph の構造に関する検証は `build()` 時に実行時チェックとして行う。
