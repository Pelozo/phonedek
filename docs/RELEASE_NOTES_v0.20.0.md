# PhoneDeck 0.20.0

Switch the PC's default audio output and input from the deck.

## Audio-device switching (Windows)

- **Set** the default output or input to a chosen endpoint, or **cycle** a
  2–8 device list (two devices become a toggle). A headset-mode button can set
  output and input with two actions.
- **Live truth**: the tile/status source shows the current device name and
  lights the active target through `control-state-v1` (`NO AUDIO` / `NO DEVICE`
  when unavailable). The phone never reads its own `AudioManager`.
- **Live picker**: the editor enumerates active endpoints with friendly names
  and SPEAKERS/HEADPHONES/HEADSET/MIC/USB/BLUETOOTH/HDMI/VIRTUAL tags, marks
  the current one, and stores an opaque host id plus name fallback. `Test`
  applies the device directly without running the button's other actions.
- **All roles** by default on Windows (console, multimedia, communications), so
  Discord/Teams follow the switch. OBS and apps that pin their own device keep
  their route — the editor says so.
- The desktop advertises `audio-device-v1` only when the controller and helper
  are present. Older phones keep the button and press path; they simply lack the
  live chip. macOS/Linux advertise no audio-device capability yet.
- Packaged builds include a separate `audio-device-helper.ps1` (Core Audio +
  `IPolicyConfig`, opaque SHA-256 ids). CI compiles/runs its self-test and
  asserts it is in the installer. The persistent helper keeps Add-Type warm;
  writes are latest-wins and list/current reads are cached.

## Android

- Read-only audio-device status tiles render the desktop's current device name
  with `NO AUDIO`/`NO DEVICE` fallbacks; `OUT`/`IN` badges identify switch
  actions. Audio actions press normally through the existing remote path.
- The full-screen audio-device panel is deferred; the server protocol is ready.

## Includes from 0.19.1

- Config reference repair, Android Quick Settings tile, cross-platform macro
  capture and mouse recording, older-desktop export, rigs, automation rules,
  Streamer.bot, live keyboard, scroll wheels and What's New.

## Manual QA still required

Real Windows 10 22H2 / Windows 11: set output and input, all three roles,
headset↔speakers, USB mic, active Bluetooth, HDMI/DP, virtual cables, duplicate
friendly names, hotplug, rapid/cycle taps, RDP/no-endpoint sessions, first-press
and repeated-write latency, packaged helper path and PowerShell 5.1 policy.
macOS/Linux audio controllers are future work.

## Upgrade notes

- Windows 0.19.x can auto-update to 0.20.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 40. Install over 0.19.1 (same debug key).
