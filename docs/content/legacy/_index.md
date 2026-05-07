+++
title = "Legacy documentation"
sort_by = "weight"
weight = 99
template = "section.html"
+++

> **Heads up.** Everything under this section describes the previous Tauri (Rust) + React stack — `Layer` / `DTO` / `DirectedGraphBuilder` traits, the `tokio` runtime, the OpenTelemetry exporter, the `crab new` CLI, and the distroless Docker target. **None of that exists in the current implementation.** It is preserved here so older releases and external references keep working; for an accurate picture of the running system, read the top-level [design](/design/) and [spec](/spec/) sections instead.

## Legacy design documents

| Document | Summary |
|----------|---------|
| [architecture](/legacy/design/architecture/) | Tauri/Rust framework overview |
| [data-flow](/legacy/design/data-flow/) | Layer-to-Layer DTO data flow |
| [graph-engine](/legacy/design/graph-engine/) | DirectedGraphBuilder execution engine |
| [claude-code-integration](/legacy/design/claude-code-integration/) | Claude Code subprocess integration |

## Legacy specifications

| Document | Summary |
|----------|---------|
| [layer](/legacy/spec/node/) | Node trait specification |
| [dto](/legacy/spec/dto/) | Dto trait specification |
| [graph](/legacy/spec/graph/) | DirectedGraph specification |
| [chat](/legacy/spec/chat/) | Chat input layer specification |
| [storage](/legacy/spec/storage/) | Storage specification |
