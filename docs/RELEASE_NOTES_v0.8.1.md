# PhoneDeck 0.8.1

Settings categories and OBS replay fixes.

## Settings

- The Settings dialog is now categorized with a flat rail: **General**,
  **Input**, **Integrations** and **Phone/About**. Narrow windows use a
  horizontal category row. Permission/OBS/import entry points open the right
  category directly. Every existing control is still available.

## OBS

- **Replay tile:** the REPLAY status tile now **toggles the replay buffer**
  (start/stop) instead of trying to save while the buffer is off. The tile shows
  `REPLAY` while active and `OFF` otherwise.
- **Save replay** remains a separate action (Add action → OBS save replay) for
  saving the last clip.
- Functional OBS errors (for example “replay buffer is not active”) now show a
  one-shot toast; availability messages (`NO OBS`, offline) stay quiet and are
  shown by tile state.
- New OBS input controls are seeded with the input’s **current OBS level**
  instead of starting at 100%, and continue to be absolute (0–200%,
  100% = 0 dB).

## Includes from 0.8.0

- Auto-profile on game launch, media scrub, phone keyboard, Twitch, Elgato
  lights, shortcut wheels, exact value entry, OBS phase 2, mic gain/mute, OBS
  input volume/mute, live volume state, inline trackpad, component copy/move,
  direct Windows screenshots, pointer master switch.

## Upgrade notes

- Windows 0.8.0 can auto-update to 0.8.1.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 22. Install over 0.8.0 (same debug key).
