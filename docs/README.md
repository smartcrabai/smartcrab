# SmartCrab Documentation

SmartCrab is a macOS desktop application implementing the "Tool-to-AI" paradigm. Non-AI processing runs first, and conditional branches in a YAML pipeline decide whether to invoke an AI agent (Claude Code, Kimi, GitHub Copilot, or Codex CLI — resolved at runtime by `seher-ts`).

The application is split into a SwiftUI host process and a Bun TypeScript service that communicate over line-delimited JSON-RPC 2.0 on stdio.

## How to Read the Documentation

| Category | Content | Audience |
|----------|---------|----------|
| **design/** | Why & How — process model, execution engine, routing, learning loop | Readers who want to understand the architecture |
| **spec/** | What — JSON-RPC method shapes, YAML pipeline schema, database schema | Implementers and integrators |

## Design

| Document | Summary |
|----------|---------|
| [architecture.md](content/design/architecture.md) | Process model — SwiftUI host, Bun child, stdio JSON-RPC, SQLite, startup sequence |
| [pipeline-engine.md](content/design/pipeline-engine.md) | YAML pipeline DAG executor — node actions, conditional routing, parallel siblings, fan-in |
| [llm-routing.md](content/design/llm-routing.md) | seher-ts router and how Settings drives `seher-settings.jsonc` |
| [memory-and-skills.md](content/design/memory-and-skills.md) | FTS5 memory store, 30-minute summarization loop, skill auto-generation |

## Specifications

| Document | Summary |
|----------|---------|
| [rpc-methods.md](content/spec/rpc-methods.md) | Every JSON-RPC method exposed by the Bun service |
| [pipeline-yaml.md](content/spec/pipeline-yaml.md) | Pipeline YAML schema and examples |
| [database-schema.md](content/spec/database-schema.md) | SQLite tables and the migration order that produces them |

## Operational guides

| Document | Summary |
|----------|---------|
| [E2E.md](E2E.md) | End-to-end verification with the embedded Bun binary, stdio smoke test, Discord round-trip, and iOS Simulator preview |
| [RELEASE.md](RELEASE.md) | How to ship a code-signed and notarized DMG |

## Legacy

The previous Tauri/Rust framework documentation (Layer / DTO / DirectedGraphBuilder, tokio runtime, OpenTelemetry exporter, `crab new` CLI) lives under [`content/legacy/`](content/legacy/) for reference. **It does not describe the current implementation.**
