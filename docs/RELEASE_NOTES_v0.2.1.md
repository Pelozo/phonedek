# PhoneDeck 0.2.1

Patch release focused on phone-to-PC backup import reliability.

## Fixes

- **Approval dialog now surfaces correctly** — if PhoneDeck was minimized or hidden in the
  tray, the window is restored and focused before the import approval dialog opens, so the
  phone no longer waits on an invisible prompt.
- **Import diagnostics** — the desktop log now records upload start, ZIP validation,
  preview counts, approval dialog display/result, and apply failures. Find it under
  **Settings → Diagnostics → Open logs** (`%APPDATA%\PhoneDeck\phonedek.log`).
- **Troubleshooting guide** — added a phone-import section covering wrong target PC, old
  desktop (404), PIN failures, busy imports (409), the 300 MB limit, and isolating ZIP vs
  network problems.
- **Pairing orientation** — the pairing/onboarding screen is allowed to rotate to portrait;
  the landscape lock now applies only after a phone is paired. (Included in 0.2.0 too.)

## Upgrade notes

- Windows 0.2.0 can auto-update to 0.2.1.
- macOS 0.2.0 unsigned builds need a manual install; signed builds can update in-app.
- Android APK versionCode 7.

The import remains staged and validated, requires **Replace deck** approval on the PC, and
writes a pre-import backup before applying.
