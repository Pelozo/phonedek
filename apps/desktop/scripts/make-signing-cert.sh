#!/usr/bin/env bash
# Create (or repair) a local self-signed code-signing identity for PhoneDeck.
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

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if security find-identity -v -p codesigning | grep -qF "\"$NAME\""; then
  echo "Signing identity already exists: $NAME"
else
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
  echo "Created: $NAME"
fi

# The imported private key is guarded by a keychain ACL. codesign runs
# non-interactively, so without an "always allow" partition list it reports
# "no identity found". Authorize it once here.
KEYCHAIN_PASS=""
if [[ -t 0 ]]; then
  read -rsp "macOS login password (authorizes codesign to use the key; blank to skip): " KEYCHAIN_PASS
  echo
fi

if [[ -n "$KEYCHAIN_PASS" ]]; then
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASS" "$KEYCHAIN" >/dev/null
  echo "Authorized codesign to access the private key."
else
  echo "Skipped key authorization. If the build says 'no identity found', re-run this and enter the password." >&2
fi
unset KEYCHAIN_PASS

# Prove that codesign can actually use the identity before a full build.
TEST_BINARY="$TMP/probe"
cp /bin/ls "$TEST_BINARY"
if codesign --force --sign "$NAME" "$TEST_BINARY" >/dev/null 2>"$TMP/sign.err"; then
  echo "Verified: codesign can use $NAME."
else
  echo "warning: codesign still cannot use the identity:" >&2
  sed 's/^/  /' "$TMP/sign.err" >&2
  echo "         Open Keychain Access → $NAME → expand the key → Access Control →" >&2
  echo "         'Allow all applications to access this item' → Save." >&2
  exit 1
fi

echo
echo "Rebuild with: npm run dist:mac -w @phonedek/desktop"
echo "after-pack.cjs will pick it up automatically."
