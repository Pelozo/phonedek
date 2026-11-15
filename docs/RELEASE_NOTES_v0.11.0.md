# PhoneDeck 0.11.0

Philips Hue and Nanoleaf lights.

## Stream lights

- **Settings → Lights** now supports three provider types:
  - **Elgato Key Light** (local HTTP, unchanged).
  - **Philips Hue**: discover a bridge or enter its host, pair with the bridge’s
    **link button**, then pick a light. Uses the bridge’s local CLIP v1 API.
  - **Nanoleaf**: enter the panel IP and its **write-only token** (hold the
    power button to get one). Uses the local OpenAPI.
- The same brightness / temperature / power controls and status tiles work for
  every provider; `ON`/`OFF`/`%`/mired and quiet `OFFLINE`/`NO LIGHT` states.
- Hue/Nanoleaf credentials are stored in the OS-encrypted secret store —
  never in `settings.json`, logs, backups, config or the phone. The renderer
  only sees “credential set”.
- Up to 8 devices total, mixed providers allowed; provider default ports are
  filled automatically (9123 / 443 / 16021).
- Hue brightness maps 0–100% to `bri 1..254`; ct to the bridge’s 153–500 range.
  Nanoleaf brightness 0–100 and ct 1200–6500 K; both convert back for display.
- Writes are latest-wins; reads are cached and shared by every tile watching
  the same light.

## Includes from 0.10.1 / 0.10.0

- Two-finger trackpad scroll inertia.
- Full-screen per-app mixer (channel strips, faders, mute).
- Categorized Settings, OBS replay toggle/save split and input seeding.
- Auto-profile, media scrub, phone keyboard, Twitch, shortcut wheels, exact
  value entry, OBS phase 2, mic/app/OBS audio, live volume state, inline
  trackpad, component copy/move, direct Windows screenshots, pointer master
  switch.

## Upgrade notes

- Windows 0.10.1 can auto-update to 0.11.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 26. Install over 0.10.1 (same debug key).
- Hue pairing requires pressing the physical link button; Nanoleaf requires its
  local API token. Both stay on the LAN.
