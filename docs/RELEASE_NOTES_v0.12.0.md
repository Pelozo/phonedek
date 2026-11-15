# PhoneDeck 0.12.0

Modifier scroll, horizontal scroll, zoom.

## Scroll controls

- **Horizontal scroll** wheel (2×1) for apps with horizontal panes.
- **Zoom wheel** — vertical scroll with **Ctrl** held, for Chrome/Figma/
  Photoshop-style zoom.
- **Shift + horizontal** for apps that map Shift+wheel to horizontal scrolling.
- The inspector adds Ctrl/Shift/Alt/Win checkboxes to any scroll wheel, with a
  `ZOOM` / `SCROLL H` / `SCROLL` badge and a summary.
- Each step is one ordered macro: modifier **down → mouse wheel → modifier up**.
  If the wheel dispatch fails, the executor releases any modifiers it pressed,
  so Ctrl/Shift cannot stick.
- Direction, invert, amount and the 1–100 notch cap are unchanged. Old scroll
  controls and configs remain valid.

## Includes from 0.11.0

- Philips Hue and Nanoleaf lights with encrypted credentials, pairing/token
  flows and live status.
- Trackpad two-finger scroll inertia.
- Full-screen per-app mixer.
- Categorized Settings, OBS replay toggle/save split and input seeding.
- Auto-profile, media scrub, phone keyboard, Twitch, Elgato lights, shortcut
  wheels, exact value entry, OBS phase 2, mic/app/OBS audio, live volume state,
  inline trackpad, component copy/move, direct Windows screenshots and the
  pointer master switch.

## Upgrade notes

- Windows 0.11.0 can auto-update to 0.12.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 27. Install over 0.11.0 (same debug key).
