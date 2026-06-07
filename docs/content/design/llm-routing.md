+++
title = "LLM routing"
description = "seher-bridge router and how Settings drives `seher-config.yaml`"
weight = 3
+++

SmartCrab does not bind to a single LLM provider. Instead, every LLM call funnels through `router.ts`, which spawns the **`seher-bridge`** binary — a Rust process built from the [`seher`](https://github.com/smartcrabai/seher) crate (`seher-sdk`) and bundled inside the `.app`. The bridge resolves the highest-priority **available** coding agent at run time, given the user's YAML config, and executes the prompt in-process via the Rust `pi` engine (`pi_agent_rust` / `PiRunner`).

```
chat.bubble-send  ──┐
pipeline llm_call ──┤── router.route() ── spawn seher-bridge ──▶  resolve_agent ──▶ PiRunner
skill.invoke      ──┤        │ (NDJSON over stdio)               (codexbar limit check;     │
memory.summarize  ──┘        │                                    NotLimited if absent)      │
                             │                                                    anthropic/<model>
                     fallback to                                                  github-copilot/<model>
                     llmRegistry.default()                                        openai/<model>
                     (ClaudeLlmAdapter, used only when the
                      seher-bridge binary cannot be found
                      or the bridge process fails)
```

The Rust bridge replaces the old npm dependency `@seher-ts/sdk`. The TypeScript router no longer imports any Seher SDK; it talks to the bridge over **NDJSON on stdio** instead.

## Why one router, not many

`server.ts` registers every LLM provider id that nodes can mention — `seher`, `default`, `anthropic`, `copilot`, `openai` — against a **single bridge object**:

```ts
const seherLlmAdapter = {
  async executePrompt(req) {
    const result = await routePrompt({ prompt: req.prompt });
    return { content: result.text };
  },
};
const llmRegistry = new Map<string, typeof seherLlmAdapter>();
for (const id of ["seher", "default", "anthropic", "copilot", "openai"]) {
  llmRegistry.set(id, seherLlmAdapter);
}
```

So a pipeline node that says `provider: anthropic` does **not** force the Claude Agent SDK. The bridge picks the actual agent at run time using priorities, time windows, and rate-limit state. The provider id in the YAML acts more like a hint or a documentation breadcrumb than a binding.

The same bridge backs the chat tab, skill invocation, and the memory summarizer. Routing rules are therefore consistent across every code path that reaches an LLM.

## Locating the `seher-bridge` binary

`router.ts` resolves the bridge executable in this order, using the first hit:

1. **`SMARTCRAB_SEHER_BRIDGE` env var** — an explicit path (used by tests and custom installs).
2. **Adjacent to the service binary** — i.e. the `.app`'s `Contents/Resources/`, where `cargo build --release` output is copied next to `smartcrab-service` at build time.
3. **`PATH`** — for standalone CLI / dev environments where `seher-bridge` is on the shell path.
4. **Not found** → skip the bridge entirely and use the `llmRegistry` fallback (see below).

## `route()` behaviour

`router.ts:route(request)`:

1. **Try `seher-bridge`.** If the binary is found, spawn it and exchange NDJSON messages over stdio:
    - Bun sends a `run` message:

      ```json
      {"type":"run","prompt":"…","systemPrompt":"…","model":"<mode key>",
       "configPath":"$XDG_CONFIG_HOME/smartcrab/seher-config.yaml",
       "tools":[ /* JSON Schema tool defs */ ]}
      ```

      `configPath` defaults to `$XDG_CONFIG_HOME/smartcrab/seher-config.yaml` (default `~/.config/smartcrab/seher-config.yaml`), overridable with `SMARTCRAB_SEHER_CONFIG`. `model` carries the SmartCrab **mode key**, not a raw model id.
    - The bridge calls `resolve_agent` (the rate-limit check goes through `codexbar`; if `codexbar` data is absent the agent is treated as `NotLimited`) to pick the highest-priority provider, then runs the prompt in-process with `PiRunner`.
    - **Tool round-trips**: when the agent calls a tool, the bridge emits `{"type":"tool_call","id":…,"name":…,"input":…}`. Bun runs the matching TypeScript handler and replies with `{"type":"tool_result","id":…,"output":…}` (or `{…,"error":…}`). This loops until the agent stops calling tools.
    - **Termination** is one of:
      - `{"type":"done","text":…,"kind":"pi","sessionId":…}` — success.
      - `{"type":"limit",…}` — every configured agent is rate-limited.
      - `{"type":"error",…}` — anything else went wrong.
2. **Fall back to the registry.** If the bridge binary cannot be found, fails to spawn, or returns an `error`/`limit`, pick `llmRegistry.default()` — the first adapter registered, which today is `ClaudeLlmAdapter`. Use it directly with a single `user` message containing the prompt. Tag the response `kind: "registry-fallback"`.
3. **Hard error.** If neither path is available (no bridge binary and no registered LLM adapter), throw an explanatory error pointing the user at the in-app Settings tab.

The fallback is what keeps the chat tab usable in dev environments that don't have a `seher-bridge` build or a config file yet.

## Settings → `seher-config.yaml`

The Settings tab edits an in-app `SeherConfig` (providers, priorities, defaults). When the user clicks Save:

1. SwiftUI calls `settings.app-save` (RPC).
2. The Bun handler upserts the JSON blob into the `seher_config` SQLite table (single row, `id = 1`).
3. **Side effect**: `writeSeherConfig(cfg)` translates the in-app shape into the seher `Config` shape (YAML `providers` map) and writes it to `$XDG_CONFIG_HOME/smartcrab/seher-config.yaml`.

The next call to `route()` spawns a fresh `seher-bridge` that reads the new file. There is no manual reload step.

### Translation rules

`packages/seher-config-schema`'s `translate` maps SmartCrab's three supported provider kinds to seher provider entries. The Rust `pi` engine handles **every** provider, so all entries use `sdk: pi` and differ only by the model prefix:

| SmartCrab `kind` | UI label                  | Seher `sdk` | Model prefix          | API key env override                     |
|------------------|---------------------------|-------------|-----------------------|------------------------------------------|
| `anthropic`      | Anthropic API-compatible  | `pi`        | `anthropic/<model>`        | `ANTHROPIC_API_KEY`                      |
| `copilot`        | GitHub Copilot            | `pi`        | `github-copilot/<model>`   | `GITHUB_COPILOT_API_KEY` / `GITHUB_TOKEN` |
| `openai`         | OpenAI API-compatible     | `pi`        | `openai/<model>`           | `OPENAI_API_KEY`                         |

Each provider becomes one key in seher's `providers` map with:

- `sdk: pi` — every provider runs through the Rust pi engine.
- `provider`: the resolved provider name.
- `models.build.model`: the qualified model name. Bare names are given the provider prefix above (e.g. `claude-sonnet-4-5` → `anthropic/claude-sonnet-4-5`, `gpt-4o` → `openai/gpt-4o`).
- `models.build.priority`: the maximum weight across all priority rules for that provider.
- `api.key`: taken from the matching `envOverrides` entry (see the table). When no override is present, the value is omitted from the YAML and the **bridge falls back to its own process environment** at run time.

`maxTokens` is not represented: the Rust pi engine does not take it and no caller sets it, so it is dropped from the wire shape.

### All providers run on the Rust pi engine

Every provider — Anthropic, GitHub Copilot, and OpenAI — is driven by the Rust `pi` engine (`pi_agent_rust`). There is no separate per-provider SDK wrapper and no Kimi CLI path.

**Tools work for every provider.** The old `@seher-ts/sdk` pi (OpenAI) path could not carry in-process tools, so `SeherTool` definitions were silently stripped when OpenAI was the active provider. The Rust pi engine supports tools across **all** providers, so tool round-trips work uniformly regardless of which agent `resolve_agent` selects.

### API key handling

API keys are bridged from environment variables into the YAML config's `api.key` field at write time: `ANTHROPIC_API_KEY` for `anthropic`, `GITHUB_COPILOT_API_KEY` (or `GITHUB_TOKEN`) for `copilot`, and `OPENAI_API_KEY` for `openai`. Users who inject secrets via the environment do not need to type them into the GUI. If no override is written, `seher-bridge` reads the same variables from its own process environment as a fallback.

The output file starts with a banner:

```
# Generated by SmartCrab from the in-app Settings tab. Do not edit by hand —
# changes will be overwritten on the next `settings.app-save`.
```

So manual edits are explicitly discouraged.

## Why dynamic imports

`server.ts` imports `router.ts`, `chat-bubble.commands.ts`, and the Discord adapter loader **dynamically**:

```ts
const { route: routePrompt } = await import("./router");
void import("./commands/chat-bubble.commands").then(({ configureChatBubbleCommands }) => {
  configureChatBubbleCommands({ db });
});
void import("./adapters/chat/discord").then(({ setDiscordConfigLoader }) => {
  setDiscordConfigLoader(...);
});
```

Static imports at the top of `server.ts` would trigger circular initialization through the `llmRegistry` proxy: `router.ts` ↔ adapter modules ↔ registry construction. The dynamic-import dance breaks the cycle. The same pattern is used for the memory summarizer wiring.

## PATH propagation

GUI-launched apps on macOS inherit a minimal `PATH` that does not contain Homebrew, mise, or `~/.local/bin`. The embedded Bun service forwards an enriched environment to the `seher-bridge` child so that, in dev environments where the bridge is found on `PATH`, it resolves correctly.

`BunServiceMacOS` works around the minimal-`PATH` problem by spawning the user's login shell once at startup (`$SHELL -lc 'printf %s "$PATH"'`), capturing the output, and forwarding it to the child process's environment. The result is memoised because shell startup is non-trivial.

## Testing

Unit tests don't need a real `seher-bridge` build; they import `router.ts` and test the **fallback path** by registering a stub adapter into `llmRegistry` (point `SMARTCRAB_SEHER_BRIDGE` at a nonexistent path, or rely on the binary being absent in CI). Exercising the bridge end to end requires a built `seher-bridge` binary plus a `seher-config.yaml`; the NDJSON protocol can also be driven directly by piping `run` messages into the binary on stdin. CI without a Rust toolchain or credentials still builds because the bridge is optional and the router degrades to the registry fallback.
