# PhoneDeck 0.13.2

Live keyboard, one keyboard on the phone, and an in-app What's New summary.

## Live phone keyboard

- The phone now shows a single full QWERTY/symbol keyboard. The Android system
  IME is no longer opened behind it, so there is no second keyboard.
- Every key sends its own down/up event as it is pressed, instead of waiting for
  SEND. Backspace and the arrow keys repeat while held.
- Hold Shift, Ctrl, Alt or Tab to keep them down for games and shortcuts. A
  quick tap latches a modifier for the next key; tap it again to cancel.
- Five base rows keep letters, symbols/digits, Esc/modifiers, and arrows on a
  phone in portrait and landscape. FN adds F1–F12; PASTE sends clipboard text.

## Scroll controls

- Scroll controls now always render as a wheel, including controls that were
  previously a slider (and showed a progress bar with a percentage).
- Horizontal scroll wheels respond to left/right drags and taps; vertical
  wheels keep the up/down drag, tap and flick behavior.
- Held keys refresh the desktop watchdog, so long holds do not time out.
- Compatibility: 0.13.2 desktops advertise `keyboard-v2`. A new phone paired to
  an older desktop automatically uses a chord-per-key compatibility mode.

## What's New

- After a version change, PhoneDeck shows a one-time summary of what changed.
  A genuine first install stays quiet.
- Settings → About → What's new reopens the current version's summary at any
  time without consuming the "seen" marker. This applies to the desktop app and
  Android.

## Fixes included from 0.13.1

- Windows PowerShell 5.1 compiles `Add-Type` as C# 5; 0.13.0 used the C# 7 inline
  `out uint pid` form, which stopped the keyboard/pointer/audio helper at
  startup. The variable is declared separately now.
- Includes everything from 0.13.0: auto-profile return, modifier/horizontal
  scroll, Hue/Nanoleaf lights, trackpad inertia, per-app volume and mixer,
  categorized Settings, OBS replay fixes, media scrub, Twitch, shortcut wheels,
  exact entry, Windows screenshots and the pointer master switch.

## Upgrade notes

- Windows 0.13.0/0.13.1 can auto-update to 0.13.2. If the 0.13.0 helper is
  broken, install the 0.13.2 Setup.exe manually.
- The keyboard's live down/up path needs desktop 0.13.2 (`keyboard-v2`). With an
  older desktop, the phone stays on the compatibility path and keeps working.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 30. Install over 0.13.1 (same debug key).
