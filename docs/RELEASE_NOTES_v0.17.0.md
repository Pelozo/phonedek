# PhoneDeck 0.17.0

Legacy deck export, plus a README refresh for the automation era.

## Export for older desktops

Rigs and event rules are additive for new phones, but a desktop older than
0.15/0.16 rejects `type:'rig'` as a corrupt config. **Settings → Backup →
Export for older desktop** now writes a valid PhoneDeck JSON deck with:

- all rigs removed;
- all automation rules removed;
- every rig run action and rig status binding removed;
- rig-only tiles removed (their slots become empty cells);
- profiles, pages, normal buttons, controls, backgrounds and non-rig actions
  left untouched.

The export is schema-validated before writing and reports how many items were
removed. Import that JSON on the older PC; keep a full ZIP backup for the new
machine.

## Docs and reliability

- README refreshed with Rigs, Automation rules, Streamer.bot, What’s New, the
  direct phone keyboard and current compatibility/safety notes; new rig,
  automation and Streamer.bot screenshots.
- Successful-path Nanoleaf tests use the production timeout, avoiding a
  loaded-runner release flake. No runtime behavior change.

## Includes from 0.16.2

- Streamer.bot action placeholder fix (no more Unsaved deck when adding an
  unconfigured action).
- Singular delete-confirmation copy fixes.
- Rig presets, automation rules, live keyboard, scroll wheels and What’s New.

## Upgrade notes

- Windows 0.16.x can auto-update to 0.17.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 36. No Android behavior changed beyond the What’s New
  entry; install over 0.16.2 (same debug key).
