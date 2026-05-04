#!/bin/sh
# Build the iOS Simulator preview app (mocked BunService), boot a simulator,
# install + launch the app, kick off `serve-sim`, and capture a screenshot
# of each tab.
#
# Requires:
#   - macOS with Xcode + the matching iOS Simulator runtime installed
#     (xcodebuild -downloadPlatform iOS)
#   - npx (for serve-sim)
#
# Usage: ./scripts/e2e/preview-sim.sh [device-name]
#        Default device: "iPhone 17 Pro"
set -eu

DEVICE="${1:-iPhone 17 Pro}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DERIVED="${REPO_ROOT}/.build/dd-ios"
OUT_DIR="${REPO_ROOT}/.build/preview-screenshots"
BUNDLE_ID="ai.smartcrab.preview"

mkdir -p "${OUT_DIR}"

echo "[preview] step 1/5 building SmartCrabPreview"
cd "${REPO_ROOT}"
xcodebuild build \
  -project apps/macos/SmartCrab.xcodeproj \
  -scheme SmartCrabPreview \
  -destination "platform=iOS Simulator,name=${DEVICE}" \
  -derivedDataPath "${DERIVED}" \
  >/dev/null

APP_PATH="${DERIVED}/Build/Products/Debug-iphonesimulator/SmartCrabPreview.app"

echo "[preview] step 2/5 booting simulator '${DEVICE}'"
xcrun simctl boot "${DEVICE}" 2>/dev/null || true
xcrun simctl bootstatus "${DEVICE}" -b >/dev/null 2>&1 || true

echo "[preview] step 3/5 installing + launching"
xcrun simctl install booted "${APP_PATH}"
xcrun simctl launch booted "${BUNDLE_ID}" >/dev/null

echo "[preview] step 4/5 starting serve-sim"
SERVE_SIM_OUT="${OUT_DIR}/serve-sim.json"
npx --yes serve-sim --detach >"${SERVE_SIM_OUT}" 2>&1 || {
  echo "[preview] serve-sim failed to start; continuing with screenshots only" >&2
}

echo "[preview] step 5/5 capturing screenshots for each tab"
TABS="chat pipelines cron skills history settings"
sleep 3
for tab in ${TABS}; do
  xcrun simctl io booted screenshot "${OUT_DIR}/${tab}.png"
  echo "[preview]  captured ${tab}.png"
  # NOTE: real navigation between tabs requires tap coordinates per device.
  # Without a programmatic accessibility API, the same screenshot is captured
  # for every tab unless the user navigates manually. Use:
  #   npx serve-sim gesture tap <x> <y>
  # to drive interactions when running interactively.
done

echo "[preview] cleanup"
npx --yes serve-sim --kill >/dev/null 2>&1 || true
xcrun simctl terminate booted "${BUNDLE_ID}" >/dev/null 2>&1 || true

echo "[preview] done. screenshots in ${OUT_DIR}"
