+++
title = "LLM routing"
description = "seher-ts router and how Settings drives `seher-config.yaml`"
weight = 3
+++

SmartCrab does not bind to a single LLM provider. Instead, every LLM call funnels through `router.ts`, which delegates to [`@seher-ts/sdk`](https://www.npmjs.com/package/@seher-ts/sdk) (≥ 0.1.13) — an external router SDK that resolves the highest-priority **available** coding agent at run time, given the user's settings file.

```
chat.bubble-send  ──┐
pipeline llm_call ──┤── router.route() ── SeherSDK ──▶  Claude Agent SDK        (anthropic)
skill.invoke      ──┤                       │       │  Copilot SDK              (copilot)
memory.summarize  ──┘                       │       │  pi-coding-agent          (openai)
                                            │
                                    fallback to
                                    llmRegistry.default()
                                    (ClaudeLlmAdapter, used only when
                                     @seher-ts/sdk import fails)
```

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

So a pipeline node that says `provider: anthropic` does **not** force the Claude Agent SDK. Seher picks the actual agent at run time using priorities, time windows, and rate-limit state. The provider id in the YAML acts more like a hint or a documentation breadcrumb than a binding.

The same bridge backs the chat tab, skill invocation, and the memory summarizer. Routing rules are therefore consistent across every code path that reaches an LLM.

## `route()` behaviour

`router.ts:route(request)`:

1. **Try @seher-ts/sdk.** Lazy `await import("@seher-ts/sdk")` (cached). If the import succeeds, instantiate `SeherSDK` with:
    - `configPath: defaultSeherConfigPath()` — `$XDG_CONFIG_HOME/smartcrab/seher-config.yaml` (default `~/.config/smartcrab/seher-config.yaml`), overridable with `SMARTCRAB_SEHER_CONFIG`.
    - `noWait: true` — fail fast if every configured agent is rate-limited, instead of sleeping the chat thread until a quota reset. The chat tab surfaces the failure as an assistant bubble (`"LLM error: ..."`) rather than hanging.
2. **Fall back to the registry.** If `@seher-ts/sdk` is unavailable (not installed, import failure) or its `run()` throws, pick `llmRegistry.default()` — the first adapter registered, which today is `ClaudeLlmAdapter`. Use it directly with a single `user` message containing the prompt. Tag the response `kind: "registry-fallback"`.
3. **Hard error.** If neither path is available (no `@seher-ts/sdk` and no registered LLM adapter), throw an explanatory error pointing the user at the in-app Settings tab.

The fallback is what keeps the chat tab usable in dev environments that don't have a seher settings file yet.

## Settings → `seher-config.yaml`

The Settings tab edits an in-app `SeherConfig` (providers, priorities, defaults). When the user clicks Save:

1. SwiftUI calls `settings.app-save` (RPC).
2. The Bun handler upserts the JSON blob into the `seher_config` SQLite table (single row, `id = 1`).
3. **Side effect**: `writeSeherConfig(cfg)` translates the in-app shape into seher-ts 0.1.13's `Config` shape (YAML `providers` map) and writes it to `$XDG_CONFIG_HOME/smartcrab/seher-config.yaml`.

The next call to `route()` instantiates a fresh `SeherSDK` that reads the new file. There is no manual reload step.

### Translation rules

`write-settings.ts:translateToSeherConfig` maps SmartCrab's three supported provider kinds to the seher-ts provider entries:

| SmartCrab `kind` | UI label                  | Seher `sdk` | Seher `provider` | Underlying SDK |
|------------------|---------------------------|-------------|-------------------|----------------|
| `anthropic`      | Anthropic API-compatible  | `claude`    | `anthropic`       | Claude Agent SDK |
| `copilot`        | GitHub Copilot            | `copilot`   | `copilot`         | Copilot SDK |
| `openai`         | OpenAI API-compatible     | `pi`        | `openai`          | pi-coding-agent (via `@seher-ts/sdk`) |

Each provider becomes one key in seher's `providers` map with:

- `sdk`: the matching SDK identifier so Seher picks the right SDK wrapper
- `provider`: the resolved provider name
- `models.build.model`: the qualified model name (for openai, bare names like `gpt-4o` are prefixed to `openai/gpt-4o`)
- `models.build.priority`: the maximum weight across all priority rules for that provider
- `api.key` / `api.endpoint`: for openai providers, `OPENAI_API_KEY` / `OPENAI_BASE_URL` env overrides are transcribed here

### openai → pi-coding-agent

The `openai` kind is driven by [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) through seher-ts's `sdk: "pi"` path. The old Kimi CLI-based approach (`openai_legacy` provider) has been removed.

**Important**: pi-coding-agent does not support in-process tools. When openai is selected as the active provider, `SeherTool` definitions are silently stripped and the agent responds without tool calls. Tools continue to work for `anthropic` and `copilot`.

### API key handling

OpenAI API keys are bridged from environment variables (`OPENAI_API_KEY`, `OPENAI_BASE_URL`) into the YAML config's `api.key` / `api.endpoint` fields at write time. Users who inject secrets via the environment do not need to type them into the GUI. The confidentiality level is equivalent to the old approach.

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

GUI-launched apps on macOS inherit a minimal `PATH` that does not contain Homebrew, mise, or `~/.local/bin`. Without intervention, the embedded Bun service cannot find `claude`, which the Claude Agent SDK spawns as a subprocess.

`BunServiceMacOS` works around this by spawning the user's login shell once at startup (`$SHELL -lc 'printf %s "$PATH"'`), capturing the output, and forwarding it to the child process's environment. The result is memoised because shell startup is non-trivial. This is what lets the SDK wrappers succeed when they call `Bun.which("claude")` from a Finder-launched app.

## Testing

Unit tests don't need a real `@seher-ts/sdk` install; they import `router.ts` and test the **fallback path** by registering a stub adapter into `llmRegistry`. End-to-end testing of routing requires either a real `@seher-ts/sdk` config file or a mock `SeherSDK`. The `optionalDependencies` block in `apps/bun-service/package.json` keeps `@seher-ts/sdk` optional so CI without credentials still builds.
