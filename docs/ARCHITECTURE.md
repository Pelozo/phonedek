# Architecture

PhoneDeck intentionally keeps the desktop as the single source of truth.

```
Electron main process                         Android app
├─ ConfigStore (config.json)                  ├─ DataStore (host/port/PIN/page)
├─ AssetStore (assets/*)                      ├─ config cache (JSON)
├─ DeckServer (HTTP + WebSocket)  ◄──────────►├─ DeckConnection (OkHttp WS)
├─ DiscoveryService (UDP beacon)  ◄──────────►├─ DiscoveryClient (UDP)
├─ ActionExecutor                             └─ Compose UI
│  ├─ WindowsKeySender → PowerShell helper
│  └─ HostActions → spawn / shell.openExternal
└─ React renderer (editor) via IPC
```

## Configuration flow

1. The renderer edits an in-memory `DeckConfig`.
2. Changes are debounced (320 ms) and sent to the main process via `phonedek:save-config`.
3. `ConfigStore` validates with Zod, stamps `updatedAt`, writes atomically (`config.json.tmp` → rename), and notifies listeners.
4. `DeckServer.broadcastConfig()` pushes the new config to every phone.
5. The phone stores the config in its cache and re-renders.

The renderer never talks to the network directly. The preload script exposes a small typed API, and all filesystem/network/action work happens in the main process.

## Action execution

`packages/shared/src/actions.ts` flattens a button's action list into an ordered plan:

- `hotkey` → keyboard chord
- `text` → Unicode typing
- `macro` → expansion of its steps
- `launch` / `url` / `command` → host operations
- `media` / `delay` / `mouse` → input operations
- `page` → navigation (ignored by the desktop executor)

`ActionExecutor` serializes runs so two phones cannot interleave keystrokes. On Windows, `WindowsKeySender` keeps a single PowerShell process alive; it compiles a small C# `SendInput` shim once and then reads one JSON command per line. This keeps per-press latency low and avoids native Node modules.

Host operations use Node's `child_process` and Electron's `shell`:

- apps are spawned detached,
- URLs are validated as http/https and opened with the default browser,
- commands run through `cmd.exe /c` (`/bin/sh -c` elsewhere) with an optional working directory and hidden console.

**UIPI note:** Windows blocks input injection into elevated windows from non-elevated processes. If you need to control an app running as Administrator, run PhoneDeck as Administrator too.

## Networking and security

- `DeckServer` binds `0.0.0.0` on the configured port (default 47654).
- All HTTP routes except `/api/info` and `/api/health` require `Authorization: Bearer <pin>` or `?token=` (the query name is historical).
- WebSocket upgrades validate the PIN with a timing-safe comparison and reject with HTTP 401. Six wrong attempts per address within a minute trigger a 60-second 429 block.
- The 4-digit PIN is generated once, stored in `settings.json`, and can be regenerated (which closes all clients). Old long tokens migrate to a PIN on first launch.
- `/api/config` emits an ETag; clients may use `If-None-Match` for cheap refreshes.
- Assets are resolved through `AssetStore.pathFor`, which rejects traversal and only serves known image extensions.
- UDP discovery (port 47655) is optional and carries only the server name, port, and version. No PIN.
- There is intentionally no TLS: the design target is a trusted home LAN. Do not port-forward the server.

## Android state machine

1. **Unpaired** → pairing screen (manual entry, discovery list, deep link).
2. **Connecting** → fetch config over HTTP, open WebSocket.
3. **Connected** → render config, send presses, apply `config` pushes.
4. **Reconnecting** → exponential backoff while the activity is started.
5. **Offline** → cached config remains visible; presses are blocked and the status pill turns red/amber.

Page actions are handled locally in the phone, so navigation stays responsive even with a slow link.

## Why these choices

- **Electron + React** — Windows-first packaging with web-speed iteration, no native build toolchain in the editor.
- **Kotlin + Compose** — modern Android rendering with no XML layouts and a tiny dependency surface.
- **JSON + Zod** — one schema validated on the desktop; Android parses leniently with `ignoreUnknownKeys`.
- **PowerShell helper** — avoids `robotjs`/native addon ABI issues while still using Win32 `SendInput`.
- **UDP beacon + QR deep link** — no typing IPs, no camera library inside the app.

## Known limitations / next steps

- Recording macros only captures keys while the PhoneDeck window is focused (no global low-level hook).
- Backups are ZIP archives containing the config plus every background image; legacy JSON configs import without images.
- No multi-user accounts, no cloud sync, no TLS.
- Windows installer is unsigned, so SmartScreen warns on first run.
