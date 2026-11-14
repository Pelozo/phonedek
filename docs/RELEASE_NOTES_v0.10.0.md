# PhoneDeck 0.10.0

Full-screen per-app mixer.

## Mixer

- **Add control → Audio → Mixer** adds a 3×2 launcher tile; **Add action → Audio
  → Open mixer** opens it from an existing button.
- Tapping the tile opens a full-screen mixer on the phone with one channel strip
  per live audio session: app/process name, vertical fader with %, mute toggle,
  and live updates while the PC plays audio.
- Fader movement is coalesced and committed as you drag; mute is immediate.
  Sessions that close show `NO SESSION`; unsupported desktops show `NO MIXER`
  with the reason (no fake controls).
- Windows uses Core Audio session enumeration/volume/mute; Linux uses `pactl`
  sink-inputs. macOS has no public per-app API and intentionally reports
  unsupported (`mixer-v1` absent).
- The wire uses `mixer` subscribe → immediate + 1 Hz change-only `mixerState`,
  and `mixerCommand`/`mixerResult` for volume/mute. One subscription per phone,
  cleanup on close, rate-limited.

## Includes from 0.9.0 / 0.8.1

- Per-app volume controls/actions/status tiles (single-session).
- Categorized Settings (General / Input / Integrations / Phone / About).
- OBS Replay tile toggles the replay buffer; Save Replay separate; functional
  OBS errors toast; OBS input levels seeded.
- Auto-profile, media scrub, phone keyboard, Twitch, Elgato lights, shortcut
  wheels, exact value entry, OBS phase 2, mic gain/mute, OBS input volume/mute,
  live volume state, inline trackpad, component copy/move, direct Windows
  screenshots and the pointer master switch.

## Upgrade notes

- Windows 0.9.0 can auto-update to 0.10.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 24. Install over 0.9.0 (same debug key).
- The mixer is Windows/Linux only; macOS reports unsupported.
