# PhoneDeck 0.14.0

Streamer.bot actions, configured from the desktop and triggered from the deck.

## Streamer.bot

- **Settings → Integrations → Streamer.bot**: enable the local WebSocket client,
  set the host/port, and store the password encrypted on the PC. The password is
  write-only and never returned to the renderer or sent to the phone.
- Live connection status, instance name/version and action count. Test
  connection saves the current host/port and makes a fresh attempt.
- **Add button → Integrations → Streamer.bot action**: pick from the live
  GetActions list (searchable and grouped) or type an exact name when Streamer.bot
  is offline. Disabled actions are labelled.
- Up to 16 arguments per action. Each value is exposed to Streamer.bot as
  `%name%`, args are visible in the editor, and duplicates are rejected.
- **Test action** sends the action once from the editor. A deck press sends the
  same action from the phone through the desktop.
- The `streamerbot-v1` capability is advertised only while the local client is
  connected, so old phones hide the tile state cleanly.

## Includes from 0.13.2

- Live phone keyboard: one full QWERTY panel, key down/up on press, held or
  latched Shift/Ctrl/Alt, Tab hold, Backspace/arrow repeats, FN and PASTE.
- What’s New after an update on desktop and Android.
- Scroll controls render as wheels; horizontal wheels follow left/right drags.
- Windows input-helper hotfix from 0.13.1.

## Upgrade notes

- Windows 0.13.x can auto-update to 0.14.0.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android APK versionCode 31. Install over 0.13.2 (same debug key).
- Streamer.bot: enable its WebSocket server under Servers/Clients → HTTP Server
  (default port 8080). PhoneDeck connects to `127.0.0.1` by default.
