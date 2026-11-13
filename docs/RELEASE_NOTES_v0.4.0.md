# PhoneDeck 0.4.0

Shortcut wheels, exact value entry and the full OBS control surface.

## Shortcut wheels

- Add control presets for **browser tabs** (`Ctrl+Tab` / `Ctrl+Shift+Tab`),
  **app switcher** (Alt/Cmd+Tab with a held modifier), **brush size** (`[`/`]`),
  **zoom** (`Ctrl +/-`) and **seek** (arrows).
- Custom shortcut controls: chord capture for forward/reverse/hold keys, repeat
  (1–5), slider `travelSteps` (4–100), a destructive-shortcut warning and
  Test −/+ in the inspector.
- The phone shows a compact chord badge (`⌃TAB`, `⌘⇥`, …) instead of a
  meaningless percentage; one chord per detent, held modifiers for app
  switching, and a watchdog releases stuck keys.

## Exact value entry

- Tap the numeric readout of an absolute volume, mic gain or OBS input tile to
  open a flat numeric plate. Values are parsed (including `%`/comma), clamped to
  the control range and snapped to its step; cancel leaves the PC untouched.

## OBS Studio phase 2

- Actions for **scenes**, **stream**, **record**, **replay buffer**, **virtual
  camera**, **source visibility** and **stream/recording markers**.
- **Status tiles**: put a `state` binding on a button to show `LIVE`, `REC`,
  `REPLAY`, `VCAM`, `MUTED`, a scene name or a percent from OBS, with the tile's
  normal actions on tap.
- Editor presets/fields for all OBS actions and status tiles; Android renders
  the status chip and keeps OBS outages quiet.
- Builds on the OBS 0.3.0 connection/settings work (`obs-websocket` 5.x, OBS 28+).

## Includes from 0.3.0

- Microphone gain/mute and OBS input volume/mute with live state.
- Component copy/cut/paste and Move to…, pointer master switch, direct Windows
  screenshots, inline trackpad fix.

## Upgrade notes

- Windows 0.3.0 can auto-update to 0.4.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 17. Install over 0.3.0 (same debug key).
