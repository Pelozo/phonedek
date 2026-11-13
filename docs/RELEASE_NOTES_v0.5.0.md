# PhoneDeck 0.5.0

Twitch and local stream lights.

## Twitch Helix

- **Settings → Twitch**: enable, enter the public Client ID from your Twitch
  developer app, then Connect. PhoneDeck uses Device Code Flow (no client
  secret) and shows the code plus the activation URL; tokens are encrypted with
  the OS secret store and rotate automatically. Nothing is sent to the phone.
- **Add action → Integrations → Twitch**: send chat, create a stream marker,
  set the stream title or game/category (lengths 500/140/140/100).
- **Status tiles**: Live, Viewers, Uptime, Title, Game. The phone shows
  `LIVE`/`OFF`, viewer counts, uptime, title/category, and quietly shows
  `NO TWITCH`/`TWITCH OFF` when unavailable.
- Scopes: `channel:manage:broadcast` and `user:write:chat`. Chat sending is
  rate-limited/spaced; a missing category is rejected by Twitch at press time.
- `twitch-v1` is advertised only while authorized/connected.

## Elgato Key Light (local)

- **Settings → Lights**: enable and manage up to 8 Elgato Key Light devices by
  name/host/port (default 9123), with a reachability test showing `ON`/`OFF`,
  brightness, mired and Kelvin.
- **Add control → Lighting**: brightness (0–100%) and temperature
  (143–344 mired, with Kelvin hints) sliders, plus power actions
  (`Set power`/`Toggle power`).
- **Status tiles**: power, brightness and temperature; unavailable devices show
  `NO LIGHT` or `OFFLINE` without deck toasts.
- Local HTTP only (`http://host:9123/elgato/lights`), no cloud account; Hue and
  Nanoleaf are future adapters. `light-v1` is advertised when lights are
  configured.

## Includes from 0.4.0

- Shortcut wheels, exact value entry, OBS phase 2 (scenes/outputs/sources/
  markers/status).
- OBS input volume/mute, microphone gain/mute, live volume state, inline
  trackpad, pointer master switch, component copy/move and direct Windows
  screenshots.

## Upgrade notes

- Windows 0.4.0 can auto-update to 0.5.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 18. Install over 0.4.0 (same debug key).
- Twitch: create an app at dev.twitch.tv, copy its Client ID into Settings.
- Lights: the PC and Key Light must share the LAN; the light's IP must be
  reachable on port 9123.
