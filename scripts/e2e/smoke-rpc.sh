#!/bin/sh
# Send a one-shot JSON-RPC request to the Bun service binary embedded in the
# built .app and print the response.
# Usage: ./scripts/e2e/smoke-rpc.sh [system.ping|system.version]
set -eu

METHOD="${1:-system.ping}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_BIN="${REPO_ROOT}/.build/dd-mac/Build/Products/Debug/SmartCrab.app/Contents/Resources/smartcrab-service"

if [ ! -x "$APP_BIN" ]; then
  echo "build the app first: ./scripts/e2e/build-app.sh" >&2
  exit 1
fi

case "$METHOD" in
  system.ping|system.version)
    PARAMS="{}"
    ;;
  *)
    echo "unsupported smoke method: $METHOD (try system.ping or system.version)" >&2
    exit 1
    ;;
esac

echo '{"jsonrpc":"2.0","id":"smoke-1","method":"'"$METHOD"'","params":'"$PARAMS"'}' \
  | "$APP_BIN"
