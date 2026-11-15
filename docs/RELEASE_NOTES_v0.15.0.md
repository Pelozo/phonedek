# PhoneDeck 0.15.0

Rigs: reusable, guarded action sequences that run as one deck press.

## Rig presets

- **Sidebar → 04 RIGS** opens the Studio Console Rig library. Create up to 16
  named rigs with 1–32 steps and up to 8 guards.
- A step can use any host action: shortcuts, text, macros, launch/URL/command,
  OBS, Twitch, local lights, audio/mic, per-app volume and Streamer.bot.
- Per-step delay (0–10 s), continue-on-error, reorder/delete, labels and an icon.
- Templates for **Go live**, **BRB** and **Wrap** start from generic safe steps.

## Guards and execution

- Guards run before step 1: OBS streaming/recording, Twitch live, mic muted,
  app running (2 s process snapshot) and light on. `is`/`is not` is supported.
- Unavailable or timed-out probes **fail closed**; the run reports `BLOCKED`
  with the exact guard.
- One rig runs at a time. A second request returns `BUSY` with the active rig
  and progress. A rig occupies one desktop executor slot, so ordinary presses
  queue behind it.
- Fail-fast (default) stops at the first failed step; continue mode reports
  `PARTIAL` and every failed step. A 120 s deadline (configurable) stops before
  the next step; **Stop** aborts between steps.
- Nothing rolls back. The report says exactly where the run stopped.

## Truth on the deck

- A rig button shows `RIG`, then live `n/total` with an orange edge, then
  `OK`/`PARTIAL`/`FAILED`/`BLOCKED`/`STOPPED`/`TIMEOUT` for 800 ms.
- A status source shows last-run truth through `control-state-v1`
  (`READY`, `3/9`, `RUN 2m`, `PARTIAL`, `FAILED`, `BLOCKED`, `STOPPED`,
  `TIMEOUT`, `NO RIG`). It never claims the world matches the rig.
- New phones advertise `rig-v1` and receive progress only for the current
  page/button. Old phones run a rig as an ordinary press and get the final
  toast; the deck still works.
- The desktop Rig library has **Check** (guard pre-flight), **Run**, **Stop**
  and an inline failure report. Destructive steps ask for confirmation.

## Compatibility

- Config schema stays v1; `rigs` is additive. Old phones ignore it.
- An **old desktop** will reject a config containing rig actions (it treats the
  unknown action as corrupt). Remove rig buttons before downgrading; a
  strip-for-old-desktop export is a future follow-up.
- Backups and imports carry rigs. Command/launch steps inside rigs are included
  in the import risk count.

## Includes from 0.14.0 / 0.13.2

- Streamer.bot settings + action picker/arguments/test.
- Live keyboard, scroll wheels, What’s New, and the Windows helper hotfix.

## Upgrade notes

- Windows 0.14.x can auto-update to 0.15.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 32. Install over 0.14.0 (same debug key).
