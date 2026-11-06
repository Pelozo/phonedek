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
  (Gradle, Kotlin 2.0.20, Compose 1.7.6, AGP 8.5.2, compileSdk 34).
- Transport: HTTP `GET /api/config`, `/assets/*`; WebSocket `/ws?token=…`; UDP beacon on
  47655 for discovery. Static pairing token + QR deep link `phonedek://pair?…`.
- Config is desktop-owned. Buttons carry ordered action lists; phone executes `page`
  actions locally and sends `press` for the rest. Desktop executes via a persistent
  PowerShell SendInput helper on Windows (xdotool fallback on Linux), native `shell`/`spawn`
  for URL/app/command.
- Tests: Vitest for shared + desktop core (schema, store, protocol, server, executor,
  macro recorder). Gates: `npm test` (51 tests), `npm run typecheck`, `npm run build`.
- CI: GitHub Actions builds Windows installer (electron-builder NSIS) + Android debug APK.
- Button background precedence: `button.background` → `profile.theme.buttonBackground`.
  Page background is the deck background only.

## Phases
- [x] P0. Scaffold, protocol/schema, repo push, agent state
- [x] P1. Shared package: config model, zod schema, defaults, action-plan builder, tests
- [x] P2. Desktop core: config store, assets, WS/HTTP server, pairing, discovery, action executor
- [x] P3. Desktop UI: profile/page editor, grid, button inspector, backgrounds, action editor, macro recorder, pair dialog
- [ ] P4. Android app: pairing/discovery, WS client, Compose deck, backgrounds, cache (subagent in progress)
- [ ] P5. CI green (Windows installer + APK), README/docs, local APK build verification
- [x] P6a. Electron verified under Xvfb (UI, save, QR, macro recorder, popovers)
- [ ] P6b. Polish: host selector in pair dialog, clean screenshots, end-to-end APK test, release workflow
- [ ] P7. Verify Windows installer artifact + firewall/autostart notes

## Current blockers / notes
- Android CI initially failed at `setup-android` installing the removed `tools` package; fixed
  with `packages: platform-tools`. Next failure will be real compilation.
- Windows builder failed on ranged Electron version; pinned `45.2.3` and electron-builder
  `26.18.0`, added `--publish never`.
- Android uses `page.background` as button fallback in `DeckButtonView.kt`; must change to
  `theme.buttonBackground` after the subagent finishes (protocol docs updated).
- CI run 42310609088 in progress.
