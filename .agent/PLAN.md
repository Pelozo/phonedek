# Plan: PhoneDeck — Android phone as a wireless Stream Deck for Windows

Two apps:
1. **Desktop (Electron, Windows-first)** — configure profiles, pages, grid size/quantity,
   button backgrounds/labels/icons, and actions (hotkeys, text, macros, launch app, URL,
   command, media keys). Hosts a LAN HTTP+WebSocket server so the phone can fetch config and
   send presses. Executes actions on the Windows host.
2. **Android (Kotlin + Jetpack Compose)** — pairs over LAN (QR deep link / manual / UDP
   discovery), renders the live deck fullscreen, sends presses, caches config offline.

## Architecture (decided)
- Repo: https://github.com/Pelozo/phonedek (public). Local git metadata lives in
  `/tmp/phonedek.git` because the NTFS workspace rejects chmod; use
  `git --git-dir=/tmp/phonedek.git --work-tree=$PWD`.
- Monorepo: `apps/desktop` (Electron + Vite + React + TS), `packages/shared` (types, zod
  schema, defaults, action-plan builder, macro recorder helpers, tests), `apps/android`
  (Gradle 8.9, Kotlin 2.0.20, Compose 1.7.6, AGP 8.5.2, compileSdk 34).
- Transport: HTTP `GET /api/config`, `/assets/*`; WebSocket `/ws?token=…`; UDP beacon on
  47655 for discovery. Static pairing token + QR deep link `phonedek://pair?…`.
- Config is desktop-owned. Buttons carry ordered action lists; phone executes `page`
  actions locally and sends `press` for the rest. Desktop executes via a persistent
  PowerShell SendInput helper on Windows (xdotool fallback on Linux), native `shell`/`spawn`
  for URL/app/command.
- Tests: Vitest for shared + desktop core (schema, store, protocol, server, executor,
  macro recorder). Gates: `npm test` (51 tests), `npm run typecheck`, `npm run build`.
- CI: GitHub Actions builds Windows installer (electron-builder NSIS, x64) + Android
  debug APK and runs `lintDebug`. Both jobs green as of run 42312952202.
- Button background precedence: `button.background` → `profile.theme.buttonBackground`.
  Page background is the deck background only (fixed on Android too).

## Phases
- [x] P0. Scaffold, protocol/schema, repo push, agent state
- [x] P1. Shared package: config model, zod schema, defaults, action-plan builder, tests
- [x] P2. Desktop core: config store, assets, WS/HTTP server, pairing, discovery, action executor
- [x] P3. Desktop UI: profile/page editor, grid, button inspector, backgrounds, action editor, macro recorder, pair dialog
- [x] P4. Android app: pairing/discovery, WS client, Compose deck, backgrounds, cache (APK built in CI)
- [x] P5. CI green (Windows installer + APK + lint), README/docs, screenshots
- [x] P6a. Electron verified under Xvfb (UI, save, QR, macro recorder, popovers)
- [x] P6b. Polish: pair refresh, deck name setting, clean screenshots, Android lint gate
- [x] P7. Published GitHub release v0.1.0, then superseded by v0.1.1 (host selector, ZIP backups, Android socket fix)

## Open items / next session
- [x] Create release v0.1.1 with latest CI artifacts (installer + debug APK + SHA256SUMS).
- If the Android subagent reports further edits, review and run CI again.
- Optional: app icon polish, signed release APK, Windows code signing, host selector for
  multi-NIC PCs, global macro recording hook, config export with assets (zip).
- User manual test on Windows + Android; collect feedback.
