+++
title = "CLI Command Specification"
description = "CLI command specification — details of crab new / generate / run"
weight = 4
+++

## Overview

The SmartCrab CLI is a command-line tool for project generation, code generation, and execution.

## `crab new`

Generates a new SmartCrab project.

### Syntax

```
crab new <project-name> [OPTIONS]
```

### Arguments

| Argument | Required | Description |
|------|------|------|
| `<project-name>` | Yes | Project name (also becomes the directory name) |

### Options

| Option | Default | Description |
|-----------|-----------|------|
| `--path <dir>` | Current directory | Output directory |

### Generated File List

```
<project-name>/
├── Cargo.toml               # Includes smartcrab dependency
├── SmartCrab.toml            # Project configuration
├── Dockerfile                # Multi-stage build
├── compose.yml               # Jaeger development environment
├── .gitignore
├── src/
│   ├── main.rs               # Entry point for Runtime startup
│   ├── dto/
│   │   └── mod.rs            # Empty mod file
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

### Exit Codes

| Code | Meaning |
|--------|------|
| 0 | Success |
| 1 | Directory already exists |
| 2 | No write permission |

### Example

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

Generates Layer boilerplate code. Alias: `crab g layer`

### Syntax

```
crab generate layer <name> --type <layer-type> [OPTIONS]
```

### Arguments

| Argument | Required | Description |
|------|------|------|
| `<name>` | Yes | Layer name (snake_case) |

### Options

| Option | Required | Default | Values | Description |
|-----------|------|-----------|-----|------|
| `--type` | Yes | - | `input`, `hidden`, `output` | Layer type |
| `--input-type` | No | - | `chat`, `cron`, `http` | Input Layer subtype (valid only with `--type input`) |
| `--output-type` | No | - | `discord` | Output Layer subtype (valid only with `--type output`) |

### Generated Files

| File | Content |
|---------|------|
| `src/layer/<type>/<name>.rs` | Layer struct and trait implementation |
| `src/dto/<name>.rs` | Corresponding Input/Output DTOs |

### Auto-Updated Files

| File | Change |
|---------|---------|
| `src/layer/<type>/mod.rs` | Adds `pub mod <name>;` |
| `src/dto/mod.rs` | Adds `pub mod <name>;` |

### Exit Codes

| Code | Meaning |
|--------|------|
| 0 | Success |
| 1 | File already exists |
| 2 | Not in a SmartCrab project root directory |

### Examples

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

Generates DTO struct boilerplate code. Alias: `crab g dto`

### Syntax

```
crab generate dto <name> [OPTIONS]
```

### Arguments

| Argument | Required | Description |
|------|------|------|
| `<name>` | Yes | DTO name (snake_case) |

### Options

| Option | Required | Default | Description |
|-----------|------|-----------|------|
| `--fields <fields>` | No | empty | Comma-separated `name:type` pairs |

### Generated Files

| File | Content |
|---------|------|
| `src/dto/<name>.rs` | DTO struct (with `#[derive(Dto)]`) |

### Auto-Updated Files

| File | Change |
|---------|---------|
| `src/dto/mod.rs` | Adds `pub mod <name>;` |

### Exit Codes

| Code | Meaning |
|--------|------|
| 0 | Success |
| 1 | File already exists |
| 2 | Not in a SmartCrab project root directory |
| 3 | `--fields` syntax error |

### Examples

```bash
$ crab generate dto analysis_result --fields "severity:String,score:f64,tags:Vec<String>"
  Created: src/dto/analysis_result.rs
  Updated: src/dto/mod.rs

$ crab generate dto empty_marker
  Created: src/dto/empty_marker.rs
  Updated: src/dto/mod.rs
```

## `crab generate graph`

Generates Graph definition function boilerplate code. Alias: `crab g graph`

### Syntax

```
crab generate graph <name>
```

### Arguments

| Argument | Required | Description |
|------|------|------|
| `<name>` | Yes | Graph name (snake_case) |

### Generated Files

| File | Content |
|---------|------|
| `src/graph/<name>.rs` | Graph definition function (using `DirectedGraphBuilder`) |

### Auto-Updated Files

| File | Change |
|---------|---------|
| `src/graph/mod.rs` | Adds `pub mod <name>;` |

### Exit Codes

| Code | Meaning |
|--------|------|
| 0 | Success |
| 1 | File already exists |
| 2 | Not in a SmartCrab project root directory |

### Example

```bash
$ crab generate graph api_pipeline
  Created: src/graph/api_pipeline.rs
  Updated: src/graph/mod.rs
```

## `crab run`

Runs the SmartCrab application. Internally calls `cargo run`.

### Syntax

```
crab run [OPTIONS]
```

### Options

| Option | Default | Description |
|-----------|-----------|------|
| `--release` | false | Run with a release build |

### Exit Codes

| Code | Meaning |
|--------|------|
| 0 | Normal exit |
| 1 | Build error |
| 2 | Runtime error |

### Example

```bash
$ crab run
  Compiling my_app v0.1.0
   Finished dev [unoptimized + debuginfo] target(s)
    Running `target/debug/my_app`
INFO smartcrab: Starting the application
INFO smartcrab::graph::api: Graph 'api' started
INFO smartcrab::graph::batch: Graph 'batch' started
```

## Configuration File: SmartCrab.toml

A configuration file placed at the project root. Referenced by both the CLI and the Runtime.

```toml
[project]
name = "my_app"        # Project name
version = "0.1.0"      # Version

[telemetry]
enabled = true                         # Enable/disable telemetry
exporter = "otlp"                      # Exporter type ("otlp" | "stdout")
endpoint = "http://localhost:4317"     # OTLP endpoint

[claude_code]
timeout_secs = 300     # Default timeout for Claude Code (seconds)
```

### Configuration Priority

1. Environment variables (`SMARTCRAB_` prefix)
2. `SmartCrab.toml`
3. Default values

Environment variable naming:

| Setting | Environment Variable |
|------|---------|
| `telemetry.enabled` | `SMARTCRAB_TELEMETRY_ENABLED` |
| `telemetry.endpoint` | `SMARTCRAB_TELEMETRY_ENDPOINT` |
| `claude_code.timeout_secs` | `SMARTCRAB_CLAUDE_CODE_TIMEOUT_SECS` |
