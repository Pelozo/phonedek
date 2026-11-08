# PhoneDeck 0.2.4

Trackpad preview, wheel/dial fixes and row-spanning controls.

## Trackpad (experimental)

- **Add control → Trackpad** creates a 3×2 tile (2×2, then 1×1 fallbacks) that opens a
  full-screen cursor pad on the phone.
- One-finger drag moves the cursor; tap = left click; two-finger tap = right click;
  two-finger drag scrolls; long-press starts a drag and a tap releases it.
- Separate `pointer-v1` channel and a dedicated cursor helper, so macro delays cannot
  freeze the pointer.
- Inspector options: sensitivity, natural scroll, tap to click, drag lock, haptics.
- Windows uses per-monitor DPI-correct relative moves; macOS uses CGEvent drag-aware
  moves; Linux works on X11 via `xdotool`. Wayland is not supported.
- Both the desktop app and the phone must be on 0.2.4; an older desktop rejects the pad
  with an update message. Elevated windows on Windows (UIPI) are still unreachable.

## Controls

- **Row-spanning tiles** now render on Android with the same footprint as the desktop
  preview, including tall volume/scroll controls.
- **Wheel/dial gestures:** volume wheels rotate or scrub vertically; taps jump to the
  tapped value. Scroll wheels are vertical-only, tap the top/bottom half for one notch,
  and carry release velocity into a short fling instead of stopping dead.
- The dial gauge gap moved to the bottom with a brighter track, and dial tiles show a
  small turn affordance.
- Add control is grouped into Audio, Navigation and Pointer with clearer descriptions.

## Upgrade notes

- Windows 0.2.3 can auto-update to 0.2.4.
- macOS unsigned builds need a manual install; signed builds can update in-app.
- Android APK versionCode 10. Install over 0.2.3 (same debug key).
- Trackpad is a first pass: no absolute/tablet mode, pinch or cursor feedback yet.
