#!/usr/bin/env bash
# Verify a published PhoneDeck release without opening the browser.
#
# Usage:
#   scripts/verify-release.sh v0.22.0            # download and check every asset
#   scripts/verify-release.sh v0.22.0 apk        # only the APK and update feeds
#   ASSETS_DIR=/tmp/phonedek-release \
#     scripts/verify-release.sh v0.22.0 apk      # reuse downloaded files
#
# Checks:
#   - SHA256SUMS covers every downloaded asset and matches;
#   - the APK manifest versionName matches the tag;
#   - latest.yml / latest-mac.yml point at the same version.
#
# Requires curl and sha256sum (shasum on macOS). APK inspection additionally
# uses `aapt2` from PATH or $AAPT2; it is skipped with a warning if unavailable.
set -euo pipefail

REPO="${REPO:-Pelozo/phonedek}"
TAG="${1:-}"
MODE="${2:-full}"
if [[ -z "$TAG" || ( "$MODE" != "full" && "$MODE" != "apk" ) ]]; then
  echo "usage: $0 <tag> [full|apk]" >&2
  exit 2
fi
VERSION="${TAG#v}"
BASE="https://github.com/${REPO}/releases/download/${TAG}"

if [[ -n "${ASSETS_DIR:-}" ]]; then
  DEST="$ASSETS_DIR"
  TEMP=0
else
  DEST="$(mktemp -d -t phonedek-release-XXXXXX)"
  TEMP=1
fi
mkdir -p "$DEST"
cleanup() { if [[ "$TEMP" -eq 1 ]]; then rm -rf "$DEST"; fi; }
trap cleanup EXIT

download() {
  local name="$1"
  if [[ -s "$DEST/$name" ]]; then
    return 0
  fi
  echo "download $name"
  curl -fsSL --retry 2 -m 300 -o "$DEST/$name" "$BASE/$name"
}

echo "PhoneDeck ${VERSION} from ${REPO}"
download SHA256SUMS
download latest.yml
download latest-mac.yml

if [[ "$MODE" == "full" ]]; then
  while read -r _hash path; do
    [[ -z "${path:-}" ]] && continue
    download "${path#./}"
  done < "$DEST/SHA256SUMS"
else
  download "PhoneDeck-v${VERSION}.apk"
fi

echo "check SHA-256"
(
  cd "$DEST"
  if command -v sha256sum >/dev/null 2>&1; then
    if [[ "$MODE" == "apk" ]]; then
      expected="$(grep -E "  \\./PhoneDeck-v${VERSION}\\.apk$" SHA256SUMS | awk '{print $1}')"
      actual="$(sha256sum "PhoneDeck-v${VERSION}.apk" | awk '{print $1}')"
      [[ -n "$expected" && "$expected" == "$actual" ]] || {
        echo "APK checksum mismatch (expected ${expected:-missing}, got $actual)" >&2
        exit 1
      }
      echo "PhoneDeck-v${VERSION}.apk: OK"
    else
      sha256sum -c SHA256SUMS
    fi
  else
    if [[ "$MODE" == "apk" ]]; then
      expected="$(grep -E "  \\./PhoneDeck-v${VERSION}\\.apk$" SHA256SUMS | awk '{print $1}')"
      actual="$(shasum -a 256 "PhoneDeck-v${VERSION}.apk" | awk '{print $1}')"
      [[ -n "$expected" && "$expected" == "$actual" ]] || {
        echo "APK checksum mismatch (expected ${expected:-missing}, got $actual)" >&2
        exit 1
      }
      echo "PhoneDeck-v${VERSION}.apk: OK"
    else
      shasum -a 256 -c SHA256SUMS
    fi
  fi
)

echo "check update feeds"
for feed in latest.yml latest-mac.yml; do
  grep -q "^version: ${VERSION}$" "$DEST/$feed" || {
    echo "$feed does not advertise ${VERSION}" >&2
    exit 1
  }
  echo "$feed: ${VERSION}"
done

APK="$DEST/PhoneDeck-v${VERSION}.apk"
AAPT2_BIN="${AAPT2:-}"
if [[ -z "$AAPT2_BIN" ]] && command -v aapt2 >/dev/null 2>&1; then
  AAPT2_BIN="$(command -v aapt2)"
fi
if [[ -z "$AAPT2_BIN" || ! -x "$AAPT2_BIN" ]]; then
  echo "APK manifest: skipped (set AAPT2=/path/to/aapt2)"
  exit 0
fi

manifest="$("$AAPT2_BIN" dump xmltree --file AndroidManifest.xml "$APK")"
name="$(printf '%s\n' "$manifest" | sed -n 's/.*versionName[^=]*="\([^"]*\)".*/\1/p' | head -1)"
code="$(printf '%s\n' "$manifest" | sed -n 's/.*versionCode[^=]*=\([0-9][0-9]*\).*/\1/p' | head -1)"
if [[ "$name" != "$VERSION" ]]; then
  echo "APK versionName ${name:-missing} does not match ${VERSION}" >&2
  exit 1
fi
echo "APK manifest: versionCode ${code:-unknown}, versionName ${name}"
echo "release ${TAG}: OK"
