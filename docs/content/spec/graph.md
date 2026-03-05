+++
title = "DirectedGraph Specification"
description = "DirectedGraph specification — DirectedGraphBuilder API, execution semantics, validation"
weight = 3
+++

## Overview

A DirectedGraph (directed graph) is a graph structure that defines the execution order and conditional branching of Layers. It is constructed using the builder pattern, and `build()` produces a validated, executable DirectedGraph.

Unlike a DAG, graphs containing cycles (directed circuits) are also supported.

## DirectedGraphBuilder API

### `DirectedGraphBuilder::new`

```rust
pub fn new(name: impl Into<String>) -> Self
```

Creates a new DirectedGraphBuilder. `name` is used as the span name in traces.

### `add_input`

```rust
pub fn add_input<L: InputLayer>(self, layer: L) -> Self
```

Adds an Input Layer.

### `add_hidden`

```rust
pub fn add_hidden<L: HiddenLayer>(self, layer: L) -> Self
```

Adds a Hidden Layer.

### `add_output`

```rust
pub fn add_output<L: OutputLayer>(self, layer: L) -> Self
```

Adds an Output Layer.

### `add_edge`

```rust
pub fn add_edge(self, from: &str, to: &str) -> Self
```

Adds an unconditional edge. After the `from` node completes execution, the `to` node is executed.

### `add_conditional_edge`

```rust
pub fn add_conditional_edge<F, I>(
    self,
    from: &str,
    condition: F,
    branches: I,
) -> Self
where
    F: Fn(&dyn DtoObject) -> Option<String> + Send + Sync + 'static,
    I: IntoIterator<Item = (String, String)>,
```

Adds a conditional edge. The output DTO of the `from` node is passed to the `condition` closure, and execution transitions to the branch node corresponding to the return value.

- `Some(branch_key)` → Transition to the specified branch
- `None` → End graph execution

### `add_exit_condition`

```rust
pub fn add_exit_condition<F>(self, from: &str, condition: F) -> Self
where
    F: Fn(&dyn DtoObject) -> Option<String> + Send + Sync + 'static,
```

Adds an exit condition. After the `from` node executes, the condition closure is evaluated. If it returns `None`, the entire graph's execution ends.

### `build`

```rust
pub fn build(self) -> Result<DirectedGraph>
```

Validates the graph and returns an executable `DirectedGraph` instance. Returns `Err` if validation fails.

Validation includes:
- DTO type consistency check
- Branch target existence check for conditional edges
- Input Layer existence check
- Node name uniqueness check

Note: Unlike a DAG, cycle detection and unreachable node detection are not performed.

## Condition Closure Signature

```rust
Fn(&dyn DtoObject) -> Option<String> + Send + Sync + 'static
```

- Input: A reference to the output DTO of the preceding Layer (`&dyn DtoObject`)
- Output: The label of the branch target (corresponds to a key in `branches`), or `None` to terminate
- `Send + Sync`: Safely shareable across async tasks
- `'static`: Valid for the lifetime of the Graph

## Execution Semantics

### Basic Behavior

The graph executes in the following loop:

1. Find executable nodes (all input dependencies are complete)
2. If no executable nodes → terminate
3. Execute executable nodes in parallel
4. Save each node's result
5. Check exit condition (terminate if exit condition returns `None`)
6. Return to step 1

### Dependency Resolution

- Unconditional edge: The output of the `from` node is used as the input to the `to` node
- Conditional edge: The branch target is determined based on the condition evaluation result

### Termination Conditions

Graph execution terminates under any of the following conditions:

1. No more executable nodes
2. An exit condition (`add_exit_condition`) returns `None`
3. Any node returns an error

## Code Examples

### Basic Graph

```rust
use smartcrab::prelude::*;

let graph = DirectedGraphBuilder::new("simple_pipeline")
    .add_input(HttpInput::new("0.0.0.0:3000"))
    .add_hidden(DataProcessor::new())
    .add_output(JsonResponder::new())
    .add_edge("HttpInput", "DataProcessor")
    .add_edge("DataProcessor", "JsonResponder")
    .build()?;

graph.run().await?;
```

### Conditional Branching Graph

```rust
use smartcrab::prelude::*;

let graph = DirectedGraphBuilder::new("ai_routing")
    .add_input(ChatInput::new(discord_token))
    .add_hidden(MessageAnalyzer::new())
    .add_hidden(AiResponder::new())
    .add_hidden(TemplateResponder::new())
    .add_output(DiscordOutput::new(discord_token))
    .add_edge("ChatInput", "MessageAnalyzer")
    .add_conditional_edge(
        "MessageAnalyzer",
        |output: &dyn DtoObject| {
            let result = output.downcast_ref::<AnalysisOutput>().unwrap();
            if result.complexity_score > 0.7 {
                Some("ai".to_owned())
            } else {
                Some("template".to_owned())
            }
        },
        vec![("ai".to_owned(), "AiResponder".to_owned()), ("template".to_owned(), "TemplateResponder".to_owned())],
    )
    .add_edge("AiResponder", "DiscordOutput")
    .add_edge("TemplateResponder", "DiscordOutput")
    .build()?;
```

### Graph With a Cycle

```rust
use smartcrab::prelude::*;

let graph = DirectedGraphBuilder::new("feedback_loop")
    .add_input(SourceLayer)
    .add_hidden(ProcessLayer)
    .add_hidden(FeedbackLayer)
    .add_output(ExitLayer)
    .add_edge("Source", "Process")
    .add_edge("Process", "Feedback")
    .add_edge("Feedback", "Feedback")  // self-loop
    .add_edge("Feedback", "Exit")
    .add_exit_condition("Feedback", |output| {
        if output.downcast_ref::<FeedbackOutput>().unwrap().should_continue {
            Some("continue".to_owned())
        } else {
            None  // terminate
        }
    })
    .build()?;
```

### Running Multiple Graphs Concurrently

```rust
use smartcrab::prelude::*;
use smartcrab::runtime::Runtime;

#[tokio::main]
async fn main() -> Result<()> {
    // Graph 1: HTTP API
    let api_graph = DirectedGraphBuilder::new("api")
        .add_input(HttpInput::new("0.0.0.0:3000"))
        .add_hidden(RequestHandler::new())
        .add_output(JsonResponder::new())
        .add_edge("HttpInput", "RequestHandler")
        .add_edge("RequestHandler", "JsonResponder")
        .build()?;

    // Graph 2: Scheduled batch
    let batch_graph = DirectedGraphBuilder::new("batch")
        .add_input(CronInput::new("0 */6 * * * * *"))
        .add_hidden(DataCollector::new())
        .add_hidden(AiSummarizer::new())
        .add_output(SlackNotifier::new(webhook))
        .add_edge("CronInput", "DataCollector")
        .add_edge("DataCollector", "AiSummarizer")
        .add_edge("AiSummarizer", "SlackNotifier")
        .build()?;

    // Run all graphs concurrently
    Runtime::new()
        .add_graph(api_graph)
        .add_graph(batch_graph)
        .run()
        .await
}
```
