#!/bin/sh
# Build the macOS .app with the production Bun service binary embedded.
# Usage: ./scripts/e2e/build-app.sh [debug|release]
set -eu

CONFIG="${1:-debug}"
case "$CONFIG" in
  debug)   XC_CONFIG=Debug ;;
  release) XC_CONFIG=Release ;;
  *) echo "config must be debug or release" >&2; exit 1 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DERIVED="${REPO_ROOT}/.build/dd-mac"

echo "[e2e] step 1/3 building Bun service binary"
cd "${REPO_ROOT}/apps/bun-service"
bun install --frozen-lockfile >/dev/null
bun run build

echo "[e2e] step 2/3 staging binary into apps/macos/Resources"
cp -f "${REPO_ROOT}/apps/bun-service/dist/smartcrab-service" \
      "${REPO_ROOT}/apps/macos/Resources/smartcrab-service"
chmod +x "${REPO_ROOT}/apps/macos/Resources/smartcrab-service"

echo "[e2e] step 3/3 xcodebuild SmartCrabMac (${XC_CONFIG})"
cd "${REPO_ROOT}"
xcodebuild build \
  -project apps/macos/SmartCrab.xcodeproj \
  -scheme SmartCrabMac \
  -configuration "${XC_CONFIG}" \
  -destination 'platform=macOS' \
  -derivedDataPath "${DERIVED}" \
  >/dev/null

APP_PATH="${DERIVED}/Build/Products/${XC_CONFIG}/SmartCrab.app"
echo "[e2e] built: ${APP_PATH}"
