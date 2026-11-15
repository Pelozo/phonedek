# PhoneDeck 0.13.1

Windows input-helper hotfix.

## Fix

- 0.13.0's per-app audio session code used an inline `out uint pid` declaration.
  Windows PowerShell 5.1 compiles `Add-Type` as C# 5, which does not support
  that C# 7 syntax, so the input helper failed at startup. That broke the
  keyboard, trackpad and scroll/volume paths on Windows.
- The variable is now declared before the call. No feature behavior changes.

## Includes from 0.13.0

- Auto-profile return profile.
- Modifier/horizontal scroll, Hue/Nanoleaf lights, trackpad inertia,
  full-screen mixer, categorized Settings, OBS replay fixes, per-app volume,
  media scrub, phone keyboard, Twitch, shortcut wheels, exact entry, OBS phase
  2, mic/OBS audio, live volume state, inline trackpad, copy/move, direct
  screenshots and the pointer master switch.

## Upgrade notes

- Windows 0.13.0 can auto-update to 0.13.1. If the helper is broken in your
  installed 0.13.0, install the 0.13.1 Setup.exe manually.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 29. Install over 0.13.0 (same debug key).
