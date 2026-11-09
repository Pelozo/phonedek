# PhoneDeck 0.2.7

Direct Windows screenshots and a cleaner volume readout.

## Fixes

- **Windows screenshot buttons now capture directly.** A `Win + Shift + S`
  action (including buttons imported from a macOS profile, where it is
  `Cmd + Shift + S`) is treated as a screenshot intent and saves a full-desktop
  PNG to the configured screenshot folder instead of opening the Snipping Tool.
  The capture is DPI-aware and covers every monitor; no external tool is required.
- macOS keeps the silent `screencapture` path.
- The volume control no longer shows a `LIVE` label; the value itself is the
  state. `LOCAL` is still shown only when the desktop cannot report volume.

## Includes from 0.2.6

- Inline trackpad movement fix (no deck recomposition on touch-down).
- Live volume readback (`control-state-v1`), inline/full-screen trackpad modes,
  rotation-aware pointer input, and the Windows pointer move fallback.

## Upgrade notes

- Windows 0.2.6 can auto-update to 0.2.7.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 13. Install over 0.2.6 (same debug key).
