# PhoneDeck 0.13.0

Return to a profile when a game closes.

## Auto-profile revert

- **Settings → Games** adds **Return to profile when the game closes** and a
  return-profile picker.
- After a mapped game exits and no other mapped game is running, phones return
  to the chosen profile after a **5-second debounce** — enough to survive a
  quick restart or launcher handoff.
- Starting another mapped game switches to that game instead and cancels the
  return. Relaunching the same game within the debounce also cancels it.
- If the return profile is deleted, the setting is cleared at startup/config
  changes and ignored safely. The feature never fires while the game is still
  running or when the master switch is off.
- The watcher re-reads settings and takes a final process snapshot when the
  timer fires, closing common restart races.

## Includes from 0.12.0

- Modifier + horizontal scroll (Ctrl+wheel zoom, horizontal/Shift wheels,
  inspector modifier checkboxes, stuck-modifier release).
- Philips Hue and Nanoleaf lights; trackpad scroll inertia; full-screen mixer.
- Categorized Settings, OBS replay toggle/save split and input seeding.
- Media scrub, phone keyboard, Twitch, Elgato lights, shortcut wheels, exact
  value entry, OBS phase 2, mic/app/OBS audio, live volume state, inline
  trackpad, component copy/move, direct Windows screenshots, pointer master
  switch.

## Upgrade notes

- Windows 0.12.0 can auto-update to 0.13.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 28. Install over 0.12.0 (same debug key).
- Auto-profile uses process names only; no game injection or memory access.
