+++
title = "Legacy documentation"
sort_by = "weight"
weight = 99
template = "section.html"
+++

# sakoku-ignore-next-line
> **注意。** このセクション配下のドキュメントはすべて、旧 Tauri (Rust) + React スタック時代のものです — `Layer` / `DTO` / `DirectedGraphBuilder` トレイト、`tokio` ランタイム、OpenTelemetry エクスポータ、`crab new` CLI、distroless Docker ターゲット。**いずれも現在の実装には存在しません。** 過去リリースや外部参照のために残しているだけで、現行システムの正確な姿を知りたい場合は上位の [design](/design/) と [spec](/spec/) を参照してください。

# sakoku-ignore-next-line
## レガシー設計ドキュメント

# sakoku-ignore-next-line
| ドキュメント | 概要 |
|-------------|------|
# sakoku-ignore-next-line
| [architecture](/legacy/design/architecture/) | Tauri/Rust フレームワーク全体像 |
# sakoku-ignore-next-line
| [data-flow](/legacy/design/data-flow/) | Layer 間 DTO データフロー |
# sakoku-ignore-next-line
| [graph-engine](/legacy/design/graph-engine/) | DirectedGraphBuilder 実行エンジン |
# sakoku-ignore-next-line
| [claude-code-integration](/legacy/design/claude-code-integration/) | Claude Code 子プロセス連携 |

# sakoku-ignore-next-line
## レガシー仕様

# sakoku-ignore-next-line
| ドキュメント | 概要 |
|-------------|------|
# sakoku-ignore-next-line
| [layer](/legacy/spec/node/) | Node トレイト仕様 |
# sakoku-ignore-next-line
| [dto](/legacy/spec/dto/) | Dto トレイト仕様 |
# sakoku-ignore-next-line
| [graph](/legacy/spec/graph/) | DirectedGraph 仕様 |
# sakoku-ignore-next-line
| [chat](/legacy/spec/chat/) | Chat input layer 仕様 |
# sakoku-ignore-next-line
| [storage](/legacy/spec/storage/) | ストレージ仕様 |
