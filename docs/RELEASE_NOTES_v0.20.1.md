# PhoneDeck 0.20.1

Release-gate hotfix for 0.20.0. No application behavior changes.

## Fix

- The audio-helper packaging test asserted an exact LF `files:` block against
  `electron-builder.yml`. Windows CI checks that file out with CRLF, so the
  test failed before packaging and the 0.20.0 release job stopped. The test now
  normalizes line endings; the packaged helper assertion and self-test still
  run in CI.

## Includes from 0.20.0

- **Windows default audio-device switching**: set or cycle output/input from a
  deck button, live current-device chip, all three Windows roles, opaque ids
  with friendly-name fallback.
- Editor live device picker with SPEAKERS/HEADPHONES/HEADSET/USB/BLUETOOTH/
  HDMI/VIRTUAL tags, cycle ordering, Test and an Audio device status source.
- Android read-only current-device state and OUT/IN badges.
- Config repair, Quick Settings tile, cross-platform macro capture, older
  desktop export, rigs, automation rules, Streamer.bot, keyboard and scroll
  improvements.

## Manual QA still required

Real Windows 10/11: set output/input, all roles, headset↔speakers, USB mic,
active Bluetooth, HDMI/DP, virtual cables, duplicate names, hotplug, cycle taps,
RDP/no endpoints, helper packaging and PowerShell 5.1 policy. macOS/Linux audio
controllers are not implemented yet.

## Upgrade notes

- Windows 0.19.x can auto-update to 0.20.1.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 41. Install over 0.19.1/0.20.0 (same debug key).
