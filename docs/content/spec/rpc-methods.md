+++
title = "RPC methods"
description = "Every JSON-RPC method exposed by the Bun service, with params and result shapes"
weight = 1
+++

The Bun service speaks JSON-RPC 2.0 over stdio: one request per line on stdin, one response per line on stdout. All logging goes to stderr. Notifications (requests with no `id`) produce no response.

This document is the wire-level contract — what each method accepts and returns. It is derived from the implementations in `apps/bun-service/src/commands/*.commands.ts`. For the rationale behind each subsystem, read [design](/design/).

## Conventions

- Field names on the wire are **`snake_case`**. SwiftUI uses `JSONEncoder` with `.convertToSnakeCase` and `JSONDecoder` with `.convertFromSnakeCase` to translate at the boundary.
- Timestamp fields are ISO-8601 strings unless the field name ends in `_at` and the surrounding type belongs to the database layer, in which case the value is the column's storage format (epoch seconds for migrated rows; ISO-8601 for newer ones).
- Errors use the standard JSON-RPC codes: `-32700` parse, `-32600` invalid request, `-32601` method not found, `-32602` invalid params, `-32603` internal error. Handler-thrown `Error` instances surface as `-32603` with the `Error.message` as `error.message`.

## Method index

| Namespace | Methods |
|-----------|---------|
| `system`   | [`system.ping`](#system-ping), [`system.version`](#system-version) |
| `pipeline` | [`pipeline.list`](#pipeline-list), [`pipeline.get`](#pipeline-get), [`pipeline.save`](#pipeline-save), [`pipeline.delete`](#pipeline-delete), [`pipeline.execute`](#pipeline-execute) |
| `execution` | [`execution.history`](#execution-history), [`execution.logs`](#execution-logs) |
| `cron`     | [`cron.list`](#cron-list), [`cron.create`](#cron-create), [`cron.update`](#cron-update), [`cron.delete`](#cron-delete), [`cron.run-now`](#cron-run-now) |
| `chat`     | [`chat.start`](#chat-start), [`chat.stop`](#chat-stop), [`chat.status`](#chat-status), [`chat.send`](#chat-send), [`chat.bubble-history`](#chat-bubble-history), [`chat.bubble-send`](#chat-bubble-send) |
| `skill`    | [`skill.list`](#skill-list), [`skill.get`](#skill-get), [`skill.create`](#skill-create), [`skill.delete`](#skill-delete), [`skill.invoke`](#skill-invoke), [`skill.auto-generate`](#skill-auto-generate), [`skill.reload`](#skill-reload) |
| `memory`   | [`memory.add`](#memory-add), [`memory.search`](#memory-search), [`memory.list-recent`](#memory-list-recent), [`memory.summarize`](#memory-summarize) |
| `settings` | [`settings.app-load`](#settings-app-load), [`settings.app-save`](#settings-app-save), [`settings.adapter-load`](#settings-adapter-load), [`settings.adapter-save`](#settings-adapter-save) |

## system

### system.ping

Health check.

```jsonc
// request
{ "jsonrpc": "2.0", "id": 1, "method": "system.ping" }

// response
{ "jsonrpc": "2.0", "id": 1, "result": "pong" }
```

### system.version

```jsonc
// response.result
{ "version": "0.2.0" }
```

## pipeline

### pipeline.list

```ts
params: void
result: PipelineRow[]
```

```ts
interface PipelineRow {
  id: string;
  name: string;
  description: string | null;
  yaml_content: string;
  max_loop_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

### pipeline.get

```ts
params: { id: string }
result: PipelineRow
// throws if no row matches.
```

### pipeline.save

```ts
params: {
  id?: string;                 // omit to insert
  name: string;
  description?: string;
  yaml_content: string;        // validated by parsePipeline before write
  max_loop_count?: number;
  is_active?: boolean;
}
result: PipelineRow
```

The handler runs `parsePipeline(yaml_content)` before persisting; invalid YAML throws and nothing is saved.

### pipeline.delete

```ts
params: { id: string }
result: { ok: true }
```

### pipeline.execute

```ts
params: { id: string; trigger_data?: unknown }
result: { execution_id: string }
```

Returns immediately. The execution runs in a background IIFE and updates `pipeline_executions.status` when it ends. There is currently no streaming progress on the wire — observers poll `execution.history` and `execution.logs`.

## execution

### execution.history

```ts
params: { pipeline_id?: string; limit?: number }   // limit defaults to 50
result: ExecutionRow[]
```

```ts
interface ExecutionRow {
  id: string;
  pipeline_id: string;
  pipeline_name: string;
  trigger_type: string;        // "manual" | "cron" | ...
  trigger_data: string | null;
  status: string;              // "pending" | "running" | "completed" | "failed" | "cancelled"
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}
```

### execution.logs

```ts
params: { execution_id: string }
result: ExecutionLogRow[]
```

```ts
interface ExecutionLogRow {
  id: number;
  execution_id: string;
  node_id: string | null;
  level: string;               // "trace" | "debug" | "info" | "warn" | "error"
  message: string;
  timestamp: string;
}
```

## cron

### cron.list

```ts
params: void
result: CronJob[]
```

```ts
interface CronJob {
  id: string;
  pipeline_id: string;
  schedule: string;            // 5- or 6-field cron expression
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}
```

### cron.create

```ts
params: { pipeline_id: string; schedule: string }
result: CronJob
```

The schedule is validated; invalid expressions throw a `INVALID_INPUT` error wrapped as `-32603`.

### cron.update

```ts
params: { id: string; schedule?: string; is_active?: boolean }
result: CronJob
```

Toggling `is_active` re-arms or unschedules the job in the in-memory `CronScheduler`.

### cron.delete

```ts
params: { id: string }
result: void
```

### cron.run-now

```ts
params: { id: string }
result: void
```

Fires the job's callback immediately, out of band, and updates `last_run_at`. The next scheduled tick is unaffected.

## chat (adapter control)

### chat.start

```ts
params?: { adapter?: string }    // defaults to "discord"
result: { id: string; running: boolean }
```

### chat.stop

```ts
params?: { adapter?: string }
result: { id: string; running: boolean }
```

### chat.status

```ts
params?: { adapter?: string }
result: {
  adapters: Array<{
    id: string;
    name: string;
    running: boolean;
    capabilities: { streaming: boolean; channels: string[] };
  }>;
}
```

When `adapter` is omitted, every registered chat adapter is returned.

### chat.send

```ts
params: { adapter?: string; channel: string; body: string }
result: { ok: true }
```

## chat (bubble UI)

The bubble methods power the SwiftUI Chat tab. They route through `router.ts` (seher-ts) and persist to the `chat_bubbles` table.

### chat.bubble-history

```ts
params: void
result: ChatBubble[]
```

```ts
interface ChatBubble {
  id: string;            // UUID
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;     // ISO-8601, returned as `created_at` on the wire
}
```

### chat.bubble-send

```ts
params: { content: string }
result: ChatBubble
```

The handler stores the user bubble, calls `route({ prompt: content })`, stores the assistant bubble, and returns the assistant bubble. On routing failure it returns a bubble with `content: "LLM error: <message>"` rather than throwing.

A side effect adds the turn to the FTS5 memory store under `kind: "chat"`. Disable with `setMemoryHookEnabled(false)` in tests.

## skill

### skill.list

```ts
params?: { type?: string }
result: SkillInfo[]
```

```ts
interface SkillInfo {
  id: string;
  name: string;
  description: string | null;
  file_path: string;
  skill_type: string;             // "manual" | "auto-generated" | ...
  pipeline_id: string | null;
  created_at: string;
  updated_at: string;
  body?: string;                  // markdown body when stored inline
}
```

### skill.get

```ts
params: { id: string }
result: SkillInfo
```

### skill.create

```ts
params: SkillCreateInput
result: SkillInfo
```

```ts
interface SkillCreateInput {
  name: string;                   // required
  description?: string | null;
  skill_type?: string;
  pipeline_id?: string | null;
  body?: string;
  file_path?: string;
}
```

### skill.delete

```ts
params: { id: string }
result: { ok: true }
```

### skill.invoke

```ts
params: { id: string; input?: unknown }
result: SkillInvocationResult
```

```ts
interface SkillInvocationResult {
  skill_id: string;
  skill_name: string;
  output: string;                 // LLM response content
}
```

The handler builds a prompt from the skill body plus the input (string inputs raw, others JSON-formatted), then forwards through the configured LLM adapter.

### skill.auto-generate

```ts
params?: {
  traces?: ExecutionTrace[];      // explicit traces
  pipeline_id?: string;           // hint for the configured traceProvider
}
result: SkillInfo
```

```ts
interface ExecutionTrace {
  timestamp: string;              // ISO-8601
  action: string;                 // e.g. "chat.send", "pipeline.execute"
  input?: unknown;
  output?: unknown;
  note?: string;
}
```

If `traces` is absent, the configured `traceProvider` is consulted. Throws if neither yields entries.

### skill.reload

Refreshes the in-memory registry from disk and SQLite. Useful after manual edits to skill files.

```ts
params: void
result: SkillInfo[]
```

## memory

### memory.add

```ts
params: {
  content: string;                          // required
  kind?: string;                            // defaults to "episodic"
  metadata?: Record<string, unknown> | null;
}
result: MemoryEntry
```

```ts
interface MemoryEntry {
  id: number;
  kind: string;
  content: string;
  metadata: string | null;       // JSON-encoded
  created_at: number;            // epoch seconds
}
```

### memory.search

```ts
params: { query: string; k?: number }    // k defaults to 10
result: SearchHit[]
```

```ts
interface SearchHit extends MemoryEntry {
  rank: number;                            // FTS5 rank, lower is better
}
```

User input is sanitized — each whitespace token is double-quoted — so FTS5 operators in the query string are treated as literal text.

### memory.list-recent

```ts
params?: { n?: number }                    // n defaults to 20
result: MemoryEntry[]
```

### memory.summarize

```ts
params?: {
  ids?: number[];                          // explicit ids; otherwise use the recent window
  windowSize?: number;                     // defaults to 50
}
result: string                             // the summary text
```

Requires a configured `SummarizerLlm` (wired by `server.ts`). Throws `"memory.summarize requires an LLM dependency"` otherwise.

## settings

### settings.app-load

```ts
params: void
result: SeherConfig | null
```

Returns the stored in-app config (the `seher_config` SQLite row, JSON-decoded). `null` when nothing has been saved yet.

### settings.app-save

```ts
params: { config: SeherConfig }
result: { saved: true }
```

Persists the config and **also** rewrites `$XDG_CONFIG_HOME/smartcrab/seher-settings.jsonc` (override with `SMARTCRAB_SEHER_CONFIG`). The next call to `route()` picks up the new file. See [llm-routing](/design/llm-routing/).

### settings.adapter-load

```ts
params: { adapter_id: string }
result: (Record<string, unknown> & { enabled: boolean }) | null
```

Returns the JSON config for the named chat adapter merged with the `enabled` flag, or `null` if no row exists.

### settings.adapter-save

```ts
params: {
  adapter_id: string;
  adapter_type?: string;       // defaults to adapter_id
  config: Record<string, unknown> & { enabled?: boolean };
}
result: { saved: true }
```

The `enabled` flag is split out into its own column; the rest is JSON-encoded into `config_json`.
