+++
title = "Database schema"
description = "SQLite tables and the migration order that produces them"
weight = 3
+++

The Bun service stores everything in one SQLite database:

```
$XDG_DATA_HOME/smartcrab/smartcrab.db   # default: ~/.local/share/smartcrab/smartcrab.db
```

Override the path with `SMARTCRAB_DB_PATH`. Pass `:memory:` for an ephemeral database.

`openDb()` enables `journal_mode=WAL` and `foreign_keys=ON`, then runs every migration whose `name` is missing from the `_migrations` ledger. Migrations are embedded into the compiled binary via `with { type: "text" }`, so the running app never reads SQL files at startup.

```sql
CREATE TABLE _migrations (
  name TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

## Migration order

| File | Effect |
|------|--------|
| `000-init.sql` | Initial schema: `pipelines`, `pipeline_executions`, `node_executions`, `execution_logs`, `skills`, `chat_adapter_config`, `llm_adapter_config`, `cron_jobs`, plus indexes |
| `001-memory.sql` | First-cut memory store with TEXT id + `body`/`tags` columns. **Superseded by 005.** |
| `002-seher-config.sql` | Singleton `seher_config` row holding the in-app SeherConfig JSON |
| `003-skills-realign.sql` | `DROP TABLE skills` and recreate with ISO-8601 timestamps and `NOT NULL` on `file_path`/`skill_type`. Destructive — relied on the table never having held data yet |
| `004-chat-bubbles.sql` | `chat_bubbles` table + `created_at` index for the SwiftUI Chat tab |
| `005-memory-realign.sql` | `DROP` the 001 tables and triggers, recreate with `INTEGER id`, `content`/`metadata`, FTS5 on `content`. Destructive — relied on `MemoryStore` having used its own private DB up to that point |

## Tables (current shape)

### `pipelines`

Pipeline definitions edited in the SwiftUI Pipelines tab.

```sql
CREATE TABLE pipelines (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  description     TEXT,
  yaml_content    TEXT NOT NULL,
  max_loop_count  INTEGER DEFAULT 10,
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
```

`yaml_content` is validated by `parsePipeline` before write. `enabled` is the on-the-wire `is_active` flag — see [spec/rpc-methods](/spec/rpc-methods/).

### `pipeline_executions`

One row per `pipeline.execute` call. Inserted on start, finalised when the executor's iterator yields `execution_completed`.

```sql
CREATE TABLE pipeline_executions (
  id           TEXT PRIMARY KEY,
  pipeline_id  TEXT NOT NULL REFERENCES pipelines(id),
  trigger_type TEXT NOT NULL,                  -- "manual" | "cron" | ...
  trigger_data TEXT,                           -- JSON-encoded params, if any
  status       TEXT NOT NULL,                  -- "completed" | "failed" | "cancelled"
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  error        TEXT
);

CREATE INDEX idx_pipeline_executions_pipeline_id ON pipeline_executions(pipeline_id);
CREATE INDEX idx_pipeline_executions_started_at ON pipeline_executions(started_at);
```

### `node_executions`

Per-node row, intended for fine-grained execution timelines.

```sql
CREATE TABLE node_executions (
  id           TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES pipeline_executions(id),
  node_id      TEXT NOT NULL,
  node_name    TEXT NOT NULL,
  iteration    INTEGER NOT NULL DEFAULT 1,
  status       TEXT NOT NULL,
  input_data   TEXT,
  output       TEXT,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  error        TEXT
);

CREATE INDEX idx_node_executions_execution_id ON node_executions(execution_id);
```

The executor yields the data needed to populate this table (`node_started` / `node_completed` / `node_failed` events), but the production `pipeline.commands.ts` does not currently emit them. Plumbing the events into inserts is a known extension point.

### `execution_logs`

```sql
CREATE TABLE execution_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT NOT NULL REFERENCES pipeline_executions(id),
  node_id      TEXT,
  level        TEXT NOT NULL,                  -- "trace" | "debug" | "info" | "warn" | "error"
  message      TEXT NOT NULL,
  timestamp    INTEGER NOT NULL
);

CREATE INDEX idx_execution_logs_execution_id ON execution_logs(execution_id);
CREATE INDEX idx_execution_logs_timestamp    ON execution_logs(timestamp);
```

`execution.logs` returns rows by `execution_id`. As with `node_executions`, the executor itself does not currently write here — manual logging from custom command paths is the only producer today.

### `skills` (after 003 realign)

```sql
CREATE TABLE skills (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  file_path   TEXT NOT NULL,
  skill_type  TEXT NOT NULL,                   -- "manual" | "auto-generated" | ...
  pipeline_id TEXT,
  created_at  TEXT NOT NULL,                   -- ISO-8601
  updated_at  TEXT NOT NULL,                   -- ISO-8601
  body        TEXT
);
```

`SkillsRegistry` hydrates from this table at startup. Mutations go through the registry, which writes both the in-memory cache and SQLite via `INSERT … ON CONFLICT(id) DO UPDATE`.

Note that `name` is no longer `UNIQUE` (the original 000-init constraint was dropped in 003).

### `chat_adapter_config` / `llm_adapter_config`

```sql
CREATE TABLE chat_adapter_config (
  adapter_id   TEXT PRIMARY KEY,
  adapter_type TEXT,
  config_json  TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);
-- llm_adapter_config has the same shape; reserved for future LLM adapter
-- configuration but not currently written by any RPC handler.
```

`settings.adapter-save` writes `chat_adapter_config`. The Discord adapter's `setDiscordConfigLoader` reads from the same row at startup to hydrate its `bot_token_env` and `notification_channel_id` fields — translating GUI camelCase into the adapter's expected snake_case.

### `cron_jobs`

```sql
CREATE TABLE cron_jobs (
  id          TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
  expression  TEXT NOT NULL,                   -- 5- or 6-field cron
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER,
  created_at  INTEGER,
  updated_at  INTEGER
);

CREATE INDEX idx_cron_jobs_pipeline_id ON cron_jobs(pipeline_id);
```

`SqliteCronStore` is the persistence layer; `CronScheduler` is the in-memory `setTimeout`-based runtime. `bootstrapCronRunner` re-arms every `enabled=1` row at process start, which is what makes scheduled jobs survive restarts.

### `seher_config`

Single-row JSON blob for the in-app SeherConfig.

```sql
CREATE TABLE seher_config (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  config_json TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

`settings.app-save` upserts here and additionally writes `$XDG_CONFIG_HOME/smartcrab/seher-settings.jsonc`. See [design/llm-routing](/design/llm-routing/).

### `chat_bubbles`

History for the SwiftUI Chat tab.

```sql
CREATE TABLE chat_bubbles (
  id         TEXT PRIMARY KEY,
  role       TEXT NOT NULL,                    -- "user" | "assistant" | "system"
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL                     -- ISO-8601
);

CREATE INDEX idx_chat_bubbles_created_at ON chat_bubbles(created_at);
```

### `memory` + `memory_fts` (after 005 realign)

```sql
CREATE TABLE memory (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'episodic',
  content    TEXT NOT NULL,
  metadata   TEXT,                             -- JSON-encoded
  created_at INTEGER NOT NULL                  -- epoch seconds
                       DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  content,
  content='memory',
  content_rowid='id',
  tokenize='unicode61'
);

-- Triggers (memory_ai / memory_ad / memory_au) keep memory_fts in sync on
-- INSERT / DELETE / UPDATE.
```

`MemoryStore.search` issues `SELECT … FROM memory_fts JOIN memory … WHERE memory_fts MATCH ?` and orders by `memory_fts.rank`. User input is tokenized and double-quoted by `sanitizeFtsQuery` before reaching SQLite, so FTS5 operators inside user content are inert.

`kind` values that exist by convention:

| `kind` | Source |
|--------|--------|
| `chat` | `chat.bubble-send` records each completed turn |
| `episodic` | Default for `memory.add` callers that don't specify a kind |
| `summary` | Output of `runLearnLoop`; excluded from the next loop's input window |

## Foreign keys and cascades

`pipeline_executions.pipeline_id`, `node_executions.execution_id`, `execution_logs.execution_id`, and `cron_jobs.pipeline_id` are all `REFERENCES` without `ON DELETE`. Deleting a pipeline or execution leaves orphan child rows. If you want true cascading, add it explicitly — the current schema favours preserving history over a clean delete.

## Future migrations

When adding a migration, append a new row to `MIGRATIONS` in `apps/bun-service/src/db/index.ts` **and** add the matching `import "..." with { type: "text" }` declaration. The order is controlled by the array; the runtime additionally sorts by file name as a defence-in-depth measure.
