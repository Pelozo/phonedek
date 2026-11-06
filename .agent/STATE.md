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
- Latest commit: 1f8ec00 "Add deck name setting" (final CI run 42313296530 in progress).
- Android background precedence fixed (`DeckButtonView` uses theme, not page).
- Android subagent session `ses_e4cf99e72ffen0aq1xsuJgWb94`: its files are in the repo and
  CI-green; local arm64 Gradle still runs/fails on x86_64 aapt2 (CI x64 is authoritative).
  If it reports edits after 20:35, review and re-run CI.
- Next action: wait for run 42313296530, download latest artifacts, create GitHub release
  `v0.1.0` with installer + APK + SHA256SUMS and install/test instructions.
- Release notes draft:
  - Windows: unsigned NSIS installer, SmartScreen warning; allow Private network firewall.
  - Android: sideload debug APK; scan QR with camera or enter host/port/token.
  - Same Wi-Fi; rotate token to revoke phones; command/launch actions run as your Windows user.
- Known limitations: macro recorder captures keys only while the PhoneDeck window is focused;
  Windows UIPI blocks input into elevated apps unless PhoneDeck is elevated; config export is
  JSON-only (images stay in `%APPDATA%\PhoneDeck\assets`); no TLS (LAN only).
