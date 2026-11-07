# PhoneDeck 0.2.0

A large feature release across the desktop editor, Android deck and update pipeline.

## Highlights

- **Per-page grids** — every page can have its own columns/rows/gap/padding, with profile
  defaults and safe resize/clear behavior.
- **Animated media** — GIF/video page and button backgrounds, plus animated GIF/video
  button icons on desktop and Android.
- **Continuous controls** — volume slider/wheel and scroll wheel/dial tiles, span-aware
  layout, haptics, pager lock, and absolute volume on macOS/Windows (Linux via `pactl`).
- **Portable backups** — save the desktop backup ZIP to the phone via SAF, then send it
  directly to another paired PC; the target PC shows an approval dialog and keeps a
  pre-import backup.
- **First-run Android guide** — explains the desktop app, same Wi-Fi, pairing and the deck
  before the user sees the pairing form. Reopen it from Settings/Pairing.
- **Android brightness control** — per-phone slider in desktop Settings using a transient
  window brightness override (no new permissions).
- **OS-aware shortcuts** — Cmd/Option labels on macOS, Win/Alt elsewhere; platform-specific
  preset filtering; macOS starter-deck migration.
- **Expanded presets** — Chrome, OBS, VS Code, JetBrains/Android Studio, OpenCode,
  World of Warcraft, Guild Wars 2, System and Media.
- **macOS screenshots** — silent full-screen capture to a configurable folder, with a
  native notification and phone result message.
- **Desktop polish** — tray/close-to-tray, custom confirmations, unified Android-matching
  icon, draggable spanning controls, 1×1 fallback, and control test buttons.
- **Update policy** — Windows auto-updates continue; macOS auto-update is enabled only for
  packaged Developer ID-signed builds; unsigned builds show the manual-download message.

## Install notes

- **Windows:** run the NSIS installer. 0.1.4 users can update in-app; older versions need
  one manual install.
- **macOS:** install the DMG or replace the app with the ZIP. The 0.1.4 unsigned Mac build
  cannot auto-update, so install 0.2.0 manually once. Signed builds can update in-app.
- **Android:** install the debug APK (versionCode 6). If upgrading, install over the
  existing app; pairing/config is preserved. Sliders/dials and absolute volume require this
  build.

## Known limitations

- Absolute volume on Windows depends on the PowerShell Core Audio helper and a working
  default audio endpoint; relative volume remains available as a fallback.
- Android controls/brightness/video were validated by compilation and unit tests; test on
  a real device for OEM-specific gesture, brightness and decoder behavior.
- Offline media is best-effort: config JSON is cached, images use Coil’s cache, video
  requires the desktop to be reachable.
- macOS captures may require Screen Recording/Files & Folders permission depending on the
  chosen folder.
