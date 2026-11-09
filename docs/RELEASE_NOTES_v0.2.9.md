# PhoneDeck 0.2.9

Pointer-control master switch.

## Security

- **Settings → 04 · Input → Allow pointer control** (on by default). A paired
  phone can move the mouse and click; turn this off to suspend all pointer input
  from every connected phone.
- Disabling it releases any held mouse button immediately. Re-enabling does not
  override an open native approval/destructive dialog; pointer input resumes only
  when both the switch and the dialog gate allow it.
- The trackpad capability remains advertised so the phone UI stays consistent;
  accepted pointer frames are refused while suspended.

## Includes from 0.2.8

- Component copy/cut/paste and cross-page/profile **Move to…**.
- Direct Windows screenshots (Win+Shift+S captures a PNG instead of opening the
  Snipping Tool), `LIVE` label removed from volume controls.
- Inline trackpad movement fix and live volume readback.

## Upgrade notes

- Windows 0.2.8 can auto-update to 0.2.9.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 15. Install over 0.2.8 (same debug key).
