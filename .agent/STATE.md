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
- Release v0.1.2 published: https://github.com/Pelozo/phonedek/releases/tag/v0.1.2
  (installer 122,061,631 B, debug APK 11,307,853 B, SHA256SUMS).
- Root cause of “server address is not valid”: OkHttp HttpUrl only accepts http/https,
  Android built the WS URL with scheme=ws and always threw. Fixed in 941f665 by using
  http:// for the WebSocket handshake; regression test in DeckConnectionUrlTest.
- Latest code commit: 941f665 "Fix Android WebSocket URL scheme and add pairing diagnostics";
  CI run 42319780727 green (desktop tests/build/installer + Android unit tests/build/lint).
- v0.1.1 adds: advertised-host selector, ZIP backups with assets, Android socket timeout
  fix, Android unit tests in CI, Android v0.1.1/versionCode 2, monochrome icon.
- v0.1.2 adds: 4-digit pairing PIN with 6/min rate-limit block, in-app diagnostics
  (Settings and pairing screen, Copy), logs to `adb logcat -s PhoneDeck`, stale pairing
  validation, Android URL-scheme fix, versionCode 3.
- Stable APK signing: committed `apps/android/debug.keystore` (standard debug creds) so
  future CI APKs update in place. New v0.1.1 assets were re-uploaded with this key:
  APK SHA-256 e125c521…3610df, cert SHA-256 db0345e3…c83fc; installer SHA-256
  58f97c6a…0d9a9. If an interim v0.1.1 APK (before 00:24 UTC) was installed, uninstall
  it once because its signature differs.
- Android background precedence fixed (`DeckButtonView` uses theme, not page).
- Android subagent session `ses_e4cf99e72ffen0aq1xsuJgWb94`: its files are in the repo and
  CI-green; local arm64 Gradle still runs/fails on x86_64 aapt2 (CI x64 is authoritative).
  If it reports edits after 20:35, review and re-run CI.
- 2026-11-06/07: User confirmed v0.1.2 APK connects successfully after pairing. Root cause was
  the pre-fix APK (`scheme ws`); the published v0.1.2 artifact contains `buildWebSocketUrl`.
- v0.1.1 release was deleted (known WS bug); only v0.1.2 is published.
- Next action: await manual-test feedback (pairing/actions/UI). Optional backlog: tray/minimize,
  Android page swipe, global macro hook, signed release APK/Windows signing.
- Optional backlog: signed release APK, Windows code signing, global macro recording hook,
  tray/minimize-to-tray, page swipe on Android, refresh screenshots to 0.1.1 footer.
- Release notes draft:
  - Windows: unsigned NSIS installer, SmartScreen warning; allow Private network firewall.
  - Android: sideload debug APK; scan QR with camera or enter host/port/token.
  - Same Wi-Fi; rotate token to revoke phones; command/launch actions run as your Windows user.
- Known limitations: macro recorder captures keys only while the PhoneDeck window is focused;
  Windows UIPI blocks input into elevated apps unless PhoneDeck is elevated; config export is
  JSON-only (images stay in `%APPDATA%\PhoneDeck\assets`); no TLS (LAN only).


## In-flight (2026-11-07)

- Working tree has v0.1.3 changes (macro overhaul, 4-digit PIN, Android swipe) and a
  **partial in-app updater** (electron-updater, UpdateStatus API/preload/IPC/main service).
- Two background subagents:
  1. `ses_e4c6aa074ffe6z0kwEiUp2cfkf` — finish Windows in-app auto-update
     (`apps/desktop/src/main/updater.ts`, Settings UI, docs/UPDATES.md, CI latest.yml/blockmap).
  2. `ses_e4c66ceb8ffemT2t2OkadhHrvE` — fix Android swipe chrome color bleed + hide-top-bar
     option (`apps/android` only).
- Do not edit their files concurrently. When both finish: run gates, commit all, CI, publish
  v0.1.3 with installer + APK + latest.yml + blockmap + checksums. v0.1.3 is the first
  updater-enabled build; future versions can auto-update.
- Macro recorder overhaul is done: repeat, pause/resume/undo, text grouping/capture delays,
  press/hold/release keys, mouse move/scroll/double-click, launch/URL/command steps, and the
  PowerShell `[ushort]` Unicode cast fix. Helper validated with PowerShell 7 on Linux:
  starts, Add-Type compiles, text reaches the Win32 call, scroll math is correct.
- 62 Vitest tests pass; typecheck/build pass. Android pager + hide-bar work delegated.
