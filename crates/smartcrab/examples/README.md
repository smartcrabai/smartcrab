# SmartCrab Examples

This directory contains runnable examples demonstrating various `DirectedGraph` patterns.
Each example includes an SVG visualization in [`figures/`](./figures/).

## Running Examples

```sh
cargo run -p smartcrab --example <example_name>
```

---

## 1. Basic Pipeline

**File:** [`basic_pipeline.rs`](./basic_pipeline.rs)

The simplest graph — a linear Input → Hidden → Output chain.

![basic_pipeline](./figures/basic_pipeline.svg)

---

## 2. Multi-Transform

**File:** [`multi_transform.rs`](./multi_transform.rs)

Multiple hidden nodes chained to perform staged data transformations.

![multi_transform](./figures/multi_transform.svg)

---

## 3. Conditional Branch

**File:** [`conditional_branch.rs`](./conditional_branch.rs)

Uses `add_conditional_edge` to route data through different paths based on runtime conditions.

![conditional_branch](./figures/conditional_branch.svg)

---

## 4. Loop with Exit

**File:** [`loop_with_exit.rs`](./loop_with_exit.rs)

A self-loop (`add_edge("A", "A")`) combined with `add_exit_condition` to repeat processing until a threshold is met.

![loop_with_exit](./figures/loop_with_exit.svg)

---

## 5. Fan-Out

**File:** [`fan_out.rs`](./fan_out.rs)

A single input fans out to multiple independent outputs.

![fan_out](./figures/fan_out.svg)

---

## 6. Fan-In

**File:** [`fan_in.rs`](./fan_in.rs)

Multiple independent input sources converge into a single processing node.

![fan_in](./figures/fan_in.svg)

---

## 7. Diamond

**File:** [`diamond.rs`](./diamond.rs)

A diamond-shaped dependency graph: input splits into parallel branches that converge before the output.

![diamond](./figures/diamond.svg)

---

## 8. Complex Pipeline

**File:** [`complex_pipeline.rs`](./complex_pipeline.rs)

Combines conditional branching and multi-stage processing in a single graph.

![complex_pipeline](./figures/complex_pipeline.svg)

---

## 9. Chatbot

**File:** [`chatbot.rs`](./chatbot.rs)

Simulates an AI chatbot pipeline: message reception → agent processing → response delivery.

![chatbot](./figures/chatbot.svg)

---

## 10. Data Enrichment

**File:** [`data_enrichment.rs`](./data_enrichment.rs)

A multi-stage pipeline that fetches, validates, enriches, transforms, and stores user profiles.

![data_enrichment](./figures/data_enrichment.svg)

---

## 11. Multi-Graph Runtime

**File:** [`multi_graph_runtime.rs`](./multi_graph_runtime.rs)

Uses `Runtime` to execute multiple independent graphs concurrently.

![multi_graph_runtime](./figures/multi_graph_runtime.svg)

---

## Visualization

The SVG figures were generated using [Graphviz](https://graphviz.org/) DOT format,
matching the output style of `smartcrab viz --format dot`.

Node shapes:
- **Rounded box** — Input node
- **Box** — Hidden node
- **Hexagon** — Output node
