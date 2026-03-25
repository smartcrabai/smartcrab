# SmartCrab Documentation

SmartCrab is a Rust framework that realizes the "tool -> AI" paradigm. It uses conditional branching in the Graph to decide whether to invoke AI (Claude Code) based on the results of non-AI processing.

## How to Read the Documentation

This documentation is divided into two categories: **design (design/)** and **specification (spec/)**.

| Category | Content | Target Audience |
|---------|------|---------|
| **design/** | Why & How — why this design was chosen, how it is realized | Those who want to understand the architecture |
| **spec/** | What — concrete trait definitions, APIs, command specifications | Those implementing or using the framework |

Reading design first and then specification gives you a background-informed understanding.

## Document Index

### Design Documents (design/)

| Document | Summary |
|-------------|------|
| [architecture.md](design/architecture.md) | Overall architecture — "tool -> AI" paradigm, system overview, concurrent execution model |
| [data-flow.md](design/data-flow.md) | Data flow design — data flow between Layers, type safety, error handling |
| [graph-engine.md](design/graph-engine.md) | Graph engine design — execution engine, conditional branching, validation, lifecycle |
| [claude-code-integration.md](design/claude-code-integration.md) | Claude Code integration design — child process execution, data exchange, test strategy |
| [cli.md](design/cli.md) | CLI tool design — Rails-like development experience, command structure, templates |

### Specifications (spec/)

| Document | Summary |
|-------------|------|
| [layer.md](spec/layer.md) | Layer specification — trait definitions and code examples for Input/Hidden/Output Layers |
| [dto.md](spec/dto.md) | DTO specification — Dto trait, naming conventions, conversions, code examples |
| [graph.md](spec/graph.md) | DirectedGraph specification — DirectedGraphBuilder API, execution semantics, validation |
| [cli.md](spec/cli.md) | CLI command specification — details of `crab new` / `generate` / `run` |

## Glossary

| Term | Description |
|------|------|
| **Layer** | A processing unit (node) in the graph. Three types: Input / Hidden / Output |
| **Input Layer** | A Layer that receives external events and generates a DTO. Has subtypes: chat / cron / http |
| **Hidden Layer** | An intermediate processing Layer that receives a DTO, transforms it, and returns a DTO. Can invoke Claude Code |
| **Output Layer** | A Layer that receives a DTO and executes final side effects (notifications, storage, etc.). Can invoke Claude Code |
| **DTO** | Data Transfer Object. A type-safe Rust struct used for data passing between Layers |
| **DirectedGraph** | A directed graph that defines the execution order and conditional branching of Layers. Also supports cycles |
| **Node** | A node in the graph. Corresponds to one Layer |
| **Edge** | An edge in the graph. Represents a transition between Nodes. Conditional edges use closures for branching logic |
| **DirectedGraphBuilder** | API for constructing a DirectedGraph using the builder pattern |
| **Claude Code** | Anthropic's AI coding tool. Can be executed as a child process from Hidden/Output Layers |
| **SmartCrab.toml** | Project configuration file |
