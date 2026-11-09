# PhoneDeck 0.2.8

Copy, paste and move components between pages.

## Editor

- **Ctrl/Cmd+C / X / V** copy, cut and paste the selected button or control.
- The Inspector has a **Component** row with Copy, Cut, Paste (disabled when the
  clipboard is empty) and **Move to…**.
- **Move to…** lists every profile and page except the current one; the component
  is re-placed with the same slot when free, otherwise the first free span-aware
  slot. If the footprint cannot fit, it falls back to 1×1 with a toast.
- Clipboard entries deep-clone actions, control settings, span, backgrounds,
  media icons and text colors. Pasted components get a fresh unique id; moves
  keep the id when it is still unique.
- Existing components are never overwritten or overlapped. On a successful move
  the editor switches to the target page and selects it.
- Shortcuts are ignored while typing in an input, textarea, select or editable.
- The clipboard is editor-local (not the OS clipboard) and does not survive an
  app reload.

## Includes from 0.2.7 and 0.2.6

- Direct Windows screenshots (Win+Shift+S captures a full-desktop PNG instead of
  opening the Snipping Tool), including buttons imported from macOS profiles.
- `LIVE` label removed from volume controls; `LOCAL` remains for old desktops.
- Inline trackpad movement fix and live volume readback.

## Upgrade notes

- Windows 0.2.7 can auto-update to 0.2.8.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 14. Install over 0.2.7 (same debug key).
