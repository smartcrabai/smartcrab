# SmartCrab

SmartCrab is a framework implementing the Tool-to-AI paradigm — a desktop application for building, running, and managing AI-powered workflows.

## Architecture (in transition)

SmartCrab is being migrated from a Tauri (Rust) + React stack to a native macOS app:

- **Frontend**: SwiftUI macOS app (`apps/macos/`). Universal target also supports the iOS Simulator for UI preview, where the service layer is mocked.
- **Service**: Bun TypeScript service (`apps/bun-service/`) compiled to a single binary via `bun build --compile` and bundled inside the `.app`.
- **IPC**: Line-delimited JSON-RPC over stdin/stdout between the SwiftUI host process and the Bun service child process.
- **Shared packages** (`packages/`):
  - `ipc-protocol` — JSON-RPC method types + adapter interfaces, with generators for JSON Schema and Swift bindings.
  - `seher-config-schema` — SmartCrab provider configuration shape and translator to [`seher-ts`](https://github.com/smartcrabai/seher-ts) router settings.
- **LLM SDKs**: Claude Agent SDK, Kimi Agent SDK, GitHub Copilot SDK.
- **Chat adapters**: Discord first, with a pluggable adapter registry.
- **Self-learning**: FTS5-backed memory + skill auto-generation loop inspired by `hermes-agent`.

Linux and Windows release targets are being retired; the existing Tauri/Rust crates under `crates/` will be removed once the SwiftUI + Bun stack reaches feature parity.

## Installation

### macOS

Download the `.dmg` from [GitHub Releases](https://github.com/smartcrabai/smartcrab/releases/latest).

After downloading the DMG and copying `SmartCrab.app` to `/Applications`, run the following in Terminal before the first launch:

```sh
xattr -cr /Applications/SmartCrab.app
```

This removes the Gatekeeper quarantine attribute, allowing the app to launch.

### Windows

Download the `.msi` or `.exe` installer from [GitHub Releases](https://github.com/smartcrabai/smartcrab/releases/latest).

### Linux

Download the `.deb` or `.AppImage` from [GitHub Releases](https://github.com/smartcrabai/smartcrab/releases/latest).

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) 24+
- Linux only: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

### Setup

```sh
cd crates/smartcrab-app
npm install
```

### Run (development)

```sh
npm run tauri dev
```

### Build (production)

```sh
npm run tauri build
```

## Documentation

https://smartcrabai.github.io/smartcrab/

## License

Apache-2.0
