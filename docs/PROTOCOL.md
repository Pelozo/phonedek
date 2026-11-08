# PhoneDeck protocol (v1)

PhoneDeck has two apps:

- **Desktop** (Electron, Windows-first): owns the configuration and executes actions.
- **Android**: renders the deck, sends button presses, and handles page navigation locally.

All traffic is LAN-only. The desktop listens on a TCP port (default `47654`) and
sends UDP discovery beacons on port `47655`.

## Pairing

The desktop generates a random **4-digit PIN** once (Pair phone → New PIN invalidates
old phones). It shows a QR code containing:

```
phonedek://pair?host=192.168.1.42&port=47654&token=4821&name=My%20PC&v=1
```

Android registers an intent filter for `phonedek://pair`, so scanning the QR with
the system camera opens the app and connects. Manual entry is also supported.

The PIN travels in the `token` parameter/header (the name is kept for protocol
compatibility). Every HTTP request and the WebSocket handshake must include it:

- HTTP: `Authorization: Bearer <pin>` (or `?token=<pin>` for image loading)
- WebSocket: `/ws?token=<pin>`

The desktop answers `401` for a wrong PIN. After 6 failures from one address within a
minute it answers `429` with `Retry-After: 60`.

## HTTP

| Method | Path            | Auth | Description |
| ------ | --------------- | ---- | ----------- |
| GET    | `/api/info`     | no   | `{ app, protocol, serverName, version, capabilities }` |
| GET    | `/api/config`   | yes  | Full `DeckConfig` JSON. Supports `If-None-Match` → `304`. |
| GET    | `/assets/<file>`| yes  | Background images/videos. `Content-Type` inferred from extension; byte ranges supported. |
| GET/HEAD | `/api/backup` | yes  | Full PhoneDeck backup ZIP (`phonedek-config.json` + `assets/`). Byte ranges supported. |
| POST   | `/api/import`   | yes  | Stream a backup ZIP (≤300 MB) for validation and native approval; returns the preview. |
| POST   | `/api/press`    | yes  | Optional HTTP fallback for button presses (same body as WS `press`). |

`/api/info` currently advertises `capabilities: ["backup-export-v1", "import-v1",
"input-v1", "brightness-v1"]`. A desktop that supports trackpad/pointer control
additionally advertises `pointer-v1`. Clients must treat the array as optional and
only show a feature when its marker is present. `/api/backup` responds with
`Content-Type: application/zip`,
`Content-Disposition: attachment; filename="phonedek-backup-YYYYMMDD-HHMMSS.zip"`,
`Content-Length`, and `Cache-Control: no-store`.

`POST /api/import` streams the request body to a temp file, validates the same
ZIP format as export, and calls a native desktop approval dialog. Success is
`200 { ok:true, preview }` with `serverName`, profile/page/button counts, asset
count/bytes, warnings, and `dangerousActions` (`launch` + `command` actions).
Other statuses: `400` invalid ZIP/config, `409` another import is awaiting
approval, `413` over 300 MB, `500` rejected or failed apply.

The phone may cache the last config and render offline; presses are only
executed while the WebSocket is connected.

## WebSocket

Endpoint: `ws://<host>:<port>/ws?token=<pin>`.

The server sends `hello` immediately after the connection is accepted:

```json
{
  "type": "hello",
  "protocol": 1,
  "serverName": "PhoneDeck",
  "serverTime": 1762400000000,
  "config": { "schemaVersion": 1, "...": "..." }
}
```

The client answers with its device info (used in the desktop's connected-device
list):

```json
{ "type": "hello", "protocol": 1, "device": { "name": "Pixel 8", "model": "Google Pixel 8", "appVersion": "0.1.0" } }
```

When the desktop config changes, every client receives:

```json
{ "type": "config", "config": { "schemaVersion": 1, "...": "..." } }
```

A press is sent with a client-generated request id:

```json
{ "type": "press", "requestId": "r-123", "profileId": "profile-desktop", "pageId": "page-main", "buttonId": "btn-copy" }
```

The desktop answers:

```json
{ "type": "pressResult", "requestId": "r-123", "buttonId": "btn-copy", "ok": true }
```

Errors include `ok: false` and an `error` string. The server may also send
`{ "type": "error", "code": "...", "message": "..." }`.

Ping/pong keeps idle NATs alive: client sends `{ "type": "ping", "t": 123 }`,
server replies `{ "type": "pong", "t": 123 }`.

### Page actions

`page` actions (`next`, `prev`, `goto`) are handled by the Android app locally so
navigation is instant and works even on a slow link. A button that mixes page
actions with other actions still sends a `press` to execute the rest. The
desktop ignores `page` actions when executing.

### Pointer / trackpad (`pointer-v1`)

Trackpad cursor control uses its own `pointer` message and `pointer-v1`
capability; `input-v1` is unchanged. A `trackpad` control opens the full-screen
pad on the phone and never synthesises an `Action`.

```jsonc
// Start binds the gesture to a trackpad control.
{ "type":"pointer", "seq":41, "phase":"start",
  "profileId":"p1", "pageId":"pg1", "controlId":"btn-pad" }

// Relative move; dx/dy are fractions of the pad height (+right/+down).
{ "type":"pointer", "seq":42, "phase":"move", "dx":0.012, "dy":-0.004 }

// Two-finger scroll in notches (+up/+right).
{ "type":"pointer", "seq":43, "phase":"move", "scrollX":0.0, "scrollY":0.75 }

// Ordered button transitions may ride with movement.
{ "type":"pointer", "seq":44, "phase":"move", "dx":0.01, "dy":0.02,
  "buttons":[{"button":"left","action":"down"}] }

// End does NOT imply a button release.
{ "type":"pointer", "seq":45, "phase":"end",
  "buttons":[{"button":"left","action":"up"}] }

// Abort; the desktop releases every held button.
{ "type":"pointer", "seq":46, "phase":"cancel" }
```

Rules:

- `seq` is a per-connection monotonic integer; the desktop ignores stale or
  duplicate values. `phase` is `start | move | end | cancel`.
- `dx`/`dy` are finite and clamped to ±2 pad heights per message.
  `scrollX`/`scrollY` are finite and clamped to ±10 notches per message.
- `buttons` holds at most 4 ordered entries; `button` is
  `left | right | middle`, `action` is `down | up | click | doubleclick`.
  `click` expands to down+up atomically on the desktop.
- Only `start` carries `profileId`, `pageId` and `controlId`; `cancel` carries
  nothing else. `move`/`end` may carry movement, scroll and buttons.
- The desktop sends `{ "type":"pointerResult", "seq":45, "ok":true }` once on
  `end`/`cancel` and errors immediately on a rejected `start`. Moves are not
  acked.
- `cancel`, WebSocket close and a new phone taking over release all held
  buttons. Platforms without global pointer injection (e.g. Wayland) do not
  advertise `pointer-v1` and reject `start` with a clear error.

## Discovery

The desktop broadcasts this JSON to UDP port `47655` every ~2.5 seconds (and
also replies to unicast probes):

```json
{ "magic": "PHONEDECK", "protocol": 1, "type": "beacon", "name": "PhoneDeck", "port": 47654, "version": "0.1.0" }
```

Android may broadcast a probe:

```json
{ "magic": "PHONEDECK", "protocol": 1, "type": "discover" }
```

Discovery leaks only the server name and port, never the pairing PIN.

## Config model

The TypeScript source of truth is
[`packages/shared/src/types.ts`](../packages/shared/src/types.ts) and the runtime
validator is [`packages/shared/src/schema.ts`](../packages/shared/src/schema.ts).

```jsonc
{
  "schemaVersion": 1,
  "updatedAt": "2026-11-06T20:00:00.000Z",
  "serverName": "PhoneDeck",
  "defaultProfileId": "profile-desktop",
  "profiles": [{
    "id": "profile-desktop",
    "name": "My PC",
    "grid": { "columns": 5, "rows": 3, "gap": 12, "padding": 14 },
    "theme": {
      "background": { "type": "gradient", "from": "#080d19", "to": "#111c33", "angle": 160 },
      "buttonBackground": { "type": "gradient", "from": "#1e293b", "to": "#334155", "angle": 145 },
      "textColor": "#f8fafc",
      "accentColor": "#34d399",
      "fontSize": 15,
      "buttonRadius": 18
    },
    "pages": [{
      "id": "page-main",
      "name": "Main",
      "buttons": [{
        "id": "btn-copy",
        "slot": 10,
        "label": "Copy",
        "sublabel": "Ctrl + C",
        "icon": "📋",
        "background": { "type": "gradient", "from": "#065f46", "to": "#059669", "angle": 145 },
        "actions": [{ "type": "hotkey", "keys": ["CTRL", "C"] }]
      }]
    }],
    "defaultPageId": "page-main"
  }]
}
```

Notes for the Android renderer:

- A page has at most `columns * rows` buttons. `slot` is `0..capacity-1`
  (row-major). Missing slots are empty.
- Deck background: `page.background` → `profile.theme.background`. Button background: `button.background` → `profile.theme.buttonBackground` (a page background is the deck, not the buttons).
- `image` backgrounds reference a file served at `/assets/<asset>` with the
  token attached. `overlay` is a black scrim in `0..1`.
- Colors are `#RGB`, `#RRGGBB` or `#RRGGBBAA`; `angle` is CSS degrees.
- `fontSize` and `buttonRadius` are density-independent (dp).
- `actions` execute in order. Supported action types:
  `hotkey`, `text`, `macro`, `launch`, `url`, `command`, `media`, `delay`,
  `page`. Macro steps are `hotkey`, `text`, `delay`, `media`, `mouse`.

Android only needs to execute `page` actions locally; everything else is the
desktop's job.
