# PhoneDeck 0.18.0

Cross-platform macro capture: record the keyboard and mouse in other apps,
including clicks, drags, wheel and optional movement.

## Global macro capture

- **Record outside PhoneDeck**: Windows, macOS and Linux X11 use the native
  `uiohook` hook (N-API) from the Electron main process. Start a recording,
  wait for the 3-second countdown, then work in any app.
- **Stop anywhere** with `Ctrl+Alt+F10` (`Cmd+Alt+F10` on macOS). A native
  notification confirms start/stop; closing the dialog or quitting also stops
  the hook.
- **Mouse steps**: click, double-click, drag down/up, wheel and optional
  sampled movement. Drag paths are kept even when free movement is off.
  Modifiers held around a click are recorded in the correct order.
- **Safe focus behavior**: input while a PhoneDeck window is focused is ignored
  by default, so using the dialog does not record its own clicks/keys. The
  global stop hotkey still works.
- **Fallback**: if the native hook is unavailable (Wayland, missing macOS
  Accessibility/Input Monitoring, broken prebuild) or the shortcut cannot be
  registered, the recorder reports why and falls back to focused recording.
- PhoneDeck's own injected input cannot be distinguished by libuiohook; avoid
  firing phone actions while recording, or they may appear as macro steps.

## Recording details

- `MacroRecorder` now accepts key and mouse events. Pauses still become delays,
  text typing can still be grouped, and mouse events flush pending text.
- Movement is sampled by distance/time and capped; the existing macro editor
  can edit every generated step.
- Existing click/drag/wheel replay already handled absolute screen coordinates;
  DPI/multi-monitor behavior still needs real-device QA.

## Packaging and reliability

- `uiohook-napi@1.5.5` is a pinned production dependency. The `.node` and its
  `node-gyp-build` loader are unpacked from asar; both builder configs include
  the rule. CI now checks the packaged native module on Windows and macOS
  (including codesign verification when a Developer ID is configured).
- Wayland is reported unsupported; X11 capture is best-effort. macOS needs
  Accessibility + Input Monitoring. Windows cannot capture input aimed at
  elevated applications (UIPI).

## Includes from 0.17.0

- Older-desktop export, README/screenshots, rigs, automation rules,
  Streamer.bot, live keyboard, scroll wheels and What's New.

## Manual QA still required

Real hooks cannot run in the Linux arm64 dev/CI host. Verify on Windows and
macOS: global start/stop from another app, clicks/drags/scroll, DPI and
multi-monitor coordinates, focus filtering, shortcut conflicts, permission
prompts, packaged `.node` loading/signing, and the focused fallback.

## Upgrade notes

- Windows 0.17.x can auto-update to 0.18.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 37. No Android behavior changed beyond the What's New
  entry; install over 0.17.0 (same debug key).
