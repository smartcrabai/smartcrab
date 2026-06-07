+++
title = "Design"
sort_by = "weight"
weight = 2
template = "section.html"
+++

Design documents describe how SmartCrab is put together and why. For concrete API and schema definitions, read the [spec](/spec/) section.

| Document | Summary |
|----------|---------|
| [architecture](/design/architecture/) | Process model — SwiftUI host, Bun child, stdio JSON-RPC, SQLite, startup sequence |
| [pipeline-engine](/design/pipeline-engine/) | YAML pipeline DAG executor — node actions, conditional routing, parallel siblings, fan-in |
| [llm-routing](/design/llm-routing/) | seher-bridge router and how Settings drives `seher-config.yaml` |
| [memory-and-skills](/design/memory-and-skills/) | FTS5 memory store, 30-minute summarization loop, skill auto-generation |
