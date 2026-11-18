# PhoneDeck 0.19.1

Config integrity hotfix for decks with stale automation references.

## Repair instead of reset

- If `config.json` contains a **rig action**, **rig status binding** or
  **automation rule action** that points at a deleted rig/profile/page, the
  desktop now removes only those unresolved references and validates the rest.
- All other profiles, pages, buttons, controls, actions, settings and assets are
  preserved. Rules left with no actions are dropped; rules with at least one
  valid action remain.
- The original file is copied to `config.repaired-<timestamp>.json` next to the
  repaired `config.json`, and a warning is written to the log.
- Genuine structural corruption, JSON syntax errors or other schema failures
  still go through the existing `config.corrupt-<timestamp>.json` backup and
  starter-deck reset. Reference repair never guesses at unrelated fields.

## Why

A hand-edited config, a partly restored backup or a stale reference can otherwise
make the whole deck look corrupt and reset it. The editor/delete flows already
clean references; this is a last-resort safety net for files that bypassed them.

## Includes from 0.19.0

- Android Quick Settings tile for a chosen host-action/rig button.
- Cross-platform macro capture and mouse recording, older-desktop export, rigs,
  automation rules, Streamer.bot, live keyboard, scroll wheels and What’s New.

## Upgrade notes

- Windows 0.19.0 can auto-update to 0.19.1.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 39. No Android behavior changed beyond the What’s New
  entry; install over 0.19.0 (same debug key).
