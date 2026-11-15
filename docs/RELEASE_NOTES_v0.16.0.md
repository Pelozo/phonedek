# PhoneDeck 0.16.0

Automation rules: trigger rigs, profiles and pages from OBS, Twitch, process
and phone state changes.

## Rule library

- **Sidebar → 05 AUTOMATION** opens the Studio Console Rule Library.
- Create up to 32 rules. Each has a **WHEN** trigger, **ONLY IF** conditions,
  up to 4 ordered **DO** actions, and timing controls.
- Triggers:
  - OBS streaming / recording / replay buffer started or stopped;
  - OBS program scene changed;
  - Twitch went live / offline;
  - process started / stopped (normalized basename, no `.exe`);
  - phone connected / disconnected.
- Conditions reuse the rig guard vocabulary: OBS state, Twitch live, mic muted,
  app running and light on. Unavailable checks fail closed.
- Actions are **references only**: run a rig, show a profile, show a page, or
  post a notice when that capability ships. A rule never contains its own
  command, launch or key action.
- **Check** evaluates references and conditions without running anything;
  **FIRE NOW** bypasses timing but still checks conditions. History shows the
  last 50 in-memory runs with status, failures and duration.

## Safety

- **Automation is disarmed by default on every PC.** Rules are saved with the
  deck but do nothing until you press **ARM AUTOMATION**. Importing a deck
  force-disarms it on the new PC.
- Edges, not levels: the first observation after arming/reconnect is a silent
  baseline. OBS disconnects never synthesize an `offline` edge. Adding a
  process rule for an app that is already running does not fire it.
- Debounce (default 1.5 s), per-rule cooldown (default 10 s), a 12/min storm
  brake, and a 4 s post-run settle window prevent accidental bursts and loops.
- One rig runs at a time. A rule whose rig is busy is recorded as `busy` and
  skipped unless the rule says **Continue with other actions**.
- Rules keep running with zero phones. A phone that reconnects after an
  automation profile switch receives the chosen profile.

## Compatibility

- Config schema stays v1; `rules` is additive. Old phones ignore it and keep
  working. Profiles/pages/rigs selected by automation use existing messages.
- An old desktop strips `rules` on its next save (no corrupt reset), so rules
  are lost on downgrade; remove automation before downgrading.
- Rules reference rigs/profiles/pages; deleting a target stays visible as a
  dangling reference and the rule is inert until fixed.

## Includes from 0.15.0

- Rig presets with guards, pre-flight, live progress and last-run truth.
- Streamer.bot settings and action editor.
- Live keyboard, scroll wheels, What’s New and the Windows helper hotfix.

## Upgrade notes

- Windows 0.15.x can auto-update to 0.16.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 33. No new Android UI is required for rules; the
  phone reacts to the resulting profile/page/rig changes.
