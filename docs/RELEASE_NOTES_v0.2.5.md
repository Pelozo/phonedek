# PhoneDeck 0.2.5

Live volume readback and the inline trackpad.

## Live volume state

- Absolute volume sliders and wheels now show the PC's **actual system volume** on
  load and while idle, instead of the configured initial (often 50%).
- The desktop polls the OS volume at ~1 Hz only while a volume control is visible,
  with one cached read shared by every connected phone and tile.
- Windows uses a dedicated Core Audio probe; macOS uses `osascript`; Linux uses
  `pactl`. Unsupported hosts leave the control on its configured initial and show
  `LOCAL`.
- Dragging a control keeps your finger in charge; external changes resume once you
  let go. The capability is `control-state-v1`.

## Trackpad

- **Inline mode (default):** the trackpad tile itself is the pad — one-finger move,
  tap = left click, two-finger tap = right click, two-finger drag = scroll,
  long-press = drag lock. It works alongside the other buttons; the small corner
  glyph opens the full-screen pad.
- **Full-screen mode:** choose it in the trackpad inspector (desktop 0.2.5). The
  tile becomes a launcher for the large pad.
- Pointer movement is rotated with the deck's portrait content rotation.
- The inline well now uses a light scrim so custom button backgrounds show through.
- The Windows helper verifies each cursor move and falls back to relative
  `mouse_event` injection if `SetCursorPos` leaves the cursor in place.

## Compatibility

- An old phone app that does not advertise `pointer-v1`/`input-v1` now gets a
  one-time `APP_OUTDATED` notice instead of silently rendering a dead tile.
- Trackpad mode and settings require desktop 0.2.5 for the inspector; an older
  desktop still runs inline mode from the control defaults.
- Windows elevated windows (UIPI) remain unreachable. Linux uses X11; Wayland is
  not supported.

## Upgrade notes

- Windows 0.2.4 can auto-update to 0.2.5.
- macOS unsigned builds need a manual install; signed builds can update in-app.
- Android APK versionCode 11. Install over 0.2.4 (same debug key).
- If inline cursor movement still misbehaves on a specific Windows setup, switch
  the control to full-screen mode in the inspector and include the desktop log's
  `Pointer move` line in a report.
