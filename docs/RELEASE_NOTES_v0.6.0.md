# PhoneDeck 0.6.0

Type on your PC from the phone.

## Phone keyboard

- **Add control → Pointer → Keyboard** creates a launch tile; **Add action →
  Integrations → Open phone keyboard** adds the launcher to an existing button.
- Tapping the tile opens a full-screen keyboard panel. Text uses the Android
  system IME (Gboard, etc.), with a pinned special-key strip: Enter, Backspace,
  Tab, Esc, arrows and latchable Ctrl/Alt/Shift/Win.
- **Line mode**: Send (or the IME action / Enter) commits the current line; text
  is never sent mid-composition, so CJK/IME candidates are respected.
- Keys/modifiers go as ordered chords; `keyboard-v1` streams over the LAN.
- Settings → 04 → **Allow keyboard control** (default on) is a master switch.
  Typing is also suspended while a native approval/destructive dialog is open.
- Text is not written to logs, diagnostics or the phone cache. Keystrokes can
  reach any app the PC user can type into; turn the switch off when away.

## Includes from 0.5.0

- Twitch Helix (device-code auth, live status, chat/marker/title/game).
- Elgato Key Light (brightness/temperature/power, status tiles).
- Shortcut wheels, exact value entry, OBS phase 2, mic gain/mute, OBS input
  volume/mute, live volume state, inline trackpad, component copy/move, direct
  Windows screenshots and the pointer master switch.

## Upgrade notes

- Windows 0.5.0 can auto-update to 0.6.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 19. Install over 0.5.0 (same debug key).
- macOS may ask for **Accessibility** the first time keyboard control is used;
  the existing helper permission covers typing.
