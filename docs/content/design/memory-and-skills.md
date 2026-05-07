+++
title = "Memory and skills"
description = "FTS5 memory store, 30-minute summarization loop, skill auto-generation"
weight = 4
+++

SmartCrab keeps a long-running record of chat turns and (potentially) execution traces in an FTS5-backed SQLite store, periodically summarizes them with an LLM, and can distil recurring patterns into reusable skills. The whole subsystem is opt-in at the call sites — you can run pipelines without ever touching memory — but when the chat tab is in use, the loop runs automatically.

## Memory store

`memory/store.ts` wraps a SQLite database with two tables and three triggers:

```sql
CREATE TABLE memory (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL DEFAULT 'episodic',
  content     TEXT NOT NULL,
  metadata    TEXT,
  created_at  INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  content,
  content='memory',
  content_rowid='id',
  tokenize='unicode61'
);

-- Plus AFTER INSERT / DELETE / UPDATE triggers that keep memory_fts in sync.
```

The `memory_fts` virtual table is a [contentless FTS5 mirror](https://www.sqlite.org/fts5.html#external_content_tables) — it stores only the index, not a duplicate of the text. The triggers handle every mutation path so callers never write to `memory_fts` directly.

`MemoryStore` exposes:

| Method | Purpose |
|--------|---------|
| `add({ kind?, content, metadata? })` | Insert one entry. `kind` defaults to `"episodic"`; `metadata` is JSON-stringified. |
| `search(query, k=10)` | FTS5 `MATCH` query, ordered by `rank`. Input is sanitized — see below. |
| `getRecent(n=20)` | Latest entries by id, no FTS. |
| `getByIds([...])` | Bulk fetch by id list. |
| `delete(id)` | Remove one entry; the trigger cleans up FTS5. |
| `count()` | Total rows in `memory`. |

### FTS5 query sanitization

User input goes through `sanitizeFtsQuery`: each whitespace token is double-quoted and internal quotes are doubled, so FTS5 operators (`AND`, `OR`, `NOT`, `*`, `^`, `(`…`)`) cannot be injected by user content.

```ts
"alice OR bob"  →  "\"alice\" \"OR\" \"bob\""   // each token quoted, no operator handling
```

This loses the ability to write Boolean queries from the chat tab, but it makes the store safe to feed arbitrary strings without crashing FTS5 parsing.

### Process-singleton

`memory/shared-store.ts` exports a process-wide `MemoryStore` singleton so every command module — `memory.commands`, `chat-bubble.commands`, the learn-loop — reads and writes the same store. The singleton starts as an in-memory database; `server.ts` calls `rebindSharedToDb(db)` after the migrations apply (specifically `005-memory-realign`, which aligned the schema with `MemoryStore`'s expected shape). After that, every component sees the on-disk store.

## Chat → memory hook

`chat.bubble-send` records each completed turn into the shared store:

```ts
getSharedMemoryStore().add({
  kind: "chat",
  content: `user: ${content}\nassistant: ${assistantText}`,
  metadata: { userBubbleId, assistantBubbleId },
});
```

The hook is opt-out: `setMemoryHookEnabled(false)` disables it (used by tests so they don't pollute the store). On hook failure the error is logged to stderr but the chat reply is still returned to the user — the chat path is the priority, memory is opportunistic.

## The summarization loop

`memory/learner.ts:runLearnLoop` is one iteration of a hermes-style self-learning loop:

1. Fetch the most recent `windowSize` (default `50`) entries, **excluding** ones with `kind === "summary"` so the loop doesn't summarize its own output.
2. If fewer than `minEntries` (default `3`) remain, do nothing — there isn't enough material yet.
3. Call `summarize(entries, llm)`:
   - Each entry is rendered as `- [<kind>#<id>] <content>` with whitespace collapsed.
   - The body is truncated to `maxChars` (default `8000`).
   - The default system prompt is `"You are a concise summarizer. Extract durable facts, decisions, and patterns from the following memory entries. Output a short paragraph."`
4. If the LLM returns a non-empty string, insert a new entry with:

   ```ts
   {
     kind: "summary",
     content: summary,
     metadata: { source_ids: [...recent.map(e => e.id)], generated_at: epoch },
   }
   ```

Future searches surface the summary alongside raw chat turns, so an LLM that retrieves recent memory gets distilled context plus the originals.

`server.ts` arms a `setInterval(30 * 60_000)` at boot. The summarizer LLM is wired through `configureMemorySummarizer({ complete })`, where `complete` calls `route().text` — the same router path the chat tab uses, so summaries inherit whatever provider seher resolves.

The loop is opportunistic by design:

- Errors are caught and logged; one failure doesn't stop the next tick.
- The interval is fixed (30 minutes); there's no debouncing or activity-based trigger.
- The loop has no opinion about old entries — it always summarizes the most recent window, including entries that have already been summarized in earlier passes. The **kind=summary** exclusion only stops it from summarizing its own previous summaries.

## Skills

A skill is a Markdown prompt body, optionally tied to a pipeline, that can be invoked directly with input. The registry sits in front of a SQLite `skills` table.

### Registry semantics

`SkillsRegistry` is cache-first. On construction it `hydrateFromDb()` reads every row into an in-memory `Map<string, SkillInfo>`. After that:

- `list()` returns the cache, sorted by `created_at`.
- `get(id)` reads the cache.
- `save(input)` writes the cache **and** `INSERT … ON CONFLICT DO UPDATE` to SQLite. New rows get a generated UUID (overridable via `opts.newId` for tests). `created_at` is preserved for upserts.
- `delete(id)` clears both layers.

The two layers stay in lockstep because every mutation goes through `save` / `delete`. There is no path that bypasses the cache.

### Invocation

`SkillsRegistry.invoke(id, input, adapter)` builds a prompt with `buildSkillPrompt`:

```
# Skill Definition

<skill body>

---

# User Input

<JSON.stringify(input, null, 2)  or  input as string>
```

…and calls `adapter.execute_prompt({ prompt })`. String inputs are embedded raw; everything else is pretty-printed JSON. The adapter passed in is whatever the command layer hands the registry — in practice this is the seher-backed bridge, just like the chat tab.

### Auto-generation

`skills/auto-gen.ts:autoGenerate(traces, llm)` distils a window of execution traces into a reusable skill. The system prompt asks the model for a fenced JSON object on the first line plus a Markdown body afterwards:

```
{"name":"…","description":"…"}

# Steps to ...
1. ...
2. ...
```

`parseAutoGenResponse` tolerates three shapes:

1. JSON object on line 1, Markdown body following.
2. Fenced ```json block, Markdown body afterwards.
3. JSON-only response (uses `description` as the body fallback).

If none of those parse, the entire response becomes the body and the skill is named `auto-generated-skill`. The skill is saved with `skill_type: "auto-generated"`.

The trace input is opaque to auto-gen — it's the caller's responsibility to window or sample. The system prompt explicitly instructs the model to generalize parameters (`{{topic}}`, `{{user_id}}`) and avoid embedding secrets or run-specific identifiers.

### What auto-gen runs against today

The RPC method `skill.auto-generate` accepts a `pipeline_id` and is the user-facing entry point in the Skills tab. The plumbing from execution history into `ExecutionTrace[]` for that pipeline is the natural extension point; today the command-layer wiring varies and you should check `skills.commands.ts` for the current implementation before relying on a specific shape.

## Why the two systems are separate

Memory is **conversational state** with a search index. Skills are **artifacts** that condense recurring patterns into a static prompt. They share an LLM dependency and they share the auto-learning aesthetic, but they sit on different tables, have different lifecycles, and serve different consumers (chat retrieval vs. one-shot prompt invocation). Keeping them split keeps each subsystem's API small and lets either evolve without dragging the other along.
