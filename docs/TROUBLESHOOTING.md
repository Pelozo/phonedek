# Troubleshooting

## The phone cannot connect

1. Confirm the desktop is listening: **Pair phone** should say “Listening on port …”.
2. Open `http://<host>:<port>/api/info` from another device on the same Wi-Fi. It must return JSON without a token.
3. Windows: allow PhoneDeck on **Private** networks. Public-network profiles block inbound connections by default.
4. Check for VPNs, virtual adapters, or a Wi-Fi guest network with **client isolation**.
5. If the token was rotated, rescan the QR code.
6. If the port is busy, change it in **Pair phone → Apply** (1024–65535).

## Discovery does not find the PC

- Discovery needs UDP **47655**; some routers/APs drop broadcasts.
- Use the QR code or manual host/port/token instead — it is the most reliable option.
- Windows Firewall may allow TCP but block UDP; check both.
- Multiple PCs: the phone lists every beacon it hears.

## A button does nothing

- The status pill must be green (connected). Offline presses are not sent.
- Open the button in the editor and make sure it has actions (`Run all actions on this PC` tests them immediately).
- **Shortcuts / text / media**: check **Settings → Open logs** for keyboard-helper errors.
- **Target app runs as Administrator**: Windows UIPI blocks input from a non-elevated app. Run PhoneDeck as Administrator as well.
- **Launch app / URL / command**: the log shows spawn errors. Use an absolute path for apps not on `PATH`.
- **Command** actions run with your user account; antivirus/policy may block them.
- **Games with anti-cheat** may ignore synthetic input. PhoneDeck uses the standard Windows `SendInput` API (no driver), so competitive games that block automation will not respond.

## Keyboard helper does not start

Symptoms: key/text/media actions return an error mentioning PowerShell or the helper.

- Ensure PowerShell 5.1 (`powershell.exe`) is available.
- Antivirus/EDR may block `-ExecutionPolicy Bypass` scripts. Allow the installed `keyboard-helper.ps1` or the PhoneDeck process.
- The helper path is `<install dir>\resources\keyboard-helper.ps1`; reinstalling restores it.
- Logs: `%APPDATA%\PhoneDeck\phonedek.log`.

## Config does not save

- The top bar shows **Unsaved** with the first validation error in a toast.
- Common causes: an empty URL, a “goto page” action with no page selected, or an empty app path.
- Fix the field; saving retries automatically after 320 ms.
- Corrupt `config.json`: the app writes a backup (`config.corrupt-<timestamp>.json`) and restores the starter deck. Restore your backup if needed.

## The phone shows an old layout

- The desktop pushes config over WebSocket instantly. If the phone is offline, it shows its cache.
- Reconnect (settings sheet → Reconnect) or restart the app.
- Make sure you saved in the editor (**Saved** badge).

## Background image is missing

- Imported images live in `%APPDATA%\PhoneDeck\assets\` and are referenced by file name.
- Exporting the JSON does not include images; copy the `assets` folder or re-import after moving to another PC.
- The phone must keep the token to load `/assets/...`.

## Build errors

### Desktop

- Use **Node.js 22+** (`node -v`). Electron 45 tooling requires it.
- On Linux, `node_modules` must live on a filesystem that supports `chmod`. NTFS/exFAT/FUSE mounts (like some shared folders) fail during `npm install`.
- `electron-builder` on Linux needs Wine for NSIS; use the GitHub Actions workflow or build on Windows.

### Android

- Use JDK 17 or 21 and Android SDK **Platform 34** + **Build-Tools 34.0.0**.
- If `./gradlew` is not executable: `chmod +x gradlew`.
- If Gradle cannot find the SDK, set `ANDROID_HOME` or create `apps/android/local.properties` with `sdk.dir=...`.
- CI uses Gradle 8.5.2; do not bump AGP/Kotlin independently without checking compatibility.

## Reset everything

- Desktop config: close the app, rename `%APPDATA%\PhoneDeck\config.json`.
- Pairing/ports/autostart: rename `%APPDATA%\PhoneDeck\settings.json` (new token is generated).
- Android pairing: in the app, **Change server** clears host/port/token; or clear app storage in Android settings.
