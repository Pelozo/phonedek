# PhoneDeck 0.16.1

Small hotfix for the new automation/rig build.

## Fixes

- **Adding a Streamer.bot action** no longer inserts an empty action name.
  The draft now starts with a valid `Pick an action` placeholder, so the deck
  stays **Saved** while the action editor opens. Choose the real action before
  pressing the button; pressing the placeholder reports a normal missing-action
  error.
- Fixed singular wording in the rig/profile/page delete confirmations when one
  automation rule references the target.

## Includes from 0.16.0

- Automation rules: OBS/Twitch/process/phone triggers, guards, reference-only
  actions, arm-by-default-off safety, history and the Studio Console Rule
  Library.
- Rig presets with guards, pre-flight, live progress and last-run truth.
- Streamer.bot editor, live keyboard, scroll wheels and What’s New.

## Upgrade notes

- Windows 0.16.0 can auto-update to 0.16.1.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 34. Install over 0.16.0 (same debug key); no Android
  behavior changed beyond the What’s New entry.
