# PhoneDeck 0.2.6

Inline trackpad movement fix.

## Fixes

- **Inline trackpad now moves the cursor.** Touch-down was publishing pointer
  options and toggling the pager lock, which recomposed the deck/pager during the
  gesture; the full-screen pad did neither, which is why only inline lost movement
  frames. The inline tile now uses local options and relies on its own Initial-pass
  gesture consumption.
- Removed the temporary `M ±dx ±dy` debug readout from the inline pad.
- The desktop pointer helper keeps the cursor-move verification and relative
  `mouse_event` fallback added in 0.2.5.

## Includes from 0.2.5

- Live volume state (`control-state-v1`): absolute volume sliders/wheels show the
  PC's real level instead of the configured initial, with `LIVE`/`LOCAL` badges.
- Inline/full-screen trackpad modes, rotation-aware pointer input, custom
  background scrim, and the old-app `APP_OUTDATED` notice.

## Upgrade notes

- Windows 0.2.5 can auto-update to 0.2.6.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 12. Install over 0.2.5 (same debug key).
- Windows elevated windows (UIPI) remain unreachable. Linux uses X11; Wayland is
  not supported.
