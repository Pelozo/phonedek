# State

- 2026-11-06: PhoneDeck complete v0.1.0 preview. Repo https://github.com/Pelozo/phonedek.
- Local git metadata: `/tmp/phonedek.git` (NTFS workspace blocks chmod). Commands:
  `git --git-dir=/tmp/phonedek.git add -A`, `... commit`, `... push`.
- Desktop verified under Xvfb: editor, inspector, backgrounds, actions, add-action popover,
  pair QR dialog, macro recorder (text + chords + delays), save persistence, HTTP/WS
  (config auth, press). Screenshots in `docs/screenshots/`.
- Gates: 51 tests, typecheck, production build all green. CI run 42312952202: Windows
  installer + Android APK + lint all green.
- Windows installer verified: valid NSIS PE32, 117 MB, contains
  `resources/keyboard-helper.ps1`, app.asar has ws/zod/qrcode.
- Android APK verified: 11 MB, debug-signed (v2), package `com.phonedek.app`, deep link
  `phonedek://pair`, minSdk 26/target 34.
- Release v0.1.1 published: https://github.com/Pelozo/phonedek/releases/tag/v0.1.1
  (installer 122,061,144 B, debug APK 11,291,469 B, SHA256SUMS). v0.1.0 was deleted
  because its Android WebSocket inherited the 15s HTTP read timeout.
- Latest code commit: 928f2dc "Use a stable debug signing key"; CI run 42317604545 green.
- v0.1.1 adds: advertised-host selector, ZIP backups with assets, Android socket timeout
  fix, Android unit tests in CI, Android v0.1.1/versionCode 2, monochrome icon.
- Stable APK signing: committed `apps/android/debug.keystore` (standard debug creds) so
  future CI APKs update in place. New v0.1.1 assets were re-uploaded with this key:
  APK SHA-256 e125c521…3610df, cert SHA-256 db0345e3…c83fc; installer SHA-256
  58f97c6a…0d9a9. If an interim v0.1.1 APK (before 00:24 UTC) was installed, uninstall
  it once because its signature differs.
- Android background precedence fixed (`DeckButtonView` uses theme, not page).
- Android subagent session `ses_e4cf99e72ffen0aq1xsuJgWb94`: its files are in the repo and
  CI-green; local arm64 Gradle still runs/fails on x86_64 aapt2 (CI x64 is authoritative).
  If it reports edits after 20:35, review and re-run CI.
- Next action: user manual test of v0.1.1 using docs/TESTING.md; collect feedback and fix issues.
  Release and docs are final; no pending code changes.
- Optional backlog: signed release APK, Windows code signing, global macro recording hook,
  tray/minimize-to-tray, page swipe on Android, refresh screenshots to 0.1.1 footer.
- Release notes draft:
  - Windows: unsigned NSIS installer, SmartScreen warning; allow Private network firewall.
  - Android: sideload debug APK; scan QR with camera or enter host/port/token.
  - Same Wi-Fi; rotate token to revoke phones; command/launch actions run as your Windows user.
- Known limitations: macro recorder captures keys only while the PhoneDeck window is focused;
  Windows UIPI blocks input into elevated apps unless PhoneDeck is elevated; config export is
  JSON-only (images stay in `%APPDATA%\PhoneDeck\assets`); no TLS (LAN only).
