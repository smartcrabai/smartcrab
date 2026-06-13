#!/bin/sh
# Build the macOS production app, launch it, capture a per-tab screenshot
# of just the SmartCrab window via `screencapture -l`, and quit.
#
# Mac counterpart of `preview-sim.sh` (which is iOS-only via serve-sim).
# `serve-sim` works against `simctl io`'s framebuffer and has no macOS
# equivalent; we instead drive the live app through System Events for
# clicks and use `screencapture -l <window-id>` for capture.
#
# Usage: ./scripts/e2e/preview-mac.sh [debug|release]
set -eu

CONFIG="${1:-debug}"
case "$CONFIG" in
  debug)   XC_CONFIG=Debug ;;
  release) XC_CONFIG=Release ;;
  *) echo "config must be debug or release" >&2; exit 1 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DERIVED="${REPO_ROOT}/.build/dd-mac"
OUT_DIR="${REPO_ROOT}/.build/macos-screenshots"
APP_PATH="${DERIVED}/Build/Products/${XC_CONFIG}/SmartCrab.app"
APP_NAME="SmartCrab"

mkdir -p "${OUT_DIR}"

# 1. Build (delegates to build-app.sh — also handles bun service binary staging)
"${REPO_ROOT}/scripts/e2e/build-app.sh" "${CONFIG}" >/dev/null

# 2. Make sure no stale instance is running
osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
sleep 1

# 3. Launch
open -a "${APP_PATH}"
sleep 4
osascript -e "tell application \"${APP_NAME}\" to activate" >/dev/null 2>&1 || true
sleep 1

# 4. Resolve the window id via CGWindowList (osascript can't always read it
#    when the window is on a non-primary display).
window_id() {
  swift -e '
import AppKit
import CoreGraphics
let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
for w in info {
  if let owner = w[kCGWindowOwnerName as String] as? String, owner == "'"${APP_NAME}"'",
     let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
     let id = w[kCGWindowNumber as String] as? Int {
    print(id); break
  }
}'
}

WID="$(window_id || true)"
if [ -z "${WID}" ]; then
  echo "[preview-mac] could not find ${APP_NAME} window id; aborting" >&2
  exit 1
fi
echo "[preview-mac] window id ${WID}"

# 5. Capture per tab. The app exposes Cmd+1..5 to jump to each tab — SwiftUI's
#    List(selection:) doesn't respond reliably to synthetic mouse events from
#    System Events / CGEvent, so the keyboard shortcut is the most reliable
#    automation surface.
TABS="Chat Pipelines Skills History Settings"
i=1
for tab in ${TABS}; do
  osascript <<APPLESCRIPT >/dev/null 2>&1 || true
tell application "System Events"
  tell process "${APP_NAME}"
    set frontmost to true
    keystroke "${i}" using command down
  end tell
end tell
APPLESCRIPT
  sleep 1
  out="${OUT_DIR}/$(echo "${tab}" | tr '[:upper:]' '[:lower:]').png"
  screencapture -l "${WID}" -x "${out}" 2>/dev/null || true
  echo "[preview-mac]  captured ${out}"
  i=$((i + 1))
done

# 6. Cleanup
osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
echo "[preview-mac] done. screenshots in ${OUT_DIR}"
