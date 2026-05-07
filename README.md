# SmartCrab

SmartCrab is a framework implementing the Tool-to-AI paradigm — a macOS desktop application for building, running, and managing AI-powered workflows.

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
