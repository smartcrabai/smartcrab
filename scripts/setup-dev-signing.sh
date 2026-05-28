#!/usr/bin/env bash
# Create a stable, self-signed code-signing identity for local development so
# macOS stops re-prompting for Keychain access on every rebuild.
#
# Why: dev builds are ad-hoc signed, which gives the app a different code
# identity (cdhash) on every rebuild. The Keychain ACL that guards stored
# secrets (e.g. the Discord bot token in KeychainStore) is keyed to that
# identity, so each rebuild looks like a brand-new app and triggers a password
# prompt. A self-signed certificate keeps the identity constant across
# rebuilds: you grant access once ("Always Allow") and never see it again.
#
# Nothing here touches the repo — the certificate lives only in your login
# keychain, and scripts/e2e/build-app.sh picks it up automatically by name.
set -euo pipefail

CERT_NAME="SmartCrab Development"

# Already a valid (trusted) code-signing identity? Use the same check
# build-app.sh uses (`find-identity -p codesigning -v`) so "set up" means the
# same thing in both places.
if security find-identity -p codesigning -v 2>/dev/null | grep -Fq "${CERT_NAME}"; then
  echo "✅ Code-signing identity '${CERT_NAME}' is already set up and trusted."
  echo "   build-app.sh will sign Debug builds with it."
  exit 0
fi

# Certificate exists but is not yet a valid signing identity — almost always
# because the manual "Code Signing → Always Trust" step is still pending.
# Re-creating it would not help, so guide the user to finish trusting it.
if security find-certificate -c "${CERT_NAME}" >/dev/null 2>&1; then
  echo "⚠️  Certificate '${CERT_NAME}' exists but is not trusted for code signing yet."
  echo ""
  echo "    Finish the one manual step:"
  echo "      1. Open Keychain Access.app"
  echo "      2. Select the 'login' keychain and find '${CERT_NAME}'"
  echo "      3. Double-click it → expand the 'Trust' section"
  echo "      4. Set 'Code Signing' to 'Always Trust'"
  echo "      5. Close the window (enter your login password when prompted)"
  echo ""
  echo "    Then rebuild: ./scripts/e2e/build-app.sh debug"
  exit 0
fi

echo "🔐 Creating self-signed code-signing certificate '${CERT_NAME}'..."

WORK_DIR="$(mktemp -d)"
# Cover INT/TERM too: without them a Ctrl-C would leave the passphrase-less
# private key (dev.key) and dev.p12 behind in the temp dir.
trap 'rm -rf "${WORK_DIR}"' EXIT INT TERM

cat >"${WORK_DIR}/cert.cnf" <<EOF
[ req ]
distinguished_name = dn
x509_extensions    = v3
prompt             = no

[ dn ]
CN = ${CERT_NAME}
O  = SmartCrab Development
C  = US

[ v3 ]
keyUsage         = critical,digitalSignature
extendedKeyUsage = codeSigning
EOF

# Apple's bundled OpenSSL (LibreSSL). A Homebrew OpenSSL earlier on PATH can
# emit a p12 that `security import` then refuses.
OPENSSL=/usr/bin/openssl

"${OPENSSL}" req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
  -keyout "${WORK_DIR}/dev.key" -out "${WORK_DIR}/dev.crt" \
  -config "${WORK_DIR}/cert.cnf" 2>/dev/null

# Transient passphrase for the intermediate p12. macOS `security import` fails
# the MAC check on a *passwordless* LibreSSL p12 ("MAC verification failed"),
# so we use a random one. It never leaves this script — the p12 is created and
# imported here, then the temp dir is wiped on exit.
P12_PASS="$("${OPENSSL}" rand -hex 16)"

"${OPENSSL}" pkcs12 -export -out "${WORK_DIR}/dev.p12" \
  -inkey "${WORK_DIR}/dev.key" -in "${WORK_DIR}/dev.crt" \
  -passout "pass:${P12_PASS}" 2>/dev/null

# -P passes the p12 passphrase so macOS does not show a GUI prompt for it.
# -T /usr/bin/codesign lets codesign use the private key without prompting
# (codesign alone is enough; no need to also grant /usr/bin/security).
security import "${WORK_DIR}/dev.p12" -P "${P12_PASS}" \
  -k "${HOME}/Library/Keychains/login.keychain-db" \
  -T /usr/bin/codesign

cat <<EOF

✅ Certificate '${CERT_NAME}' imported into your login keychain.

⚠️  One manual step is required — macOS only treats it as a valid signing
    identity once you trust it for code signing:

      1. Open Keychain Access.app
      2. Select the 'login' keychain and find '${CERT_NAME}'
      3. Double-click it → expand the 'Trust' section
      4. Set 'Code Signing' to 'Always Trust'
      5. Close the window (enter your login password when prompted)

Then rebuild:

      ./scripts/e2e/build-app.sh debug

build-app.sh detects '${CERT_NAME}' automatically (no env vars, no repo
changes) and signs with it. The first launch after switching may still show
one Keychain prompt for the pre-existing secret — click 'Always Allow' once
and you are done.
EOF
