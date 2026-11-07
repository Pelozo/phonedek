# PhoneDeck — Suggested Next Work

_As of 2026-11-07. This is a product/engineering backlog, not a commitment._

PhoneDeck now has a complete editor, Android deck, per-page grids, GIF/video
backgrounds and icons, preset action packs, OS-aware shortcuts, in-app Windows updates,
signature-aware macOS updates, and a full-screen Mac screenshot action.

The highest-value work now is portability and continuous controls. Both have been
investigated and scoped; details below.

## Priority 1 — Portable phone backup (MVP)

**Why:** the phone is currently a read-only replica. Changing servers or losing the PC
loses the only copy unless the desktop exported a ZIP. Users want to carry their deck on
their phone and restore it on another PhoneDeck setup.

**Smallest useful version**
1. Desktop `GET /api/backup`, paired-PIN protected, streams the existing backup ZIP
   (config + assets) instead of building it in memory if possible.
2. Android **Settings → Backup → Save backup to phone…** using the Storage Access
   Framework (`CreateDocument("application/zip")`) and progress UI.
3. Optional **Share last backup** via FileProvider.
4. New PC imports the ZIP with the existing desktop Import-backup dialog.

**Effort:** 3–5 days. No new Android permissions. Needs careful handling of large videos
(up to 100 MB each), a dedicated HTTP timeout, and a clear “connect to your PC first”
state.

**Later (phase 2):** staged `POST /api/import` with a desktop approval modal, pre-import
backup, preview of profiles/pages/assets/warnings, and capability negotiation. Do not let
the phone silently replace a desktop config.

**Later (phase 3):** import-as-new-profile/merge. This needs profile ID remapping and
asset collision handling.

**Guardrails:** no phone-to-phone protocol; no silent overwrite; preserve the target's
PIN/port/server name; reject newer schema versions with a clear message.

## Priority 2 — Slider / wheel controls

**Why:** volume, seeking, zoom and scrolling are naturally continuous. Repeated buttons
work but are clumsy.

**Recommended MVP**
- Extend `DeckButton` with an optional `control` and a column `span`:
  - `slider` (horizontal/vertical) or `dial`/wheel.
  - Bindings: **relative volume** (existing media volume keys) and **scroll** (existing
    mouse scroll). Tap action remains the fallback (e.g. mute).
- Add a capability-gated `input` message carrying `{ controlId, phase, value?, delta? }`,
  a separate rate limit, and coalescing in the desktop executor. Keep protocol v1.
- Android: Material3/custom slider, rotary wheel, haptics, local value overlay, and
  disable pager swipes while a control is being dragged.
- Editor: occupancy-aware add/move/resize, control inspector, and a spanning control
  preview.

**Effort:** 9–13 days including tests. High viability; no platform audio backend needed
for the relative MVP.

**Defer:** absolute volume (Windows Core Audio / macOS `osascript` / Linux `pactl`),
row spans, zoom modifiers, OBS WebSocket, arbitrary values, MQTT.

## Priority 3 — Android portrait geometry

**Why:** rotating the phone currently reflows the deck to narrow portrait cells, which
changes key sizes and can break muscle memory.

**Requirement:** keep the landscape cell geometry/size when the phone is vertical; only
icons and labels should reorient.

**Design decision needed:** either
- **Fixed-aspect letterbox:** render the landscape deck inside a centered 16:9 area with
  background margins in portrait, or
- **Rotated canvas:** rotate the logical deck 90° and counter-rotate icons/text.

The first preserves tap targets and is simpler; the second uses the full screen but makes
the grid read sideways. Prototype both on a real phone before choosing.

**Prerequisite shipped:** Settings now has a persisted **Lock landscape** toggle
(default on).

**Effort:** 2–4 days after the design decision, plus device testing.

## Quick wins (1–2 days each)

- **Tray / minimize to tray** on Windows/macOS, with “Show”, “Pause server”, “Quit”.
- **Custom confirm modal** for destructive grid/page/profile changes instead of the
  native `window.confirm` (the current resize confirmation is functional but plain).
- **Archive the cached config before “Change server”**, with a “Save a backup first”
  prompt. The Android cache is a single slot today.
- **Windows Authenticode signing** for the installer. Not required for auto-update, but
  removes SmartScreen friction and enables publisher verification.
- **Release automation:** a tag-triggered GitHub Actions job that downloads the Windows,
  macOS and Android artifacts and publishes them together after signing checks.
- **Video icon concurrency cap** and a visible fallback when too many players would start
  at once (low-end phones).

## Platform / release

- **Universal macOS build** (arm64 + x64) so Intel Macs work and the Mac feed stays a
  single ZIP/`latest-mac.yml`.
- **Linux AppImage** build + `latest-linux.yml`; enable the updater only when `APPIMAGE`
  is set. Defer until there is demand.
- **Signed release APK** for Android (Play Store or direct distribution) and a
  documented update path. The current APK is debug-signed.
- **macOS E2E:** install the first signed release manually, then ship the next version and
  verify the in-app update, settings/assets survival, and phone reconnect.
- **Staged rollout / beta channel** for desktop updates (electron-updater supports a
  staging percentage; generate it in the release job).

## Reliability / performance

- **Offline media:** Android config caches JSON but not video; images depend on Coil’s
  evictable cache. Add a bounded media cache (e.g. Media3 `SimpleCache` + disk LRU) if
  offline decks with animated media matter.
- **Android lifecycle:** video players now pause on background and page changes, but test
  low-end decoder limits and rapid page swipes on a real device.
- **Connection diagnostics:** the offline banner shows `pairingError` when available;
  add a structured last-connection error to `UiState` for more precise reasons.
- **Server memory:** backup export and import currently buffer ZIPs in the Electron main
  process. Move to a streaming ZIP library/worker if 300 MB backups become common.
- **Input latency:** measure press-to-action latency over Wi-Fi and the WebSocket queue;
  add a latency readout in diagnostics.

## Action / preset expansion

- **OBS WebSocket integration** for real scene/source/audio control instead of suggested
  hotkeys.
- **More packs:** Photoshop, Premiere, Figma, Slack/Teams, Spotify, Discord, Linux desktop
  shortcuts, macOS-specific system actions.
- **Global macro recording hook** on Windows/macOS, so recording does not require the
  PhoneDeck window to be focused.
- **Action templates with variables** (e.g. open a URL containing the active window title)
  — only if a clear use case appears.

## Quality / infrastructure

- **Android emulator CI** (or a self-hosted device) for at least one portrait/landscape
  screenshot test. Today Android layout is compile/geometry-checked only.
- **Electron E2E** for the critical flows: pair, edit/save, drag, resize grid, record
  macro, import backup, update status. A small Playwright/Electron harness would catch
  renderer regressions.
- **Schema migration tests** for future config versions; keep backward compatibility
  explicit.
- **Docs:** protocol/media asset reference, portable backup format, signed release
  process, and a troubleshooting matrix for pairing/firewall/PINs.

## Explicitly not planned

- Cloud accounts or a hosted config service. PhoneDeck is local-first.
- Phone-to-phone config transfer before the desktop-to-phone backup MVP exists.
- Silent config replacement from the phone.
- A full plugin runtime; preset packs and the existing action model cover most cases.
