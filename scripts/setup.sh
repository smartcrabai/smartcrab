#!/usr/bin/env bash
# SmartCrab development environment setup
# - Installs Bun if missing
# - Hints macOS Xcode Command Line Tools install for SwiftUI builds

set -euo pipefail

log() {
  printf '[setup] %s\n' "$*"
}

err() {
  printf '[setup][error] %s\n' "$*" >&2
}

ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    log "Bun already installed: $(bun --version)"
    return 0
  fi

  log "Bun not found — installing via https://bun.sh/install"
  if ! command -v curl >/dev/null 2>&1; then
    err "curl is required to install Bun. Please install curl and re-run."
    return 1
  fi

  curl -fsSL https://bun.sh/install | bash

  # Common install location: ~/.bun/bin
  local bun_bin="${HOME}/.bun/bin"
  if [ -x "${bun_bin}/bun" ]; then
    log "Bun installed at ${bun_bin}/bun"
    log "Add this to your shell profile if not already present:"
    log "  export PATH=\"${bun_bin}:\$PATH\""
  else
    err "Bun install completed, but binary not found at ${bun_bin}/bun"
    return 1
  fi
}

hint_xcode_clt() {
  case "$(uname -s)" in
    Darwin)
      if xcode-select -p >/dev/null 2>&1; then
        log "Xcode Command Line Tools detected at: $(xcode-select -p)"
      else
        log "Xcode Command Line Tools not detected."
        log "To build the SwiftUI macOS app, install them with:"
        log "  xcode-select --install"
      fi
      ;;
    *)
      log "Non-macOS host detected — SwiftUI build requires macOS + Xcode CLT."
      ;;
  esac
}

main() {
  ensure_bun
  hint_xcode_clt
  log "Setup complete."
}

main "$@"
