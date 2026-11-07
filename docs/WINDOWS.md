# Windows guide

## Install

1. Download `PhoneDeck-x.y.z-Setup.exe` from the latest GitHub Actions **Build** artifact (or a release).
2. Run it. The build is unsigned, so SmartScreen may show a warning: **More info → Run anyway**.
3. On first launch, allow PhoneDeck through **Windows Defender Firewall** for **Private networks**.
4. Turn on **Start PhoneDeck with Windows** in Settings if you want the deck available after login.

The installer uses a per-user NSIS install and creates Desktop/Start Menu shortcuts.
Keep PhoneDeck running while you use the deck; closing the window stops the LAN server.

Installed Windows builds can check GitHub Releases and update themselves from **Settings → Updates**. See [UPDATES.md](UPDATES.md) for the release process and caveats.

## Data locations

Electron stores everything under:

```
%APPDATA%\PhoneDeck\
  config.json          profiles, pages, buttons, actions
  settings.json        port, 4-digit pairing PIN, discovery, autostart
  assets\              imported background images
  phonedek.log         runtime log (rotates at 4 MB)
```

Back up the whole folder to move a setup to another PC. **Settings → Export backup** writes a ZIP with the config and every background image; **Import backup** restores both. Legacy JSON configs still import (without images).

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
- if the PC has VPN/Docker/Hyper-V adapters, open **Pair phone → Advertised host** and pick the Wi-Fi address the phone can reach (or leave it on Automatic),
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
# apps/desktop/release/PhoneDeck-0.1.3-Setup.exe
```

Requirements: Node.js 22+, Windows 10/11. No Visual Studio/native addons are required.

## Macro recorder

- Start at **Add action → Macro → Record**.
- **Capture pauses** turns human pauses into delay steps; **Group typing** turns plain text into one text step (disable it for games that need individual key presses).
- **Pause/Resume** skips a section, **Undo last** removes the most recent step.
- After recording, steps are fully editable: reorder, duplicate, change delays, add mouse moves/scrolls, launch apps, URLs or commands.
- **Repeat macro** runs the step list up to 50 times with an optional gap.
- Key steps can **press & release**, **hold down**, or **release** — useful for drags and held modifiers. A hold-down step must be followed by a release step, or the key stays held.
- Recording captures keys while the PhoneDeck window is focused.

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
- To reset the deck without uninstalling, close PhoneDeck and rename `%APPDATA%\PhoneDeck\config.json`; the app recreates the starter layout. The pairing PIN remains in `settings.json`.
- To revoke phones, use **Pair phone → New PIN**.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
