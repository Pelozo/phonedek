# PhoneDeck 0.10.1

Trackpad scroll inertia and docs.

## Trackpad

- Two-finger scrolling now keeps rolling briefly after a fast flick, using the
  recent centroid velocity. Slow or held releases do not fling. Natural-scroll
  inversion is preserved.
- The tail is one bounded batch, so it settles quickly and never blocks the
  gesture surface.

## Docs

- README covers the full-screen mixer, phone keyboard, media scrub,
  auto-profile, per-app audio, Twitch and local stream lights.

## Includes from 0.10.0

- Full-screen per-app mixer (channel strips, faders, mute).
- Categorized Settings, OBS replay toggle/save split, OBS input seeding.
- Auto-profile, media scrub, phone keyboard, Twitch, Elgato lights, shortcut
  wheels, exact value entry, OBS phase 2, mic/app/OBS audio, live volume state,
  inline trackpad, component copy/move, direct Windows screenshots, pointer
  master switch.

## Upgrade notes

- Windows 0.10.0 can auto-update to 0.10.1.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 25. Install over 0.10.0 (same debug key).
