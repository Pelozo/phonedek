# PhoneDeck 0.7.0

Media scrub: seek the active player from the deck.

## Media scrub

- **Add control → Media → Media scrub** creates a 4×1 (3×1/1×1 fallbacks)
  position slider with `commit: 'end'` and `display: 'time'`.
- The phone shows the live playhead and total time, plus title/artist, with a
  play/pause state glyph. Dragging previews locally and only the final position
  is sent on release; progress ticks never snap the thumb back mid-drag.
- Missing/unsupported players show `NO PLAYER` quietly. No deck/network toast.
- Desktop players:
  - Linux: `playerctl`/MPRIS (Spotify, VLC, Chromium family, …).
  - macOS: Spotify and Music via AppleScript (browsers have no public seek API).
  - Windows: the active System Media Transport Controls session; apps that
    expose state but reject seek report unsupported.
- The editor shows a static `0:00 ───── 3:45` preview and `MEDIA · SEEK` badge;
  live values only appear on the phone.

## Includes from 0.6.0

- Phone keyboard (system IME + special keys + modifiers, `keyboard-v1`,
  Settings master switch).
- Twitch Helix (device-code auth, live status, chat/marker/title/game).
- Elgato Key Light (brightness/temperature/power, status tiles).
- Shortcut wheels, exact value entry, OBS phase 2, mic gain/mute, OBS input
  volume/mute, live volume state, inline trackpad, component copy/move, direct
  Windows screenshots and the pointer master switch.

## Upgrade notes

- Windows 0.6.0 can auto-update to 0.7.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 20. Install over 0.6.0 (same debug key).
- Windows/macOS media support is player-dependent; use `NO PLAYER` as the cue
  that the app does not expose a seekable session.
