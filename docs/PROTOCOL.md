# PhoneDeck protocol (v1)

PhoneDeck has two apps:

- **Desktop** (Electron, Windows-first): owns the configuration and executes actions.
- **Android**: renders the deck, sends button presses, and handles page navigation locally.

All traffic is LAN-only. The desktop listens on a TCP port (default `47654`) and
sends UDP discovery beacons on port `47655`.

## Pairing

The desktop generates a random token once (Settings → Rotate token invalidates
old phones). It shows a QR code containing:

```
phonedek://pair?host=192.168.1.42&port=47654&token=<token>&name=My%20PC&v=1
```

Android registers an intent filter for `phonedek://pair`, so scanning the QR with
the system camera opens the app and connects. Manual entry is also supported.

Every HTTP request and the WebSocket handshake must include the token:

- HTTP: `Authorization: Bearer <token>` (or `?token=<token>` for image loading)
- WebSocket: `/ws?token=<token>`

## HTTP

| Method | Path            | Auth | Description |
| ------ | --------------- | ---- | ----------- |
| GET    | `/api/info`     | no   | `{ app, protocol, serverName, version }` |
| GET    | `/api/config`   | yes  | Full `DeckConfig` JSON. Supports `If-None-Match` → `304`. |
| GET    | `/assets/<file>`| yes  | Background images. `Content-Type` inferred from extension. |
| POST   | `/api/press`    | yes  | Optional HTTP fallback for button presses (same body as WS `press`). |

The phone may cache the last config and render offline; presses are only
executed while the WebSocket is connected.

## WebSocket

Endpoint: `ws://<host>:<port>/ws?token=<token>`.

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

Discovery leaks only the server name and port, never the pairing token.

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
- `background` precedence: button background → page background → profile theme.
- `image` backgrounds reference a file served at `/assets/<asset>` with the
  token attached. `overlay` is a black scrim in `0..1`.
- Colors are `#RGB`, `#RRGGBB` or `#RRGGBBAA`; `angle` is CSS degrees.
- `fontSize` and `buttonRadius` are density-independent (dp).
- `actions` execute in order. Supported action types:
  `hotkey`, `text`, `macro`, `launch`, `url`, `command`, `media`, `delay`,
  `page`. Macro steps are `hotkey`, `text`, `delay`, `media`, `mouse`.

Android only needs to execute `page` actions locally; everything else is the
desktop's job.
