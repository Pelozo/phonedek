# PhoneDeck 0.8.0

Switch decks automatically when a game starts.

## Auto-profile on game launch

- **Settings → Games**: enable and map an executable to a deck profile
  (e.g. `cs2.exe` → “Counter-Strike”, `chrome` → “Browsing”). Up to 16 rules,
  case-insensitive, `.exe` optional; full paths are reduced to the basename.
- The desktop checks running processes every ~3 seconds. When a mapped game
  starts it sends a `profile` switch to every connected phone once; the phone
  moves to that profile and its start page without reconnecting.
- If the game stays open nothing repeats. Quitting and relaunching switches
  again. Multiple matches use the first rule in the list.
- The deck config and the editor’s selected profile are not modified. This is a
  local, per-PC convenience; rules persist in desktop settings only.
- A missing/deleted profile is ignored; a scan failure logs once and recovers.

## Includes from 0.7.0

- Media scrub: live playhead/duration, title/artist, drag preview, seek on
  release, `NO PLAYER`.
- Phone keyboard (system IME + special keys + modifiers).
- Twitch Helix, Elgato Key Light, shortcut wheels, exact value entry, OBS
  phase 2, mic gain/mute, OBS input volume/mute, live volume state, inline
  trackpad, component copy/move, direct Windows screenshots, pointer master
  switch.

## Upgrade notes

- Windows 0.7.0 can auto-update to 0.8.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 21. Install over 0.7.0 (same debug key).
- Auto-profile uses process names only; it does not inject into games or read
  their memory.
