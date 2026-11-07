#!/usr/bin/env bash
# Create a local self-signed code-signing identity for PhoneDeck builds.
#
# Why: TCC records ad-hoc signatures by cdhash, so every rebuild invalidates
# the macOS privacy grant. Signed with a stable certificate, TCC records
# "identifier + certificate" instead, which survives rebuilds. Run this once.
#
# The identity stays in your login keychain; nothing is committed to the repo.
set -euo pipefail

NAME="${PHONEDEK_SIGN_NAME:-PhoneDeck Local Signing}"
KEYCHAIN="${PHONEDEK_KEYCHAIN:-$HOME/Library/Keychains/login.keychain-db}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: code-signing identities can only be created on macOS." >&2
  exit 1
fi

if security find-identity -v -p codesigning | grep -qF "\"$NAME\""; then
  echo "Signing identity already exists: $NAME"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# OpenSSL 3 + macOS Security need legacy PKCS#12 algorithms for import.
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" \
  -subj "/CN=$NAME" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"

openssl pkcs12 -export -out "$TMP/identity.p12" \
  -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -passout pass:phonedek

security import "$TMP/identity.p12" -k "$KEYCHAIN" -P phonedek -T /usr/bin/codesign
security add-trusted-cert -d -r trustRoot -p codeSign -k "$KEYCHAIN" "$TMP/cert.pem" || {
  echo "warning: could not mark the certificate trusted for code signing." >&2
  echo "         Open Keychain Access → $NAME → Trust → Code Signing → Always Trust." >&2
}

# Avoid a keychain prompt on every codesign invocation. This may ask for your
# login password once; failure here only means codesign will prompt instead.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "" "$KEYCHAIN" >/dev/null 2>&1 || true

echo
echo "Created: $NAME"
echo "Rebuild with: npm run dist:mac -w @phonedek/desktop"
echo "after-pack.cjs will pick it up automatically."
