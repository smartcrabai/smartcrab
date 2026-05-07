+++
title = "Architecture"
description = "Process model — SwiftUI host, Bun child, stdio JSON-RPC, SQLite, startup sequence"
weight = 1
+++

## The Tool-to-AI paradigm

Traditional agent frameworks are AI-first: a model decides which tool to call. SmartCrab inverts that. Deterministic processing — an HTTP request, a cron tick, a Discord message — runs first, and explicit conditions in a YAML pipeline decide whether to escalate to an AI agent.

```
Input → Condition → (optional) AI agent → Output
```

The benefits are predictability, testability, and cost control: AI is invoked exactly when the pipeline says so, never as a default.

## Two-process model

SmartCrab runs as **two cooperating processes** packaged inside a single `.app`:

```
┌─────────────────────────────────────────┐
│   SwiftUI host process (apps/macos/)    │
│   • 6 sidebar tabs:                     │
│       Chat / Pipelines / Cron /         │
│       Skills / History / Settings       │
│   • All UI state lives here             │
└──────────────┬──────────────────────────┘
               │ stdin/stdout
               │ line-delimited JSON-RPC 2.0
┌──────────────▼──────────────────────────┐
│   Bun service child process             │
│   (apps/bun-service/, compiled with     │
│    `bun build --compile`)               │
│                                         │
│   • Dispatcher → commands/*.commands.ts │
│   • Pipeline executor (engine/)         │
│   • Cron scheduler                      │
│   • Memory store (FTS5)                 │
│   • Skills registry                     │
│   • Adapter registries (LLM / chat)     │
│   • SQLite (~/Library/Application       │
│     Support/SmartCrab/smartcrab.db)     │
└─────────────────────────────────────────┘
```

The SwiftUI process owns all UI; the Bun process owns all business logic, persistence, and outbound integrations. The wire format between them is the **only** SmartCrab-specific contract — everything else is implementation detail of one side or the other.

## Processes in detail

### SwiftUI host (`apps/macos/`)

- `SmartCrabApp` mounts `AppRoot`, which wires a `NavigationSplitView` of `SidebarTab` cases (Chat / Pipelines / Cron / Skills / History / Settings) to per-tab views. `Cmd+1` … `Cmd+6` jump between tabs.
- `BunServiceContainer` is a `@MainActor ObservableObject` that publishes a `BunServiceProtocol` into the SwiftUI environment. On macOS the implementation is `BunServiceMacOS` (real subprocess). On the iOS Simulator preview target it is `BunServiceMock`, used purely for UI verification — there is no Bun child process in that build.
- `BunServiceMacOS.start()` resolves `Bundle.main.url(forResource: "smartcrab-service")`, captures the user's login-shell `$PATH` once (so the child can find tools like `claude`, `kimi`, `bun` that GUI-launched apps would otherwise miss), `Process.run()`s the binary, and wires `readabilityHandler` on stdout to parse one JSON-RPC response per line.
- Each request is a Swift struct encoded with `.convertToSnakeCase`; responses are decoded with `.convertFromSnakeCase`. The bridge keeps an `idCounter` and a `pending: [String: Continuation]` dictionary.

### Bun service (`apps/bun-service/`)

- `src/server.ts` reads UTF-8 lines from `Bun.stdin.stream()`, hands each one to `dispatcher.dispatch`, and writes one JSON-RPC response per line on stdout. **All logging goes to stderr** — stdout is reserved for the wire protocol.
- `dispatcher.ts` lazily loads a registry from `_loaders.ts:loadCommandModules()`, which globs `commands/*.commands.ts` and merges every module's default-exported `CommandMap`. In production the build plugin (`scripts/build.ts`) replaces the loader with statically-imported modules, so the compiled binary needs no filesystem access at startup.
- Notifications (requests with no `id`) produce no response. Errors use the standard JSON-RPC codes (`PARSE_ERROR=-32700`, `METHOD_NOT_FOUND=-32601`, `INTERNAL_ERROR=-32603`).
- `SIGTERM` and `SIGINT` cause a clean shutdown; closing stdin does the same.

### Adapter registries

Adapters live under `src/adapters/<kind>/<name>/index.ts` and **self-register** at module-import time by calling `llmRegistry.register(...)` or `chatRegistry.register(...)`. `ensureAdaptersLoaded()` in `registry.ts` triggers the side-effect imports once at startup. The same glob-vs-static-import dichotomy applies: dev scans the filesystem, the production bundler inlines the imports.

Currently shipped:

- **LLM adapters**: `claude`, `kimi`, `copilot` (each wraps its respective agent SDK).
- **Chat adapters**: `discord` (uses `discord.js` and reads its config out of the `chat_adapter_config` SQLite row that the Settings tab writes).

## Startup sequence

When the user launches `SmartCrab.app`:

1. **SwiftUI side** — `SmartCrabApp` instantiates `BunServiceContainer`, which calls `service.start()` from a `.task` modifier on the root window. macOS spawns the bundled `smartcrab-service` binary with the inherited login-shell `PATH`.
2. **Bun side — DB**: `openDb()` opens the SQLite file at `~/Library/Application Support/SmartCrab/smartcrab.db`, sets `journal_mode=WAL` and `foreign_keys=ON`, then runs every pending migration in `db/migrations/000-init.sql` … `005-memory-realign.sql` inside one transaction each. Migrations are embedded into the binary via `import "..." with { type: "text" }`, so no filesystem is required.
3. **Bun side — Pipeline + settings**: `configurePipelineCommands` injects the `SqlitePipelineDatabase` and an `ExecutorDeps` whose `llmRegistry` maps every provider id (`seher`, `default`, `claude`, `kimi`, `copilot`, `codex`) to a single bridge that routes through `router.ts`. The actual provider is chosen by seher-ts at run time. `configureSettingsCommands` is wired similarly.
4. **Bun side — Cron**: `setCronStore(SqliteCronStore)` is wired, the per-job callback factory is set to "mark run, then call `pipeline.execute`", and `bootstrapCronRunner` reads every `is_active=true` row from `cron_jobs` and re-arms it on the in-memory `CronScheduler`. Scheduling on startup is what makes cron **survive process restarts**.
5. **Bun side — Skills + chat-bubble + Discord**: `SkillsRegistry` is hydrated from the `skills` table. `chat-bubble.commands` and the `discord` adapter loader are imported dynamically (top-level static imports would cause circular initialization through the `llmRegistry` proxy).
6. **Bun side — Memory + learn loop**: `rebindSharedToDb(db)` switches the singleton `MemoryStore` from its in-memory default onto the on-disk schema. `configureMemorySummarizer` is wired with a seher-backed completion function. A `setInterval` fires `runLearnLoop` every 30 minutes — see [memory-and-skills](/design/memory-and-skills/).
7. **Bun side — Adapter side-effects**: `await ensureAdaptersLoaded()` triggers the LLM and chat adapter modules to self-register.
8. **Bun side — IO loop**: the server enters its `for await (const chunk of stdin)` loop and is ready to serve requests.

## Per-tab wiring

Each SwiftUI tab is a thin client over a small set of JSON-RPC methods. The full method map is in [spec/rpc-methods](/spec/rpc-methods/); the highlights:

| Tab | Service methods used |
|-----|----------------------|
| **Chat** | `chat.bubble-history`, `chat.bubble-send`, `settings.app-load` (to decide whether to show the welcome view when no providers are configured) |
| **Pipelines** | `pipeline.list`, `pipeline.get`, `pipeline.save`, `pipeline.execute` |
| **Cron** | `cron.list`, `cron.create`, `cron.update`, `cron.delete` |
| **Skills** | `skill.list`, `skill.auto-generate`, `skill.invoke`, `skill.delete` |
| **History** | `execution.history`, `execution.logs` |
| **Settings** | `settings.app-load`, `settings.app-save`, `settings.adapter-load`, `settings.adapter-save` |

`settings.app-save` has a side effect that the Settings tab cannot see directly: it also writes a translated `seher-settings.jsonc` to disk so the next `route()` call picks up the new provider list. See [llm-routing](/design/llm-routing/).

## Persistence layout

Everything user-facing is stored in a single SQLite database at:

```
~/Library/Application Support/SmartCrab/smartcrab.db
```

Override with `SMARTCRAB_DB_PATH` (used by tests). Pass `:memory:` for an in-memory database. The full schema is in [spec/database-schema](/spec/database-schema/).

The translated seher router config is written to:

```
~/Library/Application Support/SmartCrab/seher-settings.jsonc
```

Override with `SMARTCRAB_SEHER_CONFIG`.

## Threading and concurrency

- The Bun service is **single-threaded**: one JSON-RPC request handler runs at a time, but handlers are `async`, so long-running work (pipeline execution, LLM calls) yields the event loop and lets the next request be dispatched.
- Pipelines kicked off via `pipeline.execute` run **in the background**: the handler inserts the execution row, returns the execution id, and continues iterating the executor's event stream in a fire-and-forget IIFE that finalises the row when the run ends.
- The cron scheduler uses one `setTimeout` per job. When a job fires, its callback is `await`ed inside a `try`/`catch`, then the job is rearmed for the next tick.
- The memory learn-loop runs on a single `setInterval(30 * 60_000)` timer.

There is no thread pool, no `tokio` runtime, and no inter-process queue — everything is the JS event loop.

## Build and packaging

- `apps/bun-service` builds with `scripts/build.ts`, which calls `Bun.build({ compile: true })` to produce a single executable.
- `scripts/e2e/build-app.sh` copies that executable into `apps/macos/Resources/smartcrab-service`, then runs `xcodebuild` against the `SmartCrabMac` scheme. The resulting `.app` is at `.build/dd-mac/Build/Products/Debug/SmartCrab.app`.
- `scripts/e2e/smoke-rpc.sh` exercises the embedded binary directly without launching the GUI — useful for verifying the wire protocol end of the bundle.
- `scripts/e2e/preview-sim.sh` boots the iOS Simulator preview target with `BunServiceMock` and captures one screenshot per tab.

See [`docs/E2E.md`](../E2E.md) for the full end-to-end verification flow.
