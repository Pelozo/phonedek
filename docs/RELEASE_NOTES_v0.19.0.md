# PhoneDeck 0.19.0

An Android Quick Settings tile for running one deck button from anywhere.

## Quick Settings tile

- **Settings → Quick Settings** picks one cached deck button (profile › page ›
  button), including rig buttons. It works offline from the last cached config.
- Add the **PhoneDeck button** tile from the Quick Settings editor. Tap it to
  press the chosen button; the tile shows “Pressing…”, then the result.
- The tile uses the saved pairing token and the existing desktop
  `POST /api/press` endpoint with `Authorization: Bearer …`; no new desktop
  protocol or setting is required.
- A locked phone asks to unlock before running. Rapid double taps are ignored
  for 1 second.
- Missing pairing, no favorite, a stale/missing button, a rejected PIN, rate
  limiting and an unreachable PC all show a clear tile/toast state and open the
  app/Settings when the user needs to fix something.
- Only buttons that can run on the host are offered: normal actions and rigs.
  Phone-local keyboard/mixer launchers, page navigation, empty buttons and
  continuous controls are excluded because HTTP press cannot operate them.
- No WebSocket is held; each tile press is a short bounded HTTP call. Tokens
  are never logged.

## Includes from 0.18.0

- Cross-platform macro capture (Windows/macOS/Linux X11) with mouse recording,
  global stop hotkey and focused fallback.
- Older-desktop export, rigs, automation rules, Streamer.bot, live keyboard,
  scroll wheels and What’s New.

## Manual QA still required

Add the tile on a real device and verify: choosing/clearing a favorite, locked
unlock-then-run, double-tap debounce, missing favorite/pairing, stale button,
offline PC, denied PIN, rate limit, and a rig tile. No Android emulator is
available in this environment.

## Upgrade notes

- Windows 0.18.x can auto-update to 0.19.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 38. Install over 0.18.0 (same debug key).
