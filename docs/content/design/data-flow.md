+++
title = "Data Flow"
description = "Data flow design — data flow between Layers, type safety, error handling"
weight = 2
+++

## Overall Flow

The data flow in SmartCrab follows the pattern: Input → DTO → Hidden → DTO → Output. Data transfer between each Node is mediated by type-safe DTOs.

{% mermaid() %}
flowchart TD
    subgraph Input["Input Layer"]
        I[chat / cron / http]
    end
    subgraph DTO1["DTO"]
        D1["InputOutput"]
    end
    subgraph Hidden["Hidden Layer"]
        H[Transform / Process / AI decision]
    end
    subgraph DTO2["DTO"]
        D2["HiddenOutput"]
    end
    subgraph Output["Output Layer"]
        O[Notify / Persist / Respond]
    end

    I -->|"Result&lt;DTO&gt;"| D1
    D1 -->|"DTO"| H
    H -->|"Result&lt;DTO&gt;"| D2
    D2 -->|"DTO"| O
    O -->|"Result&lt;()&gt;"| Done["Done"]
{% end %}

## Node Signature Design

Each Node specifies its input and output DTO types via associated types. See [Node Spec](/spec/node) for the full trait definitions.

- **InputNode**: no input → produces a DTO
- **HiddenNode**: receives a DTO → returns a DTO
- **OutputNode**: receives a DTO → performs side effects

## Data Flow in Conditional Branching

In conditional edges, the output DTO of the preceding Node is inspected to determine the branch target. The condition closure receives a reference to the DTO and returns the identifier of the branch target.

{% mermaid() %}
flowchart TD
    A[Hidden Node A] -->|"AnalysisOutput"| Cond{"Condition closure<br/>Fn(&AnalysisOutput) → &str"}
    Cond -->|"needs_ai"| B[Hidden Node B<br/>Claude Code invocation]
    Cond -->|"simple"| C[Hidden Node C<br/>Normal processing]
    B --> D[Output Node D]
    C --> D
{% end %}

The string returned by the condition closure corresponds to a key in the branch map defined by `add_conditional_edge`.

## Error Handling Strategy

Errors are handled at two levels.

### Errors Within a Layer

Each Layer's `run` method returns a `Result`. Errors occurring within a Node are converted to the appropriate `Error` type as the Layer's responsibility.

```rust
// Example of error handling within a Layer
async fn run(&self, input: Self::Input) -> Result<Self::Output> {
    let response = self.client.get(&input.url)
        .await
        .map_err(|e| SmartCrabError::LayerExecution {
            layer: "FetchData",
            source: e.into(),
        })?;
    // ...
}
```

### Graph-Level Errors

If a Node returns `Err`, the Graph engine stops execution and propagates the error to the caller.

{% mermaid() %}
flowchart TD
    A[Layer A] -->|Ok| B[Layer B]
    B -->|Err| Stop["Graph execution stopped<br/>Error recorded in trace"]
    B -->|Ok| C[Layer C]
    C -->|Ok| Done["Done"]
{% end %}

- On error, the error information is recorded in the relevant Layer's span
- The Graph stops execution immediately (subsequent Layers are not executed)
- Other Graphs are not affected (Graphs are independent of each other)

## Scope of Type Safety Guarantees

### Compile-Time Guarantees

- DTO type matching via each Layer's `Input` / `Output` associated types
- `Dto` trait derive requirements (`Serialize`, `Deserialize`, `Clone`, `Send`, `Sync`)

### Runtime Validation

- Edge type consistency check at Graph build time (matching Output type of one Node with Input type of the next)
- Exhaustiveness check for conditional branches (all branch targets exist)
- Graph structure validation (cycle detection, unreachable node detection)

Static checks via type parameters guarantee safety at compile time where possible. Validation related to the Graph's structure is performed as a runtime check at `build()` time.
