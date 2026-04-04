+++
title = "Architecture"
description = "アーキテクチャ全体設計 — 「ツール → AI」パラダイム、システム全体像、並行実行モデル"
weight = 1
+++

# sakoku-ignore-next-line
## 「ツール → AI」パラダイム

# sakoku-ignore-next-line
従来の AI エージェントフレームワーク（OpenClaw 等）は「AI → ツール」パラダイムに基づいている。AI が主導し、必要に応じてツールを呼び出す。

# sakoku-ignore-next-line
SmartCrab はこれを逆転させた「ツール → AI」パラダイムを採用する。通常の処理（HTTP リクエスト処理、Cron ジョブ、チャットメッセージ受信等）を先に実行し、その結果に基づいて AI を呼び出すかどうかを条件分岐で判断する。

# sakoku-ignore-next-line
```
従来: AI → ツール
   ┌──────┐    ┌──────┐    ┌──────┐
   │  AI  │───▶│ Tool │───▶│  AI  │───▶ ...
   └──────┘    └──────┘    └──────┘
   AIが主導し、ツールを呼び出す

SmartCrab: ツール → AI
   ┌──────┐    ┌───────────┐    ┌──────────────┐
   │Input │───▶│ 条件判定  │───▶│ Claude Code  │───▶ ...
   └──────┘    └───────────┘    └──────────────┘
   非AI処理が先行し、条件に応じてAIを起動する
```

# sakoku-ignore-next-line
このアプローチの利点:

# sakoku-ignore-next-line
- **コスト効率**: AI は必要な場合のみ起動される
# sakoku-ignore-next-line
- **予測可能性**: 非 AI 処理は決定論的に動作する
# sakoku-ignore-next-line
- **テスタビリティ**: AI を含まない処理パスは通常のユニットテストで検証できる
# sakoku-ignore-next-line
- **制御性**: AI の起動条件をプログラマが明示的に定義できる

# sakoku-ignore-next-line
## システム全体像

{% mermaid() %}
# sakoku-ignore-next-line
C4Context
# sakoku-ignore-next-line
    title SmartCrab System Context

# sakoku-ignore-next-line
    Person(dev, "Developer", "SmartCrabでアプリケーションを構築する開発者")

# sakoku-ignore-next-line
    System(smartcrab, "SmartCrab Application", "開発者がSmartCrabフレームワーク上で構築したアプリケーション")

# sakoku-ignore-next-line
    System_Ext(claude, "Claude Code", "Anthropic AI コーディングツール（子プロセス実行）")
# sakoku-ignore-next-line
    System_Ext(discord, "Discord / Chat", "チャットプラットフォーム")
# sakoku-ignore-next-line
    System_Ext(http_client, "HTTP Client", "外部HTTPクライアント")
# sakoku-ignore-next-line
    System_Ext(jaeger, "Jaeger", "分散トレーシングUI")

# sakoku-ignore-next-line
    Rel(dev, smartcrab, "smartcrab CLI で開発・実行")
# sakoku-ignore-next-line
    Rel(smartcrab, claude, "条件付きで子プロセス実行")
# sakoku-ignore-next-line
    Rel(discord, smartcrab, "DM / メンション")
# sakoku-ignore-next-line
    Rel(http_client, smartcrab, "HTTP リクエスト")
# sakoku-ignore-next-line
    Rel(smartcrab, jaeger, "OpenTelemetry トレース")
{% end %}

# sakoku-ignore-next-line
## 3 要素の関係

# sakoku-ignore-next-line
SmartCrab アプリケーションは **Layer**、**DTO**、**Graph** の 3 要素で構成される。

{% mermaid() %}
classDiagram
    class Node {
        <<trait>>
    }
    class InputNode {
        <<trait>>
        +run() Result~Output~
    }
    class HiddenNode {
        <<trait>>
        +run(input: Input) Result~Output~
    }
    class OutputNode {
        <<trait>>
        +run(input: Input) Result~()~
    }
    class Dto {
        <<trait>>
        Serialize + Deserialize + Clone + Send + Sync
    }
    class DirectedGraphBuilder {
        +new(name) DirectedGraphBuilder
        +add_input(layer) DirectedGraphBuilder
        +add_hidden(layer) DirectedGraphBuilder
        +add_output(layer) DirectedGraphBuilder
        +add_edge(from, to) DirectedGraphBuilder
        +add_conditional_edge(from, condition, branches) DirectedGraphBuilder
        +build() Result~DirectedGraph~
    }
    class DirectedGraph {
        +run() Result~()~
    }

    Node <|-- InputNode
    Node <|-- HiddenNode
    Node <|-- OutputNode
    InputNode ..> Dto : produces
    HiddenNode ..> Dto : consumes / produces
    OutputNode ..> Dto : consumes
    DirectedGraphBuilder --> DirectedGraph : builds
    DirectedGraph --> Node : executes
    DirectedGraph --> Dto : transfers
{% end %}

# sakoku-ignore-next-line
- **Node**: 処理の最小単位。Input / Hidden / Output の 3 種
# sakoku-ignore-next-line
- **DTO**: Node 間のデータ受け渡しに使う型安全な構造体
# sakoku-ignore-next-line
- **Graph**: Node の実行順序と条件分岐を定義するグラフ

# sakoku-ignore-next-line
## 並行実行モデル

# sakoku-ignore-next-line
SmartCrab は 1 プロセスで複数の Graph を同時実行する。tokio ランタイム上で各 Graph が独立した非同期タスクとして動作する。

{% mermaid() %}
flowchart TB
    subgraph Process["SmartCrab Process"]
        subgraph Runtime["tokio Runtime"]
            subgraph Task1["Graph 1 (HTTP)"]
                L1[Input: HTTP] --> L2[Hidden: Parse]
                L2 --> L3[Output: Respond]
            end
            subgraph Task2["Graph 2 (Cron)"]
                L4[Input: Cron] --> L5[Hidden: Check]
                L5 --> L6[Output: Notify]
            end
            subgraph Task3["Graph 3 (Chat)"]
                L7[Input: Chat] --> L8[Hidden: Analyze]
                L8 --> L9[Output: Reply]
            end
        end
    end
{% end %}

# sakoku-ignore-next-line
- 各 Graph は独立した非同期タスクとして実行される
# sakoku-ignore-next-line
- Graph 内の Node は Graph が定義する順序で逐次実行される（並列エッジがある場合は並列実行）
# sakoku-ignore-next-line
- Claude Code の呼び出しは子プロセスとして非同期に実行される
# sakoku-ignore-next-line
- グレースフルシャットダウンはシグナル（SIGTERM / SIGINT）を受けて全 Graph に伝播する

# sakoku-ignore-next-line
## オブザーバビリティ

# sakoku-ignore-next-line
SmartCrab は OpenTelemetry を用いた構造化トレーシングを標準装備する。

# sakoku-ignore-next-line
### Span 構造

```
smartcrab                          # Root span
├── graph::{graph_name}            # Graph実行のspan
│   ├── layer::{layer_name}        # 各Layerの実行span
│   │   ├── claude_code::invoke    # Claude Code呼び出し（該当する場合）
│   │   └── ...
│   ├── edge::{from}→{to}         # エッジ遷移のspan
│   │   └── condition::evaluate    # 条件評価（条件付きエッジの場合）
│   │   └── ...
└── ...
```

# sakoku-ignore-next-line
### トレース送信先

# sakoku-ignore-next-line
SmartCrab は標準的な OpenTelemetry OTLP エクスポータを使用する。送信先は標準の OTEL 環境変数で設定できる：

# sakoku-ignore-next-line
| 環境変数 | デフォルト | 説明 |
|----------|---------|-------------|
# sakoku-ignore-next-line
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | OTLP エンドポイント URL |
# sakoku-ignore-next-line
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` | トランスポートプロトコル（`grpc` または `http/protobuf`） |
# sakoku-ignore-next-line
| `OTEL_EXPORTER_OTLP_HEADERS` | — | 追加ヘッダー（認証用など） |

# sakoku-ignore-next-line
OTLP 互換の任意のバックエンド（Jaeger、Grafana Tempo、Datadog など）でトレースを受信できる。

# sakoku-ignore-next-line
## デプロイメント

# sakoku-ignore-next-line
### Docker 構成

# sakoku-ignore-next-line
`crab new` が生成する Dockerfile は、`gcr.io/distroless/static-debian12:nonroot` をベースとした最小限のプロダクションイメージを作成するマルチステージビルド構成になっている。
