+++
title = "SmartCrab Documentation"
sort_by = "weight"
weight = 1
+++

SmartCrab is a Rust framework implementing the "Tool-to-AI" paradigm. It uses conditional branching in a DAG to decide whether to invoke AI (Claude Code) based on the results of non-AI processing.

## How to Read This Documentation

This documentation is divided into two categories: **Design (design/)** and **Specification (spec/)**.

| Category | Content | Audience |
|---------|---------|---------|
| **design/** | Why & How — rationale behind design decisions and how they are realized | Those who want to understand the architecture |
| **spec/** | What — concrete trait definitions, APIs, and command specifications | Those who implement or use the framework |

Reading the design docs first, then the spec docs, gives you context-grounded understanding.

## Document Index

### Design Documents (design/)

| Document | Summary |
|-------------|------|
| [architecture](/design/architecture/) | Overall architecture — the "Tool-to-AI" paradigm, system overview, concurrent execution model |
| [data-flow](/design/data-flow/) | Data flow design — data flow between Layers, type safety, error handling |
| [dag-engine](/design/dag-engine/) | DAG engine design — execution engine, conditional branching, validation, lifecycle |
| [claude-code-integration](/design/claude-code-integration/) | Claude Code integration design — subprocess execution, data exchange, test strategy |
| [cli](/design/cli/) | CLI tool design — Rails-like developer experience, command structure, templates |

### Specification Documents (spec/)

| Document | Summary |
|-------------|------|
| [layer](/spec/layer/) | Layer specification — trait definitions and code examples for Input/Hidden/Output Layers |
| [dto](/spec/dto/) | DTO specification — the Dto trait, naming conventions, conversions, and code examples |
| [graph](/spec/graph/) | DirectedGraph specification — DirectedGraphBuilder API, execution semantics, validation |
| [cli](/spec/cli/) | CLI command specification — details of `crab new` / `generate` / `run` |

## Glossary

| Term | Description |
|------|------|
| **Layer** | A processing unit (node) in the graph. There are three kinds: Input, Hidden, and Output |
| **Input Layer** | A Layer that receives external events and produces a DTO. Has subtypes: chat, cron, and http |
| **Hidden Layer** | An intermediate processing Layer that receives a DTO, transforms it, and returns a DTO. Can invoke Claude Code |
| **Output Layer** | A Layer that receives a DTO and performs final side effects (notifications, persistence, etc.). Can invoke Claude Code |
| **DTO** | Data Transfer Object. A type-safe Rust struct used to pass data between Layers |
| **DirectedGraph** | A directed graph that defines the execution order and conditional branching of Layers. Supports cycles |
| **Node** | A node in the graph. Corresponds to one Layer |
| **Edge** | An edge in the graph. Represents a transition between Nodes. Conditional edges use closures for branching logic |
| **DirectedGraphBuilder** | API for constructing a DirectedGraph using the builder pattern |
| **Claude Code** | Anthropic's AI coding tool. Can be invoked as a subprocess from Hidden/Output Layers |
| **SmartCrab.toml** | Project configuration file |
