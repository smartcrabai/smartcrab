+++
title = "SmartCrab Documentation"
sort_by = "weight"
weight = 1
+++

SmartCrab は「ツール → AI」パラダイムを実現する Rust フレームワークです。非 AI 処理の結果に基づいて AI（Claude Code）を起動するかどうかを Graph の条件分岐で判断します。

## ドキュメントの読み方

本ドキュメントは **設計（design/）** と **仕様（spec/）** の 2 カテゴリに分かれています。

| カテゴリ | 内容 | 対象読者 |
|---------|------|---------|
| **design/** | Why & How — なぜその設計にしたか、どう実現するか | アーキテクチャを理解したい人 |
| **spec/** | What — 具体的なトレイト定義、API、コマンド仕様 | 実装・利用する人 |

設計を先に読んでから仕様を読むと、背景を踏まえた理解ができます。

## ドキュメント一覧

### 設計ドキュメント（design/）

| ドキュメント | 概要 |
|-------------|------|
| [architecture](/design/architecture/) | アーキテクチャ全体設計 — 「ツール → AI」パラダイム、システム全体像、並行実行モデル |
| [data-flow](/design/data-flow/) | データフロー設計 — Layer 間のデータの流れ、型安全性、エラーハンドリング |
| [graph-engine](/design/graph-engine/) | Graph エンジン設計 — 実行エンジン、条件分岐、検証、ライフサイクル |
| [claude-code-integration](/design/claude-code-integration/) | Claude Code 連携設計 — 子プロセス実行、データ交換、テスト戦略 |
| [cli](/design/cli/) | CLI ツール設計 — Rails ライク開発体験、コマンド体系、テンプレート |

### 仕様書（spec/）

| ドキュメント | 概要 |
|-------------|------|
| [layer](/spec/layer/) | Layer 仕様 — Input/Hidden/Output 各 Layer のトレイト定義とコード例 |
| [dto](/spec/dto/) | DTO 仕様 — Dto トレイト、命名規約、変換、コード例 |
| [graph](/spec/graph/) | DirectedGraph 仕様 — DirectedGraphBuilder API、実行セマンティクス、バリデーション |
| [cli](/spec/cli/) | CLI コマンド仕様 — `crab new` / `generate` / `run` の詳細 |

## 用語集

| 用語 | 説明 |
|------|------|
| **Layer** | グラフ内の処理単位（ノード）。Input / Hidden / Output の 3 種がある |
| **Input Layer** | 外部からのイベントを受けて DTO を生成する Layer。chat / cron / http のサブタイプを持つ |
| **Hidden Layer** | DTO を受け取り、変換・加工して DTO を返す中間処理 Layer。Claude Code 呼び出し可能 |
| **Output Layer** | DTO を受け取り、最終的な副作用（通知、保存等）を実行する Layer。Claude Code 呼び出し可能 |
| **DTO** | Data Transfer Object。Layer 間のデータ受け渡しに使う型安全な Rust 構造体 |
| **DirectedGraph** | 有向グラフ。Layer の実行順序と条件分岐を定義する。サイクルもサポート |
| **Node** | グラフ内のノード。1 つの Layer に対応する |
| **Edge** | グラフ内のエッジ。Node 間の遷移を表す。条件付きエッジはクロージャで分岐判定を行う |
| **DirectedGraphBuilder** | DirectedGraph をビルダーパターンで構築するための API |
| **Claude Code** | Anthropic の AI コーディングツール。Hidden/Output Layer から子プロセスとして実行可能 |
| **SmartCrab.toml** | プロジェクトの設定ファイル |
