# Releasing SmartCrab to macOS

The release pipeline (`.github/workflows/build-macos.yml`) builds a code-signed,
notarized `.dmg` for macOS arm64 and x86_64 when a `v*` tag is pushed.

## Required GitHub Actions secrets

Configure these on the repo (`Settings → Secrets and variables → Actions`).

| Secret | What it is | Where to get it |
|---|---|---|
| `APPLE_CERT_P12` | Base64-encoded `.p12` Developer ID Application certificate | Export from Keychain (see below), then `base64 -i Cert.p12 \| pbcopy` |
| `APPLE_CERT_PASSWORD` | Password used when exporting the `.p12` | Whatever you typed during the export |
| `APPLE_TEAM_ID` | 10-character team identifier (e.g. `ABCDE12345`) | Apple Developer → Membership |
| `APPLE_ID` | Apple ID email used for notarization | Your Apple Developer account email |
| `APPLE_NOTARY_PASSWORD` | App-specific password for `notarytool` | Generate at https://appleid.apple.com → Sign-In and Security → App-Specific Passwords |

## Generating the `.p12` certificate

1. In **Keychain Access** on a Mac with Apple Developer access, choose
   **Certificate Assistant → Request a Certificate from a Certificate Authority…**
2. Upload the resulting CSR at https://developer.apple.com/account/resources/certificates and
   choose **Developer ID Application**.
3. Download the issued certificate and double-click to import it into the
   login keychain. Make sure the private key is paired (expand the cert in
   Keychain Access — you should see the key under it).
4. Right-click the cert → **Export "Developer ID Application: …"…**, choose
   **.p12**, set a password (keep this — that's `APPLE_CERT_PASSWORD`).
5. `base64 -i Cert.p12 | pbcopy`, paste into the `APPLE_CERT_P12` secret value.

## Triggering a release

```sh
git tag v0.2.0
git push origin v0.2.0
```

The workflow runs `xcodebuild archive` + `-exportArchive`, then `notarytool`
+ `stapler`, wraps the result in a DMG via `create-dmg`, and attaches the
DMG to the GitHub Release for the matching tag. The `workflow_dispatch`
trigger lets you fire a build manually for testing without cutting a tag.

## Verifying a built DMG

After a release lands, on a clean Mac:

```sh
hdiutil attach SmartCrab-*.dmg
codesign --verify --deep --strict /Volumes/SmartCrab/SmartCrab.app
spctl --assess --type execute /Volumes/SmartCrab/SmartCrab.app   # → "accepted"
```

The first launch shows Gatekeeper's "Apple verified the app" notice if the
Apple ID + Notary Password were valid.

## Quick local DMG (no notarization)

For a faster local sanity check that doesn't need any Apple secrets:

```sh
./scripts/e2e/build-app.sh release
hdiutil create -volname SmartCrab -srcfolder \
  .build/dd-mac/Build/Products/Release/SmartCrab.app \
  -format UDZO -ov /tmp/SmartCrab-local.dmg
```

The resulting DMG is ad-hoc signed only — Gatekeeper will warn the first
time the user opens it. Use it for smoke checks; ship the CI artifact for
real distribution.
