+++
title = "Pipeline YAML"
description = "Pipeline YAML schema (PipelineDefinition, NodeAction, MatchCondition) with examples"
weight = 2
+++

A pipeline is a YAML document that the Bun service parses into a `PipelineDefinition`, then executes as a directed graph. This document is the schema; for executor semantics read [design/pipeline-engine](/design/pipeline-engine/).

The schema is defined in TypeScript at `apps/bun-service/src/engine/yaml-schema.ts`. Field names on disk are `snake_case` to match how `serde` encodes them in the original Rust port — discriminated unions use `{ "type": "...", ... }`, and `next` is untagged (a string or an array of strings).

## Top-level `PipelineDefinition`

```ts
interface PipelineDefinition {
  name: string;                  // required
  description?: string;
  version: string;               // required
  trigger: TriggerConfig;        // required
  max_loop_count?: number;       // default 100; per-node iteration cap
  nodes: NodeDefinition[];       // required, non-empty in practice
}
```

Validation is lightweight (matches the original serde behaviour): `parsePipeline` only enforces the presence of `name`, `trigger`, and a `nodes` array of objects with `id` and `name` strings. Schema mismatches deeper than that bubble up at execution time.

## `TriggerConfig`

```ts
type TriggerType = "discord" | "cron";

interface TriggerConfig {
  type: TriggerType;
  triggers?: string[];           // discord: substrings/keywords to listen for
  schedule?: string;             // cron: 5- or 6-field expression
}
```

The trigger field is informational metadata for the runtime — `pipeline.execute` runs the pipeline regardless of trigger, but cron jobs and Discord listeners use it to decide which pipelines to fire.

## `NodeDefinition`

```ts
interface NodeDefinition {
  id: string;                    // required, unique within the pipeline
  name: string;                  // human-readable label
  action?: NodeAction;           // omit for pass-through nodes
  next?: NextTarget;             // string | string[]
  conditions?: Condition[];      // dynamic routing
}

type NextTarget = string | string[];
```

Topology determines a `NodeKind` (descriptive metadata, not a gate):

| `kind` | When |
|--------|------|
| `Input` | Not referenced by any other node's `next` or `conditions` |
| `Hidden` | Referenced and has routing (`next` or `conditions`) |
| `Output` | Referenced and has no routing — terminal node |

A node without an `action` simply forwards its input to its successors.

## `NodeAction`

A discriminated union with four variants. The `type` tag selects which fields apply.

### `shell_command`

```yaml
action:
  type: shell_command
  command_template: "echo hello"
  working_dir: "/tmp"            # optional
  timeout_secs: 30
```

Spawns `sh -c <command_template>`. `working_dir` is optional. The action's output is captured stdout. Non-zero exit codes throw with stderr included.

### `http_request`

```yaml
action:
  type: http_request
  method: POST
  url_template: "https://example.com/api"
  headers:
    Content-Type: application/json
  body_template: '{"hello":"world"}'
```

Calls `fetch`. The output shape is:

```ts
{ status_code: number, body: <parsed JSON or raw text> }
```

Downstream `status_code` conditions read this object.

### `llm_call`

```yaml
action:
  type: llm_call
  provider: claude
  prompt: "Summarise: {{input}}"
  timeout_secs: 60
```

Forwards through the LLM registry. **The `provider` field is a hint — the Bun service routes every id (`seher`/`default`/`claude`/`copilot`/`codex`) through seher-ts**, which picks the actual agent at run time. See [design/llm-routing](/design/llm-routing/).

### `chat_send`

```yaml
action:
  type: chat_send
  adapter: discord
  channel_id: "123456789012345678"
  content_template: "Pipeline finished: {{result}}"
```

Sends `content_template` via the named chat adapter. Throws if the adapter is not registered or `channel_id` is empty.

## `Condition`

```ts
interface Condition {
  match: MatchCondition;
  next: string;                  // node id to enqueue on match
}

type MatchCondition =
  | { type: "regex"; pattern: string }
  | { type: "status_code"; codes: number[] }
  | { type: "json_path"; path: string; expected: unknown }
  | { type: "exit_when"; pattern: string };
```

| `match.type` | Behaviour |
|--------------|-----------|
| `regex` | Stringifies the output (JSON-stringify if non-string), tests the precompiled regex. Invalid regex patterns silently never match. |
| `status_code` | Reads `output.status_code` (typically from `http_request`) and tests membership in `codes`. |
| `json_path` | Top-level lookup only: `output[path]` JSON-stringify-compared with `expected`. Nested paths are not supported in the current implementation. |
| `exit_when` | Stringifies the output and tests `String#includes(pattern)`. |

A node may declare multiple conditions; **every matching one** contributes a successor. Static `next` edges are always taken.

## Examples

### Cron-triggered HTTP probe with conditional escalation

```yaml
name: morning-health-check
description: Daily health probe; escalate to Claude when the API is unhealthy.
version: "1"
trigger:
  type: cron
  schedule: "0 9 * * *"
max_loop_count: 5
nodes:
  - id: probe
    name: Probe API
    action:
      type: http_request
      method: GET
      url_template: "https://api.example.com/health"
    conditions:
      - match: { type: status_code, codes: [200] }
        next: notify-ok
      - match: { type: status_code, codes: [500, 502, 503, 504] }
        next: ask-claude

  - id: ask-claude
    name: Ask Claude what to do
    action:
      type: llm_call
      provider: claude
      prompt: "API health endpoint returned an error. Suggest a triage step."
      timeout_secs: 60
    next: notify-fail

  - id: notify-ok
    name: Notify channel (ok)
    action:
      type: chat_send
      adapter: discord
      channel_id: "123456789012345678"
      content_template: "Health check OK."

  - id: notify-fail
    name: Notify channel (fail)
    action:
      type: chat_send
      adapter: discord
      channel_id: "123456789012345678"
      content_template: "Health check failed; suggested triage attached."
```

### Discord-triggered fan-out

```yaml
name: triage-incoming-message
version: "1"
trigger:
  type: discord
  triggers: ["help", "@bot"]
nodes:
  - id: classify
    name: Classify intent
    action:
      type: llm_call
      provider: seher
      prompt: "Classify this message as 'support' or 'sales': {{input}}"
      timeout_secs: 30
    conditions:
      - match: { type: regex, pattern: "support" }
        next: route-support
      - match: { type: regex, pattern: "sales" }
        next: route-sales

  - id: route-support
    name: Route to support
    action:
      type: chat_send
      adapter: discord
      channel_id: "111"
      content_template: "Forwarded to #support."

  - id: route-sales
    name: Route to sales
    action:
      type: chat_send
      adapter: discord
      channel_id: "222"
      content_template: "Forwarded to #sales."
```

`classify`'s `kind` is `Input` (no node references it). `route-support` and `route-sales` are `Output` (referenced but no routing).
