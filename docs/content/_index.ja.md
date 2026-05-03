+++
title = "SmartCrab Documentation"
sort_by = "weight"
weight = 1
template = "section.html"
+++

<div class="cover-image-wrapper">
  <img src="../cover.jpg" alt="SmartCrab">
</div>

# sakoku-ignore-next-line
SmartCrab は「ツール → AI」パラダイムを実現する Rust フレームワークです。非 AI 処理の結果に基づいて AI（Claude Code）を起動するかどうかを Graph の条件分岐で判断します。

# sakoku-ignore-next-line
## ドキュメントの読み方

# sakoku-ignore-next-line
本ドキュメントは **設計（design/）** と **仕様（spec/）** の 2 カテゴリに分かれています。

# sakoku-ignore-next-line
| カテゴリ | 内容 | 対象読者 |
|---------|------|---------|
# sakoku-ignore-next-line
| **design/** | Why & How — なぜその設計にしたか、どう実現するか | アーキテクチャを理解したい人 |
# sakoku-ignore-next-line
| **spec/** | What — 具体的なトレイト定義、API、コマンド仕様 | 実装・利用する人 |

# sakoku-ignore-next-line
設計を先に読んでから仕様を読むと、背景を踏まえた理解ができます。

# sakoku-ignore-next-line
## ドキュメント一覧

# sakoku-ignore-next-line
### 設計ドキュメント（design/）

# sakoku-ignore-next-line
| ドキュメント | 概要 |
|-------------|------|
# sakoku-ignore-next-line
| [architecture](/design/architecture/) | アーキテクチャ全体設計 — 「ツール → AI」パラダイム、システム全体像、並行実行モデル |
# sakoku-ignore-next-line
| [data-flow](/design/data-flow/) | データフロー設計 — Node 間のデータの流れ、型安全性、エラーハンドリング |
# sakoku-ignore-next-line
| [graph-engine](/design/graph-engine/) | Graph エンジン設計 — 実行エンジン、条件分岐、検証、ライフサイクル |
# sakoku-ignore-next-line
| [claude-code-integration](/design/claude-code-integration/) | Claude Code 連携設計 — 子プロセス実行、データ交換、テスト戦略 |

# sakoku-ignore-next-line
### 仕様書（spec/）

# sakoku-ignore-next-line
| ドキュメント | 概要 |
|-------------|------|
# sakoku-ignore-next-line
| [layer](/spec/layer/) | Node 仕様 — Input/Hidden/Output 各 Node のトレイト定義とコード例 |
# sakoku-ignore-next-line
| [dto](/spec/dto/) | DTO 仕様 — Dto トレイト、命名規約、変換、コード例 |
# sakoku-ignore-next-line
| [graph](/spec/graph/) | DirectedGraph 仕様 — DirectedGraphBuilder API、実行セマンティクス、バリデーション |

# sakoku-ignore-next-line
## 用語集

# sakoku-ignore-next-line
| 用語 | 説明 |
|------|------|
# sakoku-ignore-next-line
| **Layer** | グラフ内の処理単位（ノード）。Input / Hidden / Output の 3 種がある |
# sakoku-ignore-next-line
| **Input Layer** | 外部からのイベントを受けて DTO を生成する Layer。chat / cron / http のサブタイプを持つ |
# sakoku-ignore-next-line
| **Hidden Layer** | DTO を受け取り、変換・加工して DTO を返す中間処理 Layer。Claude Code 呼び出し可能 |
# sakoku-ignore-next-line
| **Output Layer** | DTO を受け取り、最終的な副作用（通知、保存等）を実行する Layer。Claude Code 呼び出し可能 |
# sakoku-ignore-next-line
| **DTO** | Data Transfer Object。Node 間のデータ受け渡しに使う型安全な Rust 構造体 |
# sakoku-ignore-next-line
| **DirectedGraph** | 有向グラフ。Node の実行順序と条件分岐を定義する。サイクルもサポート |
# sakoku-ignore-next-line
| **Node** | グラフ内の処理単位。Layer の実装に対応し、Input / Hidden / Output の 3 種がある |
# sakoku-ignore-next-line
| **Edge** | グラフ内のエッジ。Node 間の遷移を表す。条件付きエッジはクロージャで分岐判定を行う |
# sakoku-ignore-next-line
| **DirectedGraphBuilder** | DirectedGraph をビルダーパターンで構築するための API |
# sakoku-ignore-next-line
| **Claude Code** | Anthropic の AI コーディングツール。Hidden/Output Node から子プロセスとして実行可能 |
# sakoku-ignore-next-line
| **SmartCrab.toml** | プロジェクトの設定ファイル |
