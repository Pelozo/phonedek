# PhoneDeck 0.22.1

Patch release for video playback memory and release verification.

## Android video players

- Adjacent preloaded pager pages no longer create or retain ExoPlayer/decoder
  instances when they cannot play. Their fallback background stays visible.
- The player is created when the pager settles on a page and released when it
  leaves. This bounds decoder use to the active page.
- No visual change is expected on the active page.

## Release tooling

- Added `scripts/verify-release.sh` to verify a published tag's
  `SHA256SUMS`, update feeds and APK manifest version. Use the `apk` mode for a
  quick check.

## Includes from 0.22.0

- macOS CoreAudio audio-device switching.
- Windows/Linux audio-device switching and the held-key shortcut fix.

## Manual QA still required

- Android: swipe through pages with video backgrounds/icons on a physical
  device; confirm settled-page playback, fallback on adjacent pages and no
  decoder errors after several page turns.
- macOS/Linux/Windows audio devices as documented in 0.22.0.
- Windows/macOS macro hooks and the Android Quick Settings tile.

## Upgrade notes

- Windows/macOS 0.22.x can auto-update.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android installs over 0.22.0 (same debug key), versionCode 44.
