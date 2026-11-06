# State

- 2026-11-06: PhoneDeck project started. Repo https://github.com/Pelozo/phonedek.
- Local git metadata is in `/tmp/phonedek.git` (NTFS workspace cannot chmod). Use:
  `git --git-dir=/tmp/phonedek.git add -A` etc.
- Desktop implementation complete and exercised under Xvfb:
  - app starts, serves LAN HTTP/WS on 47654, discovery on 47655
  - config save persists to `~/.config/PhoneDeck/config.json`
  - editor, inspector, add-action popover, pair QR dialog, macro recorder all verified
  - version shows 0.1.0 (dev fallback constant)
- Gates: typecheck OK; 51 Vitest tests OK; production build OK.
- CI: fixed setup-android (`tools` removed) and electron-builder exact Electron version.
  Latest run 42310609088 watching (desktop + android).
- Android: subagent session `ses_e4cf99e72ffen0aq1xsuJgWb94` in background; files exist,
  APK not yet verified. Do NOT edit `apps/android/**` until it reports.
- Known Android mismatch: `DeckButtonView.kt` uses `page.background` as button fallback;
  should be `theme.buttonBackground`. Fix after subagent.
- Next actions:
  1. When CI finishes: inspect desktop artifact + Android compile errors.
  2. When Android subagent finishes: run `./gradlew assembleDebug`, fix the background
     precedence, test deep link + deck against the running desktop.
  3. Add clean screenshots to `docs/screenshots/` and link from README.
  4. Optional: host selector in Pair dialog for multi-NIC PCs; release workflow.
