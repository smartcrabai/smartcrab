+++
title = "Specification"
sort_by = "weight"
weight = 3
template = "section.html"
+++

Specification documents pin down the wire-level shapes that SwiftUI and the Bun service rely on. For motivation and high-level structure, read the [design](/design/) section first.

| Document | Summary |
|----------|---------|
| [rpc-methods](/spec/rpc-methods/) | Every JSON-RPC method exposed by the Bun service, with params and result shapes |
| [pipeline-yaml](/spec/pipeline-yaml/) | Pipeline YAML schema (PipelineDefinition, NodeAction, MatchCondition) with examples |
| [database-schema](/spec/database-schema/) | SQLite tables and the migration order that produces them |
