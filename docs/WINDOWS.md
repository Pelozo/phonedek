# Windows guide

## Install

1. Download `PhoneDeck-x.y.z-Setup.exe` from the latest GitHub Actions **Build** artifact (or a release).
2. Run it. The build is unsigned, so SmartScreen may show a warning: **More info → Run anyway**.
3. On first launch, allow PhoneDeck through **Windows Defender Firewall** for **Private networks**.
4. Turn on **Start PhoneDeck with Windows** in Settings if you want the deck available after login.

The installer uses a per-user NSIS install and creates Desktop/Start Menu shortcuts.
Keep PhoneDeck running while you use the deck; closing the window stops the LAN server.

## Data locations

Electron stores everything under:

```
%APPDATA%\PhoneDeck\
  config.json          profiles, pages, buttons, actions
  settings.json        port, pairing token, discovery, autostart
  assets\              imported background images
  phonedek.log         runtime log (rotates at 4 MB)
```

Back up the whole folder to move a setup to another PC. **Settings → Export** writes the JSON only; copy `assets\` alongside it if you use image backgrounds.

## Firewall / port

- Default port: **47654** (TCP). Discovery uses **47655/UDP**.
- If port 47654 is busy, change it in **Pair phone → Apply**. The QR code and URLs update automatically.
- Quick health check from another machine:

```powershell
curl http://192.168.1.42:47654/api/info
# {"app":"PhoneDeck","protocol":1,...}
```

If this fails:

- allow the app on **Private** networks,
- make sure both devices are on the same subnet,
- disable VPN split tunnelling temporarily,
- check that the Wi-Fi is not a guest network with client isolation.

## Build from source

```powershell
git clone https://github.com/Pelozo/phonedek.git
cd phonedek
npm ci
npm run dev
```

Production build + installer:

```powershell
npm run build
npm run dist:win
# apps/desktop/release/PhoneDeck-0.1.0-Setup.exe
```

Requirements: Node.js 22+, Windows 10/11. No Visual Studio/native addons are required.

## Keyboard helper

PhoneDeck launches `resources/keyboard-helper.ps1` using the system PowerShell (`-ExecutionPolicy Bypass`). It:

- compiles a C# `SendInput` wrapper on first start,
- reads JSON commands from stdin,
- sends chords, Unicode text, media keys and mouse events,
- returns `{ok:true}` / `{ok:false,error}` per command.

The helper is copied into `resources\keyboard-helper.ps1` inside the installed app. If it is blocked by antivirus or PowerShell is unavailable, buttons with key/text/media actions fail while URL/app/command actions keep working. Check **Settings → Open logs**.

### Elevated apps

Windows UIPI prevents a normal process from sending input to an elevated (Administrator) window. To control those apps, run PhoneDeck as Administrator. The tray/startup path must then also be elevated.

## Uninstall / reset

- Uninstall from **Settings → Apps** (or the Start Menu uninstaller).
- To reset the deck without uninstalling, close PhoneDeck and rename `%APPDATA%\PhoneDeck\config.json`; the app recreates the starter layout. Pairing tokens remain in `settings.json`.
- To revoke phones, use **Pair phone → Rotate token**.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
