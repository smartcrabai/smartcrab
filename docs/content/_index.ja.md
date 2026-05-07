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
SmartCrab は「ツール → AI」パラダイムを実現する macOS デスクトップアプリケーションです。HTTP リクエスト・cron ティック・チャットイベントといった非 AI 処理を先に走らせ、YAML で定義したパイプラインの条件分岐に基づいて AI エージェント（Claude Code / Kimi / GitHub Copilot / Codex CLI のいずれか。実行時に [`seher-ts`](https://github.com/smartcrabai/seher-ts) が解決）を呼ぶかどうかを決めます。

# sakoku-ignore-next-line
アプリ本体は SwiftUI ホストプロセスと Bun TypeScript サービスの 2 プロセスから成り、stdio 上の line-delimited JSON-RPC 2.0 で通信します。

# sakoku-ignore-next-line
## ドキュメントの読み方

# sakoku-ignore-next-line
| カテゴリ | 内容 | 対象読者 |
|---------|------|---------|
# sakoku-ignore-next-line
| **design/** | Why & How — プロセス構成、実行モデル、ルーティング、学習ループ | アーキテクチャを把握したい人 |
# sakoku-ignore-next-line
| **spec/** | What — JSON-RPC メソッドのシェイプ、YAML パイプラインスキーマ、DB スキーマ | 実装・連携する人 |

# sakoku-ignore-next-line
## 設計（design/）

# sakoku-ignore-next-line
| ドキュメント | 概要 |
|-------------|------|
# sakoku-ignore-next-line
| [architecture](/design/architecture/) | プロセスモデル — SwiftUI ホスト、Bun 子プロセス、stdio JSON-RPC、SQLite、起動シーケンス |
# sakoku-ignore-next-line
| [pipeline-engine](/design/pipeline-engine/) | YAML パイプライン DAG 実行器 — ノードアクション、条件ルーティング、シブリング並列、fan-in |
# sakoku-ignore-next-line
| [llm-routing](/design/llm-routing/) | seher-ts ルーターと Settings → `seher-settings.jsonc` の流れ |
# sakoku-ignore-next-line
| [memory-and-skills](/design/memory-and-skills/) | FTS5 メモリストア、30 分要約ループ、スキル自動生成 |

# sakoku-ignore-next-line
## 仕様（spec/）

# sakoku-ignore-next-line
| ドキュメント | 概要 |
|-------------|------|
# sakoku-ignore-next-line
| [rpc-methods](/spec/rpc-methods/) | Bun サービスが公開する JSON-RPC メソッドの一覧と params / result シェイプ |
# sakoku-ignore-next-line
| [pipeline-yaml](/spec/pipeline-yaml/) | パイプライン YAML スキーマ（PipelineDefinition、NodeAction、MatchCondition）と例 |
# sakoku-ignore-next-line
| [database-schema](/spec/database-schema/) | SQLite テーブル定義と、それを作るマイグレーション順序 |

# sakoku-ignore-next-line
## 用語集

# sakoku-ignore-next-line
| 用語 | 説明 |
|------|------|
# sakoku-ignore-next-line
| **パイプライン** | YAML で定義された有向グラフ。トリガーが発火すると実行される |
# sakoku-ignore-next-line
| **ノード** | パイプラインの 1 ステップ。`id` / `name` と任意の `action`（`shell_command` / `http_request` / `llm_call` / `chat_send`）を持つ |
# sakoku-ignore-next-line
| **トリガー** | パイプラインを起動する事象。現在は `cron` と `discord` |
# sakoku-ignore-next-line
| **アダプタ** | `apps/bun-service/src/adapters/` 配下の自己登録プラグイン。LLM アダプタは `executePrompt`、チャットアダプタは `sendMessage` と listener ループを公開 |
# sakoku-ignore-next-line
| **seher-ts** | ユーザー設定に基づいて最優先の利用可能エージェント（Claude / Kimi / Copilot / Codex）を解決する外部ルーター SDK |
# sakoku-ignore-next-line
| **スキル** | 再利用可能な Markdown プロンプト本文。実行トレースから自動生成することもできる |
# sakoku-ignore-next-line
| **メモリ** | 過去のチャットや実行トレースを格納する FTS5 つき SQLite ストア。定期的に `kind=summary` エントリへ要約される |

# sakoku-ignore-next-line
## レガシー

# sakoku-ignore-next-line
旧 Tauri/Rust フレームワーク時代のドキュメント（Layer/DTO/DirectedGraphBuilder、tokio ランタイム、OpenTelemetry エクスポータ、`crab new` CLI）は参考のため [`legacy/`](/legacy/) 配下に残しています。**現在の実装の挙動を表すものではありません。**
