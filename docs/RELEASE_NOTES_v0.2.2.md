# PhoneDeck 0.2.2

Patch release fixing phone-to-PC backup import after the Android document picker.

## Fixes

- **Import no longer requires an active WebSocket.** Opening the Android file picker
  backgrounds the app and drops the deck socket; when the picker returned, the import
  previously refused to start because the connection was still `RECONNECTING`. The upload
  is a one-shot HTTP request and now runs with only the saved pairing (host/port/PIN).
- **Import button stays enabled while reconnecting**, and its label shows the target
  PC name so it is clear where the backup will go.
- **Earlier visibility** — the HTTP request is logged before authentication, so
  `Phone import HTTP POST` now appears in the PC log even if the PIN is rejected or the
  request is malformed.
- Includes the 0.2.1 approval-window fix and step-by-step `Phone import` diagnostics.

## Upgrade notes

- Windows 0.2.1 can auto-update to 0.2.2.
- macOS unsigned 0.2.1 needs a manual install; signed builds can update in-app.
- Android APK versionCode 8.

If import still fails, check the PC log for `Phone import HTTP POST` first:
- no line: the phone did not reach this PC (wrong pairing target, Wi-Fi, or file picker);
- `PIN rejected`: re-pair;
- `upload started` then `validated`: the approval dialog should appear;
- `approval: cancelled`: approve the dialog on the PC.
