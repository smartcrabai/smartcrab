+++
title = "SmartCrab Documentation"
sort_by = "weight"
weight = 1
template = "section.html"
+++

<div class="cover-image-wrapper">
  <img src="cover.jpg" alt="SmartCrab">
</div>

SmartCrab is a macOS desktop application implementing the Tool-to-AI paradigm. Non-AI processing — HTTP requests, cron ticks, chat events — runs first, and conditional branches in a YAML-defined pipeline decide whether to invoke an AI agent (Anthropic, GitHub Copilot, or OpenAI, resolved at runtime by the [`seher-bridge`](https://github.com/smartcrabai/seher) Rust binary).

The application is split into a SwiftUI host process and a Bun TypeScript service that communicate over line-delimited JSON-RPC 2.0 on stdio.

## How to Read This Documentation

| Category | Content | Audience |
|---------|---------|---------|
| **design/** | Why & How — system structure, execution model, routing, learning loop | Readers who want to understand the architecture |
| **spec/** | What — JSON-RPC method shapes, YAML pipeline schema, database schema | Implementers and integrators |

## Design

| Document | Summary |
|----------|---------|
| [architecture](/design/architecture/) | Process model — SwiftUI host, Bun child, stdio JSON-RPC, SQLite, startup sequence |
| [pipeline-engine](/design/pipeline-engine/) | YAML pipeline DAG executor — node actions, conditional routing, parallel siblings, fan-in |
| [llm-routing](/design/llm-routing/) | seher-bridge router and how Settings drives `seher-config.yaml` |
| [memory-and-skills](/design/memory-and-skills/) | FTS5 memory store, 30-minute summarization loop, skill auto-generation |

## Specification

| Document | Summary |
|----------|---------|
| [rpc-methods](/spec/rpc-methods/) | Every JSON-RPC method exposed by the Bun service, with params and result shapes |
| [pipeline-yaml](/spec/pipeline-yaml/) | Pipeline YAML schema (PipelineDefinition, NodeAction, MatchCondition) with examples |
| [database-schema](/spec/database-schema/) | SQLite tables and the migration order that produces them |

## Glossary

| Term | Description |
|------|-------------|
| **Pipeline** | A YAML-defined directed graph of nodes that executes when a trigger fires |
| **Node** | One step in a pipeline. Has an `id`, a `name`, and an optional `action` (`shell_command`, `http_request`, `llm_call`, or `chat_send`) |
| **Trigger** | What starts a pipeline run — currently `cron` or `discord` |
| **Adapter** | A self-registering plugin under `apps/bun-service/src/adapters/`. LLM adapters expose `executePrompt`; chat adapters expose `sendMessage` and a listener loop |
| **seher-bridge** | Rust binary (built from the `seher` crate, bundled in the `.app`) that resolves the highest-priority available coding agent (Anthropic / Copilot / OpenAI) given the user's settings and runs it on the Rust `pi` engine. The Bun service talks to it over NDJSON on stdio |
| **Skill** | A reusable Markdown prompt body, optionally auto-generated from execution traces |
| **Memory** | An FTS5-backed SQLite store of past chat turns and execution traces, periodically summarized into `kind=summary` entries |

## Legacy

The previous Tauri/Rust framework documentation (Layer/DTO/DirectedGraphBuilder, tokio runtime, OpenTelemetry exporter, `crab new` CLI) lives under [`legacy/`](/legacy/) for reference. **It does not describe the current implementation.**
