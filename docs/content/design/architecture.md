+++
title = "Architecture"
description = "Overall architecture — the \"Tool-to-AI\" paradigm, system overview, concurrent execution model"
weight = 1
+++

## The "Tool-to-AI" Paradigm

Traditional AI agent frameworks (such as OpenClaw) are based on the "AI-to-Tool" paradigm: AI takes the lead and calls tools as needed.

SmartCrab inverts this with the "Tool-to-AI" paradigm. Normal processing (HTTP request handling, cron jobs, chat message reception, etc.) executes first, and the results are used in conditional branching to decide whether to invoke AI.

```
Traditional: AI → Tool
  ┌──────┐    ┌──────┐    ┌──────┐
  │  AI  │───▶│ Tool │───▶│  AI  │───▶ ...
  └──────┘    └──────┘    └──────┘
  AI leads and calls tools

SmartCrab: Tool → AI
  ┌──────┐    ┌───────────┐    ┌──────────────┐
  │Input │───▶│ Condition │───▶│ Claude Code  │───▶ ...
  └──────┘    └───────────┘    └──────────────┘
  Non-AI processing runs first, AI is activated conditionally
```

Benefits of this approach:

- **Cost efficiency**: AI is invoked only when necessary
- **Predictability**: Non-AI processing operates deterministically
- **Testability**: Processing paths without AI can be verified with ordinary unit tests
- **Control**: Programmers explicitly define the conditions under which AI is invoked

## System Overview

{% mermaid() %}
C4Context
    title SmartCrab System Context

    Person(dev, "Developer", "Developer building applications with SmartCrab")

    System(smartcrab, "SmartCrab Application", "Application built on the SmartCrab framework by developers")

    System_Ext(claude, "Claude Code", "Anthropic AI coding tool (subprocess execution)")
    System_Ext(discord, "Discord / Chat", "Chat platform")
    System_Ext(http_client, "HTTP Client", "External HTTP client")
    System_Ext(jaeger, "Jaeger", "Distributed tracing UI")

    Rel(dev, smartcrab, "Develop and run with smartcrab CLI")
    Rel(smartcrab, claude, "Conditionally execute as child process")
    Rel(discord, smartcrab, "DM / mention")
    Rel(http_client, smartcrab, "HTTP request")
    Rel(smartcrab, jaeger, "OpenTelemetry traces")
{% end %}

## The Three Core Elements

A SmartCrab application is composed of three elements: **Layer**, **DTO**, and **Graph**.

{% mermaid() %}
classDiagram
    class Node {
        <<trait>>
    }
    class InputNode {
        <<trait>>
        +run() Result~Output~
    }
    class HiddenNode {
        <<trait>>
        +run(input: Input) Result~Output~
    }
    class OutputNode {
        <<trait>>
        +run(input: Input) Result~()~
    }
    class Dto {
        <<trait>>
        Serialize + Deserialize + Clone + Send + Sync
    }
    class DirectedGraphBuilder {
        +new(name) DirectedGraphBuilder
        +add_input(layer) DirectedGraphBuilder
        +add_hidden(layer) DirectedGraphBuilder
        +add_output(layer) DirectedGraphBuilder
        +add_edge(from, to) DirectedGraphBuilder
        +add_conditional_edge(from, condition, branches) DirectedGraphBuilder
        +build() Result~DirectedGraph~
    }
    class DirectedGraph {
        +run() Result~()~
    }

    Node <|-- InputNode
    Node <|-- HiddenNode
    Node <|-- OutputNode
    InputNode ..> Dto : produces
    HiddenNode ..> Dto : consumes / produces
    OutputNode ..> Dto : consumes
    DirectedGraphBuilder --> DirectedGraph : builds
    DirectedGraph --> Node : executes
    DirectedGraph --> Dto : transfers
{% end %}

- **Layer**: The minimal processing unit. Three kinds: Input, Hidden, and Output
- **DTO**: A type-safe struct for passing data between Layers
- **Graph**: A graph defining the execution order and conditional branching of Layers

## Concurrent Execution Model

SmartCrab runs multiple Graphs simultaneously in a single process. Each Graph operates as an independent async task on the tokio runtime.

{% mermaid() %}
flowchart TB
    subgraph Process["SmartCrab Process"]
        subgraph Runtime["tokio Runtime"]
            subgraph Task1["Graph 1 (HTTP)"]
                L1[Input: HTTP] --> L2[Hidden: Parse]
                L2 --> L3[Output: Respond]
            end
            subgraph Task2["Graph 2 (Cron)"]
                L4[Input: Cron] --> L5[Hidden: Check]
                L5 --> L6[Output: Notify]
            end
            subgraph Task3["Graph 3 (Chat)"]
                L7[Input: Chat] --> L8[Hidden: Analyze]
                L8 --> L9[Output: Reply]
            end
        end
    end
{% end %}

- Each Graph runs as an independent async task
- Layers within a Graph are executed sequentially in the order defined by the Graph (parallel edges run in parallel)
- Claude Code invocations are executed asynchronously as child processes
- Graceful shutdown propagates to all Graphs upon receiving SIGTERM / SIGINT

## Observability

SmartCrab includes structured tracing via OpenTelemetry out of the box.

### Span Structure

```
smartcrab                          # Root span
├── graph::{graph_name}            # Span for Graph execution
│   ├── layer::{layer_name}        # Span for each Node execution
│   │   ├── claude_code::invoke    # Claude Code invocation (when applicable)
│   │   └── ...
│   ├── edge::{from}→{to}         # Span for edge transition
│   │   └── condition::evaluate    # Condition evaluation (for conditional edges)
│   └── ...
└── ...
```

### Trace Destination

SmartCrab uses the standard OpenTelemetry OTLP exporter. The export destination can be configured via standard OTEL environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | OTLP endpoint URL |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` | Transport protocol (`grpc` or `http/protobuf`) |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | Additional headers (e.g. for authentication) |

Any OTLP-compatible backend (Jaeger, Grafana Tempo, Datadog, etc.) can receive traces.

## Deployment

### Docker Configuration

`crab new` generates a Dockerfile for a multi-stage build that produces a minimal production image based on `gcr.io/distroless/static-debian12:nonroot`.
