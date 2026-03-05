+++
title = "Graph Engine"
description = "Graph engine design — execution engine, conditional branching, validation, lifecycle"
weight = 3
+++

## Conceptual Model

SmartCrab's Graph (directed graph) is a graph structure that defines the execution order and conditional branching of Layers.

- **Node**: Corresponds to one Layer. Calls the Layer's `run` method at execution time
- **Edge**: Represents a transition between Nodes. There are two kinds: unconditional edges and conditional edges

{% mermaid() %}
flowchart LR
    subgraph Graph
        A["Node A<br/>(Input Layer)"]
        B["Node B<br/>(Hidden Layer)"]
        C["Node C<br/>(Hidden Layer)"]
        D["Node D<br/>(Output Layer)"]

        A -->|"Unconditional edge"| B
        B -->|"Conditional edge<br/>needs_ai = true"| C
        B -->|"Conditional edge<br/>needs_ai = false"| D
        C -->|"Unconditional edge"| D
    end
{% end %}

## Builder Pattern API Design

Graphs are constructed using the builder pattern. Method chaining allows declarative definition, and `build()` at the end produces a validated Graph.

```rust
let graph = DirectedGraphBuilder::new("my_pipeline")
    .add_input(HttpInput::new(addr))
    .add_hidden(DataAnalyzer::new())
    .add_hidden(AiProcessor::new())
    .add_hidden(SimpleProcessor::new())
    .add_output(SlackNotifier::new(webhook))
    .add_edge("HttpInput", "DataAnalyzer")
    .add_conditional_edge(
        "DataAnalyzer",
        |output: &AnalysisOutput| {
            if output.needs_ai { "ai" } else { "simple" }
        },
        [
            ("ai", "AiProcessor"),
            ("simple", "SimpleProcessor"),
        ],
    )
    .add_edge("AiProcessor", "SlackNotifier")
    .add_edge("SimpleProcessor", "SlackNotifier")
    .build()?;
```

### Design Principles

- **Type erasure**: `add_input` / `add_hidden` / `add_output` accept the respective Layer traits and store them internally as `Box<dyn Layer>`. This allows Layers of different types to coexist in the same Graph
- **Name-based references**: Edges reference Nodes by the Layer's `name()`. A design decision to avoid type parameter explosion
- **Deferred validation**: Type consistency and graph structure validation are performed all at once during `build()`

## Execution Engine Design

### Topological Sort

At `build()` time, the Graph's nodes are topologically sorted to determine the execution order.

{% mermaid() %}
flowchart TD
    subgraph "Topological Sort Result"
        direction TB
        Step1["Step 1: HttpInput"]
        Step2["Step 2: DataAnalyzer"]
        Step3["Step 3a: AiProcessor / Step 3b: SimpleProcessor<br/>(conditional branch)"]
        Step4["Step 4: SlackNotifier"]
    end
    Step1 --> Step2 --> Step3 --> Step4
{% end %}

### Execution Flow

{% mermaid() %}
flowchart TD
    Start([Graph execution start]) --> ExecNode[Execute current Node]
    ExecNode --> CheckResult{Result?}
    CheckResult -->|Ok| HasEdge{Outgoing edges?}
    CheckResult -->|Err| Error([Error: Graph stops])
    HasEdge -->|Unconditional edge| NextNode[Go to next Node]
    HasEdge -->|Conditional edge| EvalCond[Evaluate condition closure]
    HasEdge -->|No edges| Done([Graph complete])
    EvalCond --> SelectBranch[Select branch Node]
    SelectBranch --> NextNode
    NextNode --> ExecNode
{% end %}

### Parallel Execution

When multiple unconditional edges originate from the same Node, the successor Nodes can be executed in parallel.

{% mermaid() %}
flowchart TD
    A[Node A] --> B[Node B]
    A --> C[Node C]
    B --> D[Node D]
    C --> D
{% end %}

In the above case, Node B and Node C are executed in parallel via `tokio::join!`. Node D executes only after both B and C have completed.

## Conditional Branching Implementation Design

### AI Invocation Decision Pattern

The core function of SmartCrab is "deciding whether to invoke AI based on conditions." A typical pattern:

{% mermaid() %}
flowchart TD
    Input[Input Layer<br/>Receive event] --> Analyze[Hidden Layer<br/>Rule-based analysis]
    Analyze --> Cond{"Condition check<br/>Is AI needed?"}
    Cond -->|"needs_ai"| AI[Hidden Layer<br/>Execute Claude Code]
    Cond -->|"simple"| Simple[Hidden Layer<br/>Template response]
    AI --> Output[Output Layer]
    Simple --> Output
{% end %}

Examples of condition decisions:

```rust
// AI invocation decision based on complexity score
|output: &AnalysisOutput| {
    if output.complexity_score > 0.7 { "needs_ai" } else { "simple" }
}

// Decision based on keywords
|output: &AnalysisOutput| {
    if output.requires_reasoning { "needs_ai" } else { "simple" }
}

// Multiple branch targets
|output: &ClassificationOutput| {
    match output.category.as_str() {
        "bug_report" => "ai_triage",
        "feature_request" => "template_response",
        "question" => "ai_answer",
        _ => "fallback",
    }
}
```

## Graph Validation

The following validations are performed at `build()` time. If any validation fails, `Err` is returned.

### Cycle Detection

Cycles are detected using depth-first search (DFS).

```
Detection algorithm: DFS + visit state tracking
  - White: unvisited
  - Gray: in progress (ancestor)
  - Black: exploration complete

If a Gray → Gray edge is found, a cycle exists
```

### Unreachable Node Detection

Nodes that cannot be reached from input nodes (nodes with in-degree 0) are detected.

### Type Consistency Check

For two Nodes connected by an edge, the `Output` type of the preceding Node and the `Input` type of the succeeding Node are verified to match. Since types are erased, this is a runtime check using `TypeId`.

### Validation Error Types

| Error | Description |
|--------|------|
| `CycleDetected` | A cycle exists in the Graph |
| `UnreachableNode` | A node unreachable from the input node exists |
| `TypeMismatch` | DTO type mismatch between adjacent nodes |
| `MissingBranch` | A branch target node for a conditional edge does not exist |
| `NoInputNode` | No input node (Input Layer) exists in the Graph |
| `DuplicateNodeName` | Multiple nodes with the same name are registered |

## Graph Lifecycle

{% mermaid() %}
stateDiagram-v2
    [*] --> Building: DirectedGraphBuilder::new()
    Building --> Building: add_input / add_hidden / add_output / add_edge
    Building --> Ready: build() succeeds
    Building --> [*]: build() fails (validation error)
    Ready --> Running: run()
    Running --> Running: Layer executing
    Running --> Completed: All Layers complete
    Running --> Failed: Layer returned an error
    Running --> ShuttingDown: Shutdown signal received
    ShuttingDown --> Failed: Stop after current Layer completes
    Completed --> [*]
    Failed --> [*]
{% end %}

### Graceful Shutdown

When SIGTERM / SIGINT is received via `tokio::signal`:

1. Wait for the currently running Layer to complete (no mid-execution interruption)
2. Do not execute subsequent Layers
3. Close OpenTelemetry spans and flush traces
4. Exit with exit code 0

When multiple Graphs are running concurrently, the shutdown signal propagates to all Graphs via a `tokio::sync::broadcast` channel.
