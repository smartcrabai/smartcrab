# End-to-end verification

This document describes how to verify the full SwiftUI (macOS) + Bun (logic) stack end to end.

## Prerequisites

- macOS 14+
- Xcode 15+ (`xcode-select --install`)
- [Bun](https://bun.sh)

For the chat round-trip:

- A Discord bot token (set in `DISCORD_BOT_TOKEN`)
- A Claude API key (set in `ANTHROPIC_API_KEY`)

## 1. Build the app with the embedded Bun binary

```sh
./scripts/e2e/build-app.sh debug
```

This compiles the Bun service into a single executable, copies it into
`apps/macos/Resources/smartcrab-service`, then runs `xcodebuild` against the
SmartCrabMac scheme. The resulting `.app` is written to
`.build/dd-mac/Build/Products/Debug/SmartCrab.app`.

## 2. Stdio JSON-RPC smoke test (no credentials)

```sh
./scripts/e2e/smoke-rpc.sh system.ping
# → {"jsonrpc":"2.0","id":"smoke-1","result":"pong"}
```

This proves the Bun binary is wired up correctly inside the bundle and is
reachable over the same stdio JSON-RPC transport that SwiftUI uses at
runtime.

## 3. Launch the GUI

```sh
open .build/dd-mac/Build/Products/Debug/SmartCrab.app
```

The app spawns the embedded Bun service as a subprocess and exposes Chat,
Pipelines, Cron, Skills, History, and Settings tabs.

## 4. Discord round-trip (requires credentials)

1. Open Settings → Adapter Settings, paste the env-var name holding your
   bot token (default `DISCORD_BOT_TOKEN`) and the notification channel ID,
   and toggle the adapter on.
2. Open Settings → Seher Config, add a `claude` provider.
3. From a Discord client, send a message in the configured channel.
4. The Bun service forwards the message to the Claude Agent SDK adapter and
   posts the assistant reply back to the channel.

Check the console (`Console.app` filtering on `SmartCrab`) for log lines
prefixed `[bun-service]` and `[discord-listener]` to follow the round trip.

## 5. iOS Simulator preview (UI verification only)

The `SmartCrabPreview` scheme is iOS-only and uses a mock BunService so each
SwiftUI view renders sample data without spawning a subprocess.

```sh
xcodebuild build \
  -project apps/macos/SmartCrab.xcodeproj \
  -scheme SmartCrabPreview \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath /tmp/dd-ios

xcrun simctl boot 'iPhone 17 Pro' 2>/dev/null || true
xcrun simctl install booted /tmp/dd-ios/Build/Products/Debug-iphonesimulator/SmartCrabPreview.app
xcrun simctl launch booted ai.smartcrab.preview
npx serve-sim --detach          # MJPEG stream + gesture API for AI agents
```

Capture screenshots with `xcrun simctl io booted screenshot /tmp/<view>.png`
or drive interactions through `serve-sim gesture …`.
