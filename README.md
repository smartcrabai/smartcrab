# SmartCrab

SmartCrab is a Rust framework implementing the Tool-to-AI paradigm — a Tauri-based desktop application for building, running, and managing AI-powered workflows.

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
