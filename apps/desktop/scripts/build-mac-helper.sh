#!/usr/bin/env bash
# Build the PhoneDeck macOS input helper with the system Swift toolchain.
#
# Usage:
#   scripts/build-mac-helper.sh            # native arm64 (default on Apple Silicon CI)
#   scripts/build-mac-helper.sh arm64
#   scripts/build-mac-helper.sh universal  # arm64 + x86_64, joined with lipo
#
# The output is resources/mac/keyboard-helper. It is intentionally not
# committed: CI (or a developer on macOS) builds it before packaging.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/resources/mac/keyboard-helper.swift"
OUTPUT="$ROOT/resources/mac/keyboard-helper"
TARGET="${1:-${MAC_HELPER_ARCH:-arm64}}"
MIN_MACOS="${MAC_HELPER_MIN_MACOS:-12.0}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: the macOS keyboard helper can only be built on macOS (found $(uname -s))." >&2
  echo "       Build it on an Apple Silicon Mac or let the GitHub Actions 'macos' job do it." >&2
  exit 1
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "error: swiftc was not found. Install the Xcode command line tools (xcode-select --install)." >&2
  exit 1
fi

if [[ ! -f "$SOURCE" ]]; then
  echo "error: helper source not found at $SOURCE" >&2
  exit 1
fi

build_arch() {
  local arch="$1"
  local destination="$2"
  echo "Compiling keyboard-helper for ${arch} (macOS ${MIN_MACOS}+)…"
  swiftc \
    -O \
    -whole-module-optimization \
    -target "${arch}-apple-macos${MIN_MACOS}" \
    -o "$destination" \
    "$SOURCE"
}

case "$TARGET" in
  arm64|x86_64)
    build_arch "$TARGET" "$OUTPUT"
    ;;
  universal)
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    build_arch arm64 "$TMP_DIR/keyboard-helper-arm64"
    build_arch x86_64 "$TMP_DIR/keyboard-helper-x86_64"
    echo "Creating universal binary with lipo…"
    lipo -create \
      -output "$OUTPUT" \
      "$TMP_DIR/keyboard-helper-arm64" \
      "$TMP_DIR/keyboard-helper-x86_64"
    ;;
  *)
    echo "error: unknown architecture '$TARGET' (use arm64, x86_64 or universal)." >&2
    exit 1
    ;;
esac

chmod +x "$OUTPUT"
echo "Built $OUTPUT"
file "$OUTPUT"
