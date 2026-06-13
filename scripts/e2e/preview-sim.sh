#!/bin/sh
# Build the iOS Simulator preview app (mocked BunService), boot a simulator,
# install + launch the app, kick off `serve-sim`, and capture a screenshot
# of each tab.
#
# Requires:
#   - macOS with Xcode + the matching iOS Simulator runtime installed
#     (`xcodebuild -downloadPlatform iOS` once)
#   - npx (for serve-sim)
#
# Usage: ./scripts/e2e/preview-sim.sh [device-udid-or-name] [runtime-substring]
#        ./scripts/e2e/preview-sim.sh                   # auto-pick iPhone 17 Pro on the latest iOS runtime
#        ./scripts/e2e/preview-sim.sh "iPhone 17 Pro"   # pick by name (latest matching runtime)
#        ./scripts/e2e/preview-sim.sh A923D30A-...       # pick by exact UDID
#        ./scripts/e2e/preview-sim.sh "iPhone 17 Pro" 26-4   # pin both name and runtime
set -eu

NAME_OR_UDID="${1:-iPhone 17 Pro}"
RUNTIME_SUBSTR="${2:-}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DERIVED="${REPO_ROOT}/.build/dd-ios"
OUT_DIR="${REPO_ROOT}/.build/preview-screenshots"
BUNDLE_ID="ai.smartcrab.preview"

mkdir -p "${OUT_DIR}"

# Resolve a concrete device UDID. Multiple iPhone-17-Pro devices may exist
# (one per installed runtime); pick the one whose runtime matches
# RUNTIME_SUBSTR if set, otherwise the alphabetically-largest runtime key
# (which equates to the newest iOS).
if printf '%s' "${NAME_OR_UDID}" | grep -Eq '^[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}$'; then
  DEVICE="${NAME_OR_UDID}"
else
  DEVICE="$(xcrun simctl list devices --json \
    | jq -r --arg name "${NAME_OR_UDID}" --arg rt "${RUNTIME_SUBSTR}" \
        '.devices | to_entries
         | map(select(.key | contains("SimRuntime.iOS")))
         | map(select($rt == "" or (.key | contains($rt))))
         | sort_by(.key) | reverse
         | .[].value[]
         | select(.name == $name)
         | .udid' | head -1)"
fi

if [ -z "${DEVICE}" ]; then
  echo "[preview] no simulator matches name='${NAME_OR_UDID}' runtime='${RUNTIME_SUBSTR}'" >&2
  echo "[preview] hint: install a runtime with \`xcodebuild -downloadPlatform iOS\` first." >&2
  exit 1
fi

echo "[preview] using device ${DEVICE}"

echo "[preview] step 1/5 building SmartCrabPreview"
cd "${REPO_ROOT}"
xcodebuild build \
  -project apps/macos/SmartCrab.xcodeproj \
  -scheme SmartCrabPreview \
  -destination "platform=iOS Simulator,id=${DEVICE}" \
  -derivedDataPath "${DERIVED}" \
  >/dev/null

APP_PATH="${DERIVED}/Build/Products/Debug-iphonesimulator/SmartCrabPreview.app"

echo "[preview] step 2/5 booting simulator"
xcrun simctl boot "${DEVICE}" 2>/dev/null || true
# First-boot data migration on a freshly downloaded runtime can take 2-3 min.
xcrun simctl bootstatus "${DEVICE}" -b >/dev/null

echo "[preview] step 3/5 installing + launching"
xcrun simctl install "${DEVICE}" "${APP_PATH}"
xcrun simctl launch "${DEVICE}" "${BUNDLE_ID}" >/dev/null

echo "[preview] step 4/5 starting serve-sim"
SERVE_SIM_OUT="${OUT_DIR}/serve-sim.json"
npx --yes serve-sim --detach >"${SERVE_SIM_OUT}" 2>&1 || {
  echo "[preview] serve-sim failed to start; continuing with screenshots only" >&2
}

echo "[preview] step 5/5 capturing screenshots for each tab"
TABS="chat pipelines skills history settings"
sleep 3
for tab in ${TABS}; do
  xcrun simctl io "${DEVICE}" screenshot "${OUT_DIR}/${tab}.png"
  echo "[preview]  captured ${tab}.png"
  # NOTE: real navigation between tabs requires tap coordinates per device.
  # Without a programmatic accessibility API, the same screenshot is captured
  # for every tab unless the user navigates manually. Use:
  #   npx serve-sim gesture tap <x> <y>
  # to drive interactions when running interactively.
done

echo "[preview] cleanup"
npx --yes serve-sim --kill >/dev/null 2>&1 || true
xcrun simctl terminate "${DEVICE}" "${BUNDLE_ID}" >/dev/null 2>&1 || true

echo "[preview] done. screenshots in ${OUT_DIR}"
