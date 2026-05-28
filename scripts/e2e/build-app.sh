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
BUN_SVC_DIR="${REPO_ROOT}/apps/bun-service"
BUN_BINARY="${BUN_SVC_DIR}/dist/smartcrab-service"
STAGED_BINARY="${REPO_ROOT}/apps/macos/Resources/smartcrab-service"

# Skip the bun build (~5–10s) when nothing under apps/bun-service/ has been
# touched since the binary was last produced. `find -newer` returns any
# matching path; an empty result means the binary is current.
needs_bun_rebuild() {
  [ ! -x "${BUN_BINARY}" ] && return 0
  newer=$(find "${BUN_SVC_DIR}" \
    -path "${BUN_SVC_DIR}/dist" -prune -o \
    -path "${BUN_SVC_DIR}/node_modules" -prune -o \
    \( -name '*.ts' -o -name '*.sql' -o -name '*.json' -o -name '*.lockb' \) \
    -newer "${BUN_BINARY}" -print 2>/dev/null | head -1)
  [ -n "${newer}" ]
}

if needs_bun_rebuild; then
  echo "[e2e] step 1/3 building Bun service binary"
  cd "${BUN_SVC_DIR}"
  bun install --frozen-lockfile >/dev/null
  bun run build
  cd "${REPO_ROOT}"
else
  echo "[e2e] step 1/3 bun-service binary up-to-date — skipping build"
fi

if ! cmp -s "${BUN_BINARY}" "${STAGED_BINARY}" 2>/dev/null; then
  echo "[e2e] step 2/3 staging binary into apps/macos/Resources"
  cp -f "${BUN_BINARY}" "${STAGED_BINARY}"
  chmod +x "${STAGED_BINARY}"
else
  echo "[e2e] step 2/3 staged binary already matches — skipping copy"
fi

# Stable dev code signing (Debug only, optional). When a code-signing identity
# named by APP_IDENTITY (default "SmartCrab Development") exists in the
# keychain, sign the Debug build with it so the app's designated requirement
# stays constant across rebuilds — macOS Keychain then stops re-prompting for
# stored secrets on every launch. Without it the project's default ad-hoc
# signing is used, so CI and other contributors are unaffected. Create the
# identity with ./scripts/setup-dev-signing.sh.
#
# ENABLE_HARDENED_RUNTIME=NO disables library validation for the local Debug
# build. With it on, Xcode's separately-signed Swift debug dylib
# (ENABLE_DEBUG_DYLIB) trips a Team ID mismatch and the app aborts at launch
# ("Library not loaded … different Team IDs"). Release builds skip this path
# and keep the project's hardened-runtime setting (required for notarization).
#
# `set --` accumulates the extra xcodebuild settings into the positional
# params (CONFIG was already captured above, so $1 is free to clobber).
APP_IDENTITY="${APP_IDENTITY:-SmartCrab Development}"
set --
if [ "${XC_CONFIG}" != "Debug" ]; then
  echo "[e2e] step 3/3 xcodebuild SmartCrabMac (${XC_CONFIG})"
elif security find-identity -p codesigning -v 2>/dev/null | grep -Fq "${APP_IDENTITY}"; then
  echo "[e2e] step 3/3 xcodebuild SmartCrabMac (${XC_CONFIG}) — signing as '${APP_IDENTITY}'"
  set -- "CODE_SIGN_IDENTITY=${APP_IDENTITY}" "CODE_SIGN_STYLE=Manual" \
         "CODE_SIGNING_ALLOWED=YES" "DEVELOPMENT_TEAM=" "ENABLE_HARDENED_RUNTIME=NO"
else
  echo "[e2e] step 3/3 xcodebuild SmartCrabMac (${XC_CONFIG}) — ad-hoc signing"
  echo "[e2e]   run ./scripts/setup-dev-signing.sh to stop Keychain password prompts"
fi

cd "${REPO_ROOT}"
xcodebuild build \
  -project apps/macos/SmartCrab.xcodeproj \
  -scheme SmartCrabMac \
  -configuration "${XC_CONFIG}" \
  -destination 'platform=macOS' \
  -derivedDataPath "${DERIVED}" \
  "$@" \
  >/dev/null

APP_PATH="${DERIVED}/Build/Products/${XC_CONFIG}/SmartCrab.app"
echo "[e2e] built: ${APP_PATH}"
