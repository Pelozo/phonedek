# PhoneDeck 0.2.3

Patch release fixing 0-byte phone backups.

## Fixes

- **Backups no longer require a live WebSocket.** Returning from the Android document
  picker can leave the deck socket `RECONNECTING`; the backup download now proceeds with
  only the saved pairing, like the import upload.
- **Verified temp file first.** The ZIP is downloaded to an app-cache temp file, then
  copied to the SAF destination only after a successful, complete download. A failed
  download no longer leaves a zero-byte backup.
- **Placeholder cleanup.** Failed saves delete the SAF document via both
  `DocumentsContract` and `ContentResolver`.
- Includes the 0.2.2 import/reconnect fix and 0.2.1 approval-window/diagnostic fixes.

## Upgrade notes

- Windows 0.2.2 can auto-update to 0.2.3.
- macOS unsigned builds need a manual install; signed builds can update in-app.
- Android APK versionCode 9.

If a save fails:
- **401/403** — PIN changed; re-pair.
- **404** — desktop is older than 0.2.0.
- **network** — PC unreachable; check Wi-Fi/firewall.
- **no space** — free storage and choose another folder.
- Android Settings → Diagnostics shows the exact `downloadBackup` result.
