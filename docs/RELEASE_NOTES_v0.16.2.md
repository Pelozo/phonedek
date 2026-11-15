# PhoneDeck 0.16.2

Release-pipeline hotfix for 0.16.1. No application behavior changes.

## Fixes

- Stabilized the Twitch auth-gap automation test: it now waits for a real poll
  boundary while disconnected instead of a fixed short sleep. A slow Windows CI
  runner could miss that window, skip the baseline reset and fail the release
  gate.

## Includes from 0.16.1 / 0.16.0

- Streamer.bot action drafts use a valid `Pick an action` placeholder, so
  adding an unconfigured action no longer leaves the deck Unsaved.
- Singular wording fixed in rig/profile/page delete confirmations.
- Automation rules, rigs, Streamer.bot, the live keyboard, scroll wheels and
  What’s New.

## Upgrade notes

- Windows 0.16.0 can auto-update to 0.16.2.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 35. Install over 0.16.0/0.16.1 (same debug key).
