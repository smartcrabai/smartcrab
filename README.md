# SmartCrab

SmartCrab is a framework implementing the Tool-to-AI paradigm — a macOS desktop application for building, running, and managing AI-powered workflows.

## Features

- **YAML pipeline engine** — Directed graph of nodes with conditional branches, parallel siblings, and fan-in. Authored visually in the SwiftUI editor or by hand.
- **Tool-to-AI execution model** — Non-AI work (HTTP, shell, chat events) runs first; `MatchCondition` branches decide whether to escalate to an `llm_call`.
- **Multi-agent LLM routing** — `llm_call` nodes and chat replies are dispatched through [`@seher-ts/sdk`](https://www.npmjs.com/package/@seher-ts/sdk) (≥ 0.1.3), which picks the highest-priority available agent at runtime based on user-defined priorities, time windows (weekday × hour), and rate-limit state. SmartCrab supports four provider kinds:

  | SmartCrab `kind` | UI label | Underlying SDK | Notes |
  |---|---|---|---|
  | `anthropic` | Anthropic API-compatible | [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) | Set `ANTHROPIC_BASE_URL` to redirect to compatible endpoints such as Bedrock / Vertex / OpenRouter |
  | `copilot`   | GitHub Copilot     | [`@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk) | |
  | `kimi`      | Kimi (Moonshot)    | [`@moonshot-ai/kimi-agent-sdk`](https://www.npmjs.com/package/@moonshot-ai/kimi-agent-sdk) | Runs via the `kimi` CLI. SmartCrab isolates `KIMI_SHARE_DIR` per provider and generates `config.toml` |
  | `openai`    | OpenAI API-compatible | [`@moonshot-ai/kimi-agent-sdk`](https://www.npmjs.com/package/@moonshot-ai/kimi-agent-sdk) | Connects to OpenAI / OpenRouter / vLLM / LM Studio etc. via the Kimi CLI's `openai_legacy` provider. Override with `OPENAI_API_KEY` / `OPENAI_BASE_URL` |

  The same router backs the chat tab, pipeline `llm_call` nodes, skill invocation, and the memory summarizer — so routing rules apply uniformly across every code path that reaches an LLM.

- **In-process tool use** — Custom tools (e.g. "what's my current Smartcrab config?") are forwarded to the chosen agent in-process via Seher's `SeherTool` (Zod-shaped). Tools work for `anthropic` / `copilot` / `kimi` / `openai`; Seher's auto-resolution skips agents whose underlying SDK cannot carry tools.
- **Triggers** — Cron schedules and Discord chat events kick off pipelines. New triggers and chat backends plug in via a self-registering adapter registry.
- **Node actions** — `shell_command`, `http_request`, `llm_call`, and `chat_send`, composable in a single pipeline.
- **Self-learning loop** — FTS5-backed memory of chat turns and execution traces, summarized every 30 minutes; recurring patterns are distilled into reusable Markdown skills automatically.
- **Execution history & logs** — Every run is persisted in SQLite with per-node logs, viewable from the History pane.
- **Native macOS app, single binary service** — SwiftUI host + Bun TypeScript service compiled with `bun build --compile` and embedded inside the `.app`. No external runtime to install.
- **Local-first & offline-capable** — All state (pipelines, history, memory, skills) lives in a local SQLite database under `$XDG_DATA_HOME/smartcrab/` (defaults to `~/.local/share/smartcrab/`; the macOS GUI app runs sandboxed, so paths are silently confined to its app container).

## Architecture

- **Frontend**: SwiftUI macOS app (`apps/macos/`). The same Xcode project also produces an iOS Simulator preview target where the service layer is mocked, used purely for UI verification.
- **Service**: Bun TypeScript service (`apps/bun-service/`) compiled to a single binary via `bun build --compile` and bundled inside the `.app` as `Resources/smartcrab-service`.
- **IPC**: Line-delimited JSON-RPC 2.0 over stdin/stdout between the SwiftUI host process and the Bun service child process.
- **Shared packages** (`packages/`):
  - `ipc-protocol` — JSON-RPC method types + adapter interfaces.
  - `seher-config-schema` — SmartCrab provider configuration shape and translator to [`seher-ts`](https://github.com/smartcrabai/seher-ts) router settings.
- **LLM routing**: All `llm_call` nodes and chat sends go through [`seher-ts`](https://github.com/smartcrabai/seher-ts), which resolves the highest-priority available coding agent (Claude Code / Kimi / GitHub Copilot / Codex CLI) based on the user's settings.
- **Chat adapters**: Discord, registered via a self-registering adapter registry.
- **Self-learning**: FTS5-backed memory + 30-minute summarization loop and skill auto-generation, inspired by `hermes-agent`.

macOS is the only supported target. The previous Tauri (Rust) + React stack has been retired.

## Installation

Download the latest `.dmg` from [GitHub Releases](https://github.com/smartcrabai/smartcrab/releases/latest), copy `SmartCrab.app` to `/Applications`, then run:

```sh
xattr -cr /Applications/SmartCrab.app
```

This removes the Gatekeeper quarantine attribute so the app can launch.

## Development

### Prerequisites

- macOS 14+
- Xcode 15+ (`xcode-select --install`)
- [Bun](https://bun.sh) (the version pinned in `.bun-version`)

### Run the Bun service standalone

The service speaks line-delimited JSON-RPC on stdio, so you can drive it directly:

```sh
cd apps/bun-service
bun install
bun run start
# then type:  {"jsonrpc":"2.0","id":1,"method":"system.ping"}
```

### Run the full app

The end-to-end build scripts compile the Bun service into a single binary, copy it into `apps/macos/Resources/`, then build and run the SwiftUI app:

```sh
./scripts/e2e/build-app.sh debug
open .build/dd-mac/Build/Products/Debug/SmartCrab.app
```

A no-credentials smoke test of the embedded service:

```sh
./scripts/e2e/smoke-rpc.sh system.ping
```

For UI-only iteration the iOS Simulator preview target uses a mock service:

```sh
./scripts/e2e/preview-sim.sh "iPhone 17 Pro"
```

See [`docs/E2E.md`](docs/E2E.md) for the full end-to-end verification flow.

## Documentation

https://smartcrabai.github.io/smartcrab/

## License

Apache-2.0
