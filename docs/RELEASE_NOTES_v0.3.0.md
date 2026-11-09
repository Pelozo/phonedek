# PhoneDeck 0.3.0

Microphone gain and OBS Studio controls.

## Microphone (A2)

- **Add control → Audio → Mic gain** creates a 3×1 gain slider for the default
  capture device. Tap the tile label (or the mic tile) to toggle mute.
- Windows uses the Core Audio capture endpoint, macOS input volume (mute is
  emulated by saving/restoring gain), Linux uses `pactl` source volume/mute.
- Live state shows the real gain, `MUTED`, or `NO INPUT`; the local value stays
  usable if the capture device disappears.
- The inspector has a Mic binding, **Test mute**, and a Mic mute action.

## OBS Studio (A7)

- **Settings → OBS Studio**: enable, host/port, write-only password, live
  connection status and an input list refresh. Works with OBS 28+ and its
  built-in WebSocket server (default `127.0.0.1:4455`).
- **Add control → Integrations → OBS input** opens an input picker and creates a
  0–200% volume slider (100% = 0 dB, 200% = +6 dB) with a mute action on the
  tile label.
- The inspector picks the OBS input, tests volume/mute, and keeps working when
  the input is missing (`NO INPUT`) or OBS is closed (`NO OBS`).
- `obs-v1` is advertised only while OBS is connected; live volume/mute state rides
  the existing `control-state-v1` channel.
- The OBS password stays in the desktop settings file; it is never sent to the
  phone, config or backups.

## Includes from 0.2.9

- Pointer-control master switch, component copy/cut/paste and Move to…, direct
  Windows screenshots, inline trackpad fix, live volume state.

## Upgrade notes

- Windows 0.2.9 can auto-update to 0.3.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 16. Install over 0.2.9 (same debug key).
- OBS: enable **Tools → WebSocket Server Settings** in OBS; PhoneDeck connects
  to it over the LAN/host.
