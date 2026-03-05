# CLI Command Specification

## 概要

SmartCrab CLI はプロジェクトの生成・コード生成・実行を行うコマンドラインツールである。

## `crab new`

新規 SmartCrab プロジェクトを生成する。

### 構文

```
crab new <project-name> [OPTIONS]
```

### 引数

| 引数 | 必須 | 説明 |
|------|------|------|
| `<project-name>` | Yes | プロジェクト名（ディレクトリ名にもなる） |

### オプション

| オプション | デフォルト | 説明 |
|-----------|-----------|------|
| `--path <dir>` | カレントディレクトリ | 生成先ディレクトリ |

### 生成ファイル一覧

```
<project-name>/
├── Cargo.toml               # smartcrab 依存を含む
├── SmartCrab.toml            # プロジェクト設定
├── Dockerfile                # マルチステージビルド
├── compose.yml               # Jaeger 開発環境
├── .gitignore
├── src/
│   ├── main.rs               # Runtime 起動のエントリーポイント
│   ├── dto/
│   │   └── mod.rs            # 空の mod ファイル
│   ├── layer/
│   │   ├── mod.rs
│   │   ├── input/
│   │   │   └── mod.rs
│   │   ├── hidden/
│   │   │   └── mod.rs
│   │   └── output/
│   │       └── mod.rs
│   └── dag/
│       └── mod.rs
└── tests/
    └── integration/
        └── mod.rs
```

### 終了コード

| コード | 意味 |
|--------|------|
| 0 | 成功 |
| 1 | ディレクトリが既に存在する |
| 2 | 書き込み権限がない |

### 実行例

```bash
$ crab new my_app
Creating project: my_app
  Created: my_app/Cargo.toml
  Created: my_app/SmartCrab.toml
  Created: my_app/Dockerfile
  Created: my_app/compose.yml
  Created: my_app/.gitignore
  Created: my_app/src/main.rs
  Created: my_app/src/dto/mod.rs
  Created: my_app/src/layer/mod.rs
  Created: my_app/src/layer/input/mod.rs
  Created: my_app/src/layer/hidden/mod.rs
  Created: my_app/src/layer/output/mod.rs
  Created: my_app/src/graph/mod.rs
  Created: my_app/tests/integration/mod.rs

Project 'my_app' created successfully!

Next steps:
  cd my_app
  docker compose up -d    # Start Jaeger
  crab run            # Run the application
```

## `crab generate layer`

Layer のボイラープレートコードを生成する。エイリアス: `crab g layer`

### 構文

```
crab generate layer <name> --type <layer-type> [OPTIONS]
```

### 引数

| 引数 | 必須 | 説明 |
|------|------|------|
| `<name>` | Yes | Layer 名（snake_case） |

### オプション

| オプション | 必須 | デフォルト | 値 | 説明 |
|-----------|------|-----------|-----|------|
| `--type` | Yes | - | `input`, `hidden`, `output` | Layer の種類 |
| `--input-type` | No | - | `chat`, `cron`, `http` | Input Layer のサブタイプ（`--type input` 時のみ有効） |
| `--output-type` | No | - | `discord` | Output Layer のサブタイプ（`--type output` 時のみ有効） |

### 生成ファイル

| ファイル | 内容 |
|---------|------|
| `src/layer/<type>/<name>.rs` | Layer 構造体とトレイト実装 |
| `src/dto/<name>.rs` | 対応する Input/Output DTO |

### 自動更新ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/layer/<type>/mod.rs` | `pub mod <name>;` を追加 |
| `src/dto/mod.rs` | `pub mod <name>;` を追加 |

### 終了コード

| コード | 意味 |
|--------|------|
| 0 | 成功 |
| 1 | ファイルが既に存在する |
| 2 | SmartCrab プロジェクトのルートディレクトリではない |

### 実行例

```bash
$ crab generate layer data_analyzer --type hidden
  Created: src/layer/hidden/data_analyzer.rs
  Updated: src/layer/hidden/mod.rs
  Created: src/dto/data_analyzer.rs
  Updated: src/dto/mod.rs

$ crab generate layer webhook --type input --input-type http
  Created: src/layer/input/webhook.rs
  Updated: src/layer/input/mod.rs
  Created: src/dto/webhook.rs
  Updated: src/dto/mod.rs

$ crab generate layer discord_notifier --type output --output-type discord
  Created: src/layer/output/discord_notifier.rs
  Updated: src/layer/output/mod.rs
  Created: src/dto/discord_notifier.rs
  Updated: src/dto/mod.rs
```

## `crab generate dto`

DTO 構造体のボイラープレートコードを生成する。エイリアス: `crab g dto`

### 構文

```
crab generate dto <name> [OPTIONS]
```

### 引数

| 引数 | 必須 | 説明 |
|------|------|------|
| `<name>` | Yes | DTO 名（snake_case） |

### オプション

| オプション | 必須 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `--fields <fields>` | No | 空 | カンマ区切りの `name:type` ペア |

### 生成ファイル

| ファイル | 内容 |
|---------|------|
| `src/dto/<name>.rs` | DTO 構造体（`#[derive(Dto)]`） |

### 自動更新ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/dto/mod.rs` | `pub mod <name>;` を追加 |

### 終了コード

| コード | 意味 |
|--------|------|
| 0 | 成功 |
| 1 | ファイルが既に存在する |
| 2 | SmartCrab プロジェクトのルートディレクトリではない |
| 3 | `--fields` の構文エラー |

### 実行例

```bash
$ crab generate dto analysis_result --fields "severity:String,score:f64,tags:Vec<String>"
  Created: src/dto/analysis_result.rs
  Updated: src/dto/mod.rs

$ crab generate dto empty_marker
  Created: src/dto/empty_marker.rs
  Updated: src/dto/mod.rs
```

## `crab generate graph`

Graph 定義関数のボイラープレートコードを生成する。エイリアス: `crab g graph`

### 構文

```
crab generate graph <name>
```

### 引数

| 引数 | 必須 | 説明 |
|------|------|------|
| `<name>` | Yes | Graph 名（snake_case） |

### 生成ファイル

| ファイル | 内容 |
|---------|------|
| `src/graph/<name>.rs` | Graph 定義関数（`DirectedGraphBuilder` 使用） |

### 自動更新ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/graph/mod.rs` | `pub mod <name>;` を追加 |

### 終了コード

| コード | 意味 |
|--------|------|
| 0 | 成功 |
| 1 | ファイルが既に存在する |
| 2 | SmartCrab プロジェクトのルートディレクトリではない |

### 実行例

```bash
$ crab generate graph api_pipeline
  Created: src/graph/api_pipeline.rs
  Updated: src/graph/mod.rs
```

## `crab run`

SmartCrab アプリケーションを実行する。内部的には `cargo run` を呼び出す。

### 構文

```
crab run [OPTIONS]
```

### オプション

| オプション | デフォルト | 説明 |
|-----------|-----------|------|
| `--release` | false | リリースビルドで実行 |

### 終了コード

| コード | 意味 |
|--------|------|
| 0 | 正常終了 |
| 1 | ビルドエラー |
| 2 | ランタイムエラー |

### 実行例

```bash
$ crab run
  Compiling my_app v0.1.0
   Finished dev [unoptimized + debuginfo] target(s)
    Running `target/debug/my_app`
INFO smartcrab: Starting the application
INFO smartcrab::graph::api: Graph 'api' started
INFO smartcrab::graph::batch: Graph 'batch' started
```

## 設定ファイル: SmartCrab.toml

プロジェクトルートに配置する設定ファイル。CLI と Runtime の両方が参照する。

```toml
[project]
name = "my_app"        # プロジェクト名
version = "0.1.0"      # バージョン

[telemetry]
enabled = true                         # テレメトリの有効/無効
exporter = "otlp"                      # エクスポータ種別（"otlp" | "stdout"）
endpoint = "http://localhost:4317"     # OTLP エンドポイント

[claude_code]
timeout_secs = 300     # Claude Code のデフォルトタイムアウト（秒）
```

### 設定の優先順位

1. 環境変数（`SMARTCRAB_` プレフィックス）
2. `SmartCrab.toml`
3. デフォルト値

環境変数の命名規則:

| 設定 | 環境変数 |
|------|---------|
| `telemetry.enabled` | `SMARTCRAB_TELEMETRY_ENABLED` |
| `telemetry.endpoint` | `SMARTCRAB_TELEMETRY_ENDPOINT` |
| `claude_code.timeout_secs` | `SMARTCRAB_CLAUDE_CODE_TIMEOUT_SECS` |
