# PhoneDeck 0.22.2

Patch release for the audio-device protocol limit.

## Audio device list limit

- The desktop now caps each reported output/input list at the 64-entry
  `audio-device-v1` limit.
- When a host reports more than 64 endpoints (common with many virtual audio
  drivers), the current device is kept in the list and one remote endpoint is
  dropped instead.
- This prevents the phone from rejecting the entire audio state message on an
  unusually large host.

## Documentation

- Added a public audio-device guide and platform QA checklists.
- Added `scripts/verify-release.sh` for checksum, feed and APK manifest checks.

## Includes from 0.22.1/0.22.0

- Android video players are released on preloaded pages.
- macOS CoreAudio, Windows Core Audio and Linux `pactl` audio switching.
- Held-key release on shortcut helper errors.

## Manual QA still required

- Android: page turns with video backgrounds/icons.
- macOS/Linux/Windows audio endpoints, roles, hotplug and packaged helpers.
- Windows/macOS macro capture and the Android Quick Settings tile.

## Upgrade notes

- Windows/macOS 0.22.x can auto-update.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android installs over 0.22.1 (same debug key), versionCode 45.
