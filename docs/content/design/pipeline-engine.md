+++
title = "Pipeline engine"
description = "YAML pipeline DAG executor — node actions, conditional routing, parallel siblings, fan-in"
weight = 2
+++

A pipeline is a YAML document that describes a directed graph of nodes plus a trigger that fires it. The executor walks that graph topologically, runs sibling nodes in parallel, gathers fan-in inputs, and routes through conditional edges based on each node's output.

For the wire-level YAML schema, see [spec/pipeline-yaml](/spec/pipeline-yaml/). This document describes the executor's behaviour.

## Lifecycle of one execution

```
pipeline.execute (RPC)
       │
       v
parsePipeline(yaml) ─────┐
       │                 │  validation only
       v                 │
insertExecution(row) <───┘
       │
       v
async iterator: executePipeline(resolved, input, deps)
       │
       │  yield execution_started
       │  yield node_started   × N
       │  yield node_completed × N   (or node_failed once on error)
       │  yield execution_completed
       v
finalizeExecution(id, status, errorMessage?)
```

`pipeline.execute` returns the execution id **immediately**; the iterator runs in a background IIFE. Callers that want progress events would attach a sink to `ctx.emit` — see the closing notes for the current state of streaming.

## Building the graph

`buildGraph(resolved)` walks every `NodeDefinition` once and produces:

- `nodes: Map<string, NodeDefinition>` — id → node
- `successors: Map<string, string[]>` — static `next` edges (string or string[])
- `predecessorCounts: Map<string, number>` — how many upstream edges each node has, used to decide when a fan-in node is ready
- `compiledRegexes: Map<string, RegExp>` — lazily compiled per-pattern; an invalid pattern is silently dropped (the rule then never matches)

Nodes with `predecessorCounts === 0` start in the **ready queue**, sorted by id for deterministic ordering.

## The scheduling loop

The executor maintains:

- `ready: string[]` — node ids waiting to be spawned
- `inflight: Set<Promise<TaskResult>>` — currently running node tasks
- `pendingPreds: Map<string, number>` — remaining upstream edges per node
- `upstreamOutputs: Map<string, Map<string, unknown>>` — which upstream produced what, for fan-in normalisation

Each iteration of the main loop:

1. **Cancellation check** — if `options.isCancelled` returns true, drain in-flight tasks and yield `execution_completed` with `status: "cancelled"`.
2. **Spawn ready nodes** — for every id in `ready`, ask `LoopGuard` to bump its iteration counter (default cap `100`, override with `max_loop_count` on the pipeline). Yield `node_started`. Compute the node input via `normalizeFanIn(upstream)`: zero predecessors → the original pipeline input; one predecessor → that single value; many → `{ upstream: { srcId: output, ... } }`.
3. **Wait for one** — `await Promise.race(inflight)` returns the first task to settle (success or failure).
4. **On failure** — yield `node_failed`, drain remaining in-flight tasks, set final status to `"failed"`, break.
5. **On success** — yield `node_completed`. Resolve successors:
   - Static successors from `successors.get(nodeId)`.
   - Conditional successors from `evaluateConditions(node.conditions, output, graph)`.
   For each successor, store the upstream output, decrement `pendingPreds`, and push to `ready` once it reaches zero.
6. Continue until `ready` and `inflight` are both empty.

Finally yield `execution_completed`.

## Sibling parallelism

When two or more nodes become ready in the same iteration, they are all spawned before the next `Promise.race`. That means **siblings run in parallel** and the next loop iteration begins as soon as **any one** of them resolves — fast siblings don't have to wait for slow ones to dispatch their successors.

```
       ┌── B ──┐
A ─────┤       ├──── D
       └── C ──┘
```

Here B and C run concurrently; whichever finishes first triggers the upstream-output bookkeeping for D, but D doesn't enter `ready` until both have completed (its `pendingPreds` is 2).

## Fan-in

A fan-in node's `pendingPreds` only goes to zero after all of its **static** predecessors complete. Conditional successors do not affect the count: a condition is a downstream choice made by an upstream node, not a static edge.

When the fan-in node finally runs, `normalizeFanIn` builds its input:

| Upstream count | Input shape |
|----------------|-------------|
| 0 | the original pipeline input |
| 1 | the single upstream's raw output |
| N>1 | `{ upstream: { "<srcId>": <output>, ... } }` |

This means downstream nodes don't have to know whether they're fan-in or not until N exceeds 1 — single-predecessor nodes get the upstream output verbatim.

## Conditional routing

Each node can declare a `conditions` array. After the node completes, every condition is evaluated against the output; matching ones contribute their `next` to the runtime successors. Static `next` edges are always taken regardless.

Match types:

| `match.type` | Behaviour |
|--------------|-----------|
| `regex` | Stringifies the output (JSON if it's an object), tests the precompiled `RegExp`. Invalid patterns silently never match |
| `status_code` | Reads `output.status_code` (the `http_request` action sets this), checks membership in `match.codes` |
| `json_path` | Looks up `output[match.path]` and JSON-stringify-compares it to `match.expected` (no nested paths — top-level keys only in the current implementation) |
| `exit_when` | Stringifies the output and tests `.includes(match.pattern)` |

If a condition matches, its `next` id is appended to the static successors list. The same downstream node will not be enqueued twice unless its predecessor count happens to require it (the runtime `pendingPreds` decrement guards against double-spawning).

## Loop guard

`LoopGuard(maxLoops)` caps how many times any single node id can be entered as `ready`. The default is `100`, overridable per-pipeline with `max_loop_count`. When a node would exceed the cap, the executor sets the run status to `"failed"` with the loop-guard error message, drains in-flight tasks, and yields `execution_completed`.

This is what makes cycles in the YAML safe: a `status_code` condition that loops back to a retry node will eventually trip the guard rather than spinning forever.

## Node actions

`executeNodeAction(node, input, deps)` runs whatever the node's `action` field declares. Four action types are supported today:

### `shell_command`

```yaml
action:
  type: shell_command
  command_template: "echo hello"
  working_dir: "/tmp"        # optional
  timeout_secs: 30
```

Spawns `sh -c <command_template>` with `Bun.spawn`. A `setTimeout` calls `proc.kill()` on timeout. On non-zero exit, throws an error containing stderr. On success, returns the captured stdout as a string.

A custom `ShellSpawner` can be injected via `ExecutorDeps.shell` (used by tests).

### `http_request`

```yaml
action:
  type: http_request
  method: GET
  url_template: "https://example.com/api"
  headers:
    Accept: application/json
  body_template: ""
```

Calls `fetch(url, { method, headers, body })`, then returns:

```ts
{ status_code: number, body: <parsed JSON or raw text> }
```

The response body is parsed as JSON if possible, otherwise kept as a string. Downstream `status_code` conditions read this object.

### `llm_call`

```yaml
action:
  type: llm_call
  provider: claude
  prompt: "Summarise: {{input}}"
  timeout_secs: 60
```

Looks up `deps.llmRegistry.get(provider)` and calls its `executePrompt`. **The bun-service wires every provider id (`seher`, `default`, `claude`, `copilot`, `codex`) to a single bridge that delegates to `router.ts`.** This means `provider: claude` is more of a hint than a binding — seher-ts decides the actual agent based on settings. See [llm-routing](/design/llm-routing/).

The action returns the response `content` string.

### `chat_send`

```yaml
action:
  type: chat_send
  adapter: discord
  channel_id: "123456789"
  content_template: "Done."
```

Resolves `deps.chatRegistry.get(adapter)` and calls `sendMessage(channel_id, content_template)`. Throws if the adapter is unknown or `channel_id` is empty. Returns a confirmation string.

## Validation and persistence

`pipeline.save` runs `parsePipeline(yaml_content)` before writing to the `pipelines` table — invalid YAML never reaches storage. The parser converts the YAML into a `PipelineDefinition` and computes `NodeKind` (`"Input"`, `"Hidden"`, `"Output"`) by graph topology — these labels are purely descriptive metadata, not gates on which actions a node may use.

When `pipeline.execute` runs, the saved YAML is re-parsed and resolved. There is no caching of the parsed tree across executions — the cost is negligible compared to the actions.

## Streaming progress (current state)

The executor yields a rich event stream (`execution_started`, `node_started`, `node_completed`, `node_failed`, `execution_completed`), and the `pipeline.commands.ts` handler accepts an optional `ctx.emit(event)` sink. Today, **the runtime context is configured without an emit sink**, so progress events are consumed only to compute the final status; they are not pushed to clients. The `pipeline_executions` table is finalised with the run's status and any error message.

`execution.history` returns rows from `pipeline_executions`; `execution.logs` returns rows from the `execution_logs` table (currently populated by manual logging only, not by the executor itself). Filling in per-node persistence in `node_executions` is a logical extension point but not yet wired.

## Cancellation

`ExecutePipelineOptions.isCancelled` is checked at the top of every scheduling iteration. The current command layer does not expose a `pipeline.cancel` RPC, so cancellation is reachable only from in-process callers (tests, future enhancements). When cancellation does fire, the executor drains in-flight tasks before yielding `execution_completed { status: "cancelled" }` — it does not abort tasks mid-flight.
