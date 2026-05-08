+++
title = "LLM routing"
description = "seher-ts router and how Settings drives `seher-settings.jsonc`"
weight = 3
+++

SmartCrab does not bind to a single LLM provider. Instead, every LLM call funnels through `router.ts`, which delegates to [`@seher-ts/sdk`](https://www.npmjs.com/package/@seher-ts/sdk) (≥ 0.1.3) — an external router SDK that resolves the highest-priority **available** coding agent at run time, given the user's settings file.

```
chat.bubble-send  ──┐
pipeline llm_call ──┤── router.route() ── SeherSDK ──▶  Claude Agent SDK   (anthropic)
skill.invoke      ──┤                       │       │  Copilot SDK         (copilot)
memory.summarize  ──┘                       │       │  Kimi Agent SDK      (kimi / openai)
                                            │
                                    fallback to
                                    llmRegistry.default()
                                    (ClaudeLlmAdapter, used only when
                                     @seher-ts/sdk import fails)
```

## Why one router, not many

`server.ts` registers every LLM provider id that nodes can mention — `seher`, `default`, `anthropic`, `copilot`, `kimi`, `openai` — against a **single bridge object**:

```ts
const seherLlmAdapter = {
  async executePrompt(req) {
    const result = await routePrompt({ prompt: req.prompt });
    return { content: result.text };
  },
};
const llmRegistry = new Map<string, typeof seherLlmAdapter>();
for (const id of ["seher", "default", "anthropic", "copilot", "kimi", "openai"]) {
  llmRegistry.set(id, seherLlmAdapter);
}
```

So a pipeline node that says `provider: anthropic` does **not** force the Claude Agent SDK. Seher picks the actual agent at run time using priorities, time windows, and rate-limit state. The provider id in the YAML acts more like a hint or a documentation breadcrumb than a binding.

The same bridge backs the chat tab, skill invocation, and the memory summarizer. Routing rules are therefore consistent across every code path that reaches an LLM.

## `route()` behaviour

`router.ts:route(request)`:

1. **Try @seher-ts/sdk.** Lazy `await import("@seher-ts/sdk")` (cached). If the import succeeds, instantiate `SeherSDK` with:
    - `configPath: defaultSeherConfigPath()` — `~/Library/Application Support/SmartCrab/seher-settings.jsonc`, overridable with `SMARTCRAB_SEHER_CONFIG`.
    - `noWait: true` — fail fast if every configured agent is rate-limited, instead of sleeping the chat thread until a quota reset. The chat tab surfaces the failure as an assistant bubble (`"LLM error: ..."`) rather than hanging.
2. **Fall back to the registry.** If `@seher-ts/sdk` is unavailable (not installed, import failure) or its `run()` throws, pick `llmRegistry.default()` — the first adapter registered, which today is `ClaudeLlmAdapter`. Use it directly with a single `user` message containing the prompt. Tag the response `kind: "registry-fallback"`.
3. **Hard error.** If neither path is available (no `@seher-ts/sdk` and no registered LLM adapter), throw an explanatory error pointing the user at the in-app Settings tab.

The fallback is what keeps the chat tab usable in dev environments that don't have a seher settings file yet.

## Settings → `seher-settings.jsonc`

The Settings tab edits an in-app `SeherConfig` (providers, priorities, defaults). When the user clicks Save:

1. SwiftUI calls `settings.app-save` (RPC).
2. The Bun handler upserts the JSON blob into the `seher_config` SQLite table (single row, `id = 1`).
3. **Side effect**: `writeSeherSettings(cfg)` translates the in-app shape into seher-ts's expected `Settings` shape and writes it to `~/Library/Application Support/SmartCrab/seher-settings.jsonc`.

The next call to `route()` instantiates a fresh `SeherSDK` that reads the new file. There is no manual reload step.

### Translation rules

`write-settings.ts:translateToSeherSettings` maps SmartCrab's four supported provider kinds to the agent / provider names Seher expects:

| SmartCrab `kind` | UI label           | Seher `command` | Seher `provider.name` | Seher `sdk` | Underlying SDK |
|------------------|--------------------|-----------------|------------------------|-------------|----------------|
| `anthropic`      | Anthropic API互換  | `claude`        | `anthropic`            | `claude`    | Claude Agent SDK |
| `copilot`        | GitHub Copilot     | `copilot`       | `github`               | `copilot`   | Copilot SDK |
| `kimi`           | Kimi (Moonshot)    | `kimi`          | `moonshot`             | `kimi`      | Kimi Agent SDK |
| `openai`         | OpenAI API互換     | `kimi`          | `openai`               | `kimi`      | Kimi Agent SDK (Kimi CLI の `openai_legacy` プロバイダ) |

Each provider becomes one entry in Seher's `agents` array with:

- `command`: the CLI the SDK wrapper spawns under the hood
- `models: { default: <model> }` if a model is configured
- `env`: the user's `envOverrides` (e.g. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENAI_BASE_URL`) merged with auto-injected `KIMI_SHARE_DIR` for kimi-backed kinds
- `provider: { kind: "explicit", name }` for known kinds, otherwise `{ kind: "inferred" }`
- `sdk`: the matching SDK identifier so Seher picks the right SDK wrapper

### Per-provider Kimi share directory

`kimi` and `openai` both end up calling the `kimi` CLI under the hood. The CLI selects its upstream LLM from `<KIMI_SHARE_DIR>/config.toml`, and env-var overrides only work when the configured provider type matches (`KIMI_*` for `type = "kimi"`, `OPENAI_*` for `type = "openai_legacy"`).

To support both kinds without touching the user's own `~/.kimi/config.toml`, SmartCrab gives each provider its own share directory and writes a generated `config.toml`:

```
~/Library/Application Support/SmartCrab/kimi-share/<providerId>/config.toml
```

The path is overridable via `SMARTCRAB_KIMI_SHARE_ROOT` (mainly for tests). `kimi-share.ts:writeKimiShare` is invoked from `writeSeherSettings` for every kimi-backed provider on save, and the matching `KIMI_SHARE_DIR` is auto-injected into the agent's `env`.

Per-provider `priority` rules in the in-app config become entries in seher's top-level `priority` array. Time windows are encoded by:

- `weekdayFilter: number[]` (0..6) → compressed into seher-style ranges like `["1-5"]` for Mon–Fri.
- `[hourStart, hourEnd]` → `["9-18"]`. The full day `[0, 24]` is omitted entirely (seher treats absence as "always").

If the configured `defaults.fallbackProviderId` does not appear in any priority rule, the translator appends a `priority: 0` entry for it so seher always has a candidate, even when no time-windowed rule matches.

The output file starts with a banner:

```
// Generated by SmartCrab from the in-app Settings tab. Do not edit by hand —
// changes will be overwritten on the next `settings.app-save`.
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

GUI-launched apps on macOS inherit a minimal `PATH` that does not contain Homebrew, mise, or `~/.local/bin`. Without intervention, the embedded Bun service cannot find `claude` or `kimi`, which the Claude Agent SDK and Kimi Agent SDK respectively spawn as subprocesses.

`BunServiceMacOS` works around this by spawning the user's login shell once at startup (`$SHELL -lc 'printf %s "$PATH"'`), capturing the output, and forwarding it to the child process's environment. The result is memoised because shell startup is non-trivial. This is what lets the SDK wrappers succeed when they call `Bun.which("claude")` / `Bun.which("kimi")` from a Finder-launched app.

## Testing

Unit tests don't need a real `@seher-ts/sdk` install; they import `router.ts` and test the **fallback path** by registering a stub adapter into `llmRegistry`. End-to-end testing of routing requires either a real `@seher-ts/sdk` settings file or a mock `SeherSDK`. The `optionalDependencies` block in `apps/bun-service/package.json` keeps `@seher-ts/sdk` optional so CI without credentials still builds.
