# PhoneDeck 0.9.0

Per-app volume from the deck.

## Per-app audio

- **Add control → Audio → App volume**: pick a live mixer session (Chrome,
  Spotify, Discord, a game, …) and get a 3×1 absolute slider seeded from that
  app's current level. Tapping the tile label toggles its mute.
- The session picker shows the process, current %, `MUTED`, shared-process
  hints, and a clear `NO MIXER`/empty state. Browser tabs may share one process.
- **Add action → Audio → App audio mute**: toggle/mute/unmute one session.
- **Status tiles**: app volume and app mute, with `42%`, `MUTED`, `LIVE`,
  `NO SESSION` and quiet `UNSUPPORTED`.
- The inspector has a process picker, Test −/+, Test mute, and a read-only
  status-source selector. The editor preview shows `APP · VOL` / `APP · MUTE`.
- Windows uses Core Audio sessions (`IAudioSessionManager2`); Linux uses
  `pactl` sink-inputs. macOS has no public per-app API: no `mixer-v1`, clear
  unsupported state, no fake controls.
- Absolute values bypass the keyboard queue; mute actions use the serialized
  executor. Reads are cached and poll only while a control is visible.

## Includes from 0.8.1

- Categorized Settings (General / Input / Integrations / Phone / About).
- OBS Replay tile now toggles the replay buffer; Save Replay is separate;
  functional OBS errors show a toast; new OBS controls seed the current level.

## Includes from 0.8.0/0.7.0

- Auto-profile on game launch, media scrub, phone keyboard, Twitch, Elgato
  lights, shortcut wheels, exact value entry, OBS phase 2, mic gain/mute, OBS
  input volume/mute, live volume state, inline trackpad, component copy/move,
  direct Windows screenshots and the pointer master switch.

## Upgrade notes

- Windows 0.8.1 can auto-update to 0.9.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 23. Install over 0.8.1 (same debug key).
- Per-app volume is Windows/Linux only; macOS intentionally reports unsupported.
