# PhoneDeck

[![Build](https://github.com/Pelozo/phonedek/actions/workflows/build.yml/badge.svg)](https://github.com/Pelozo/phonedek/actions/workflows/build.yml)

**Turn an Android phone into a wireless Stream Deck for your Windows PC or Mac.**

PhoneDeck is two apps that work together:

| App | Platform | What it does |
| --- | --- | --- |
| **PhoneDeck Desktop** | Windows 10/11 · macOS 12+ Apple Silicon (unsigned preview) | Owns the configuration, hosts a LAN server, records macros, and executes shortcuts/app launches/commands on the computer. |
| **PhoneDeck Android** | Android 8+ (Kotlin/Compose) | Renders the deck fullscreen, pairs over Wi-Fi, sends presses, and handles page navigation instantly. |

No cloud, no account, no vendor lock-in: the phone talks directly to your PC over the local network.

![PhoneDeck desktop editor](docs/screenshots/editor.png)

<p align="center"><img src="docs/screenshots/pairing.png" width="82%" alt="Pairing dialog with QR code" /></p>

```
┌──────────────────────────┐        Wi-Fi / LAN         ┌──────────────────────────┐
│  Android phone           │  HTTP config + WebSocket   │  Windows PC / Mac        │
│  - fullscreen deck       │ ◄────────────────────────► │  - deck editor           │
│  - QR pairing            │      button presses        │  - macro recorder        │
│  - offline config cache  │                            │  - action executor       │
└──────────────────────────┘                            └──────────────────────────┘
                                                                  │
                                                     SendInput / app launch /
                                                     URL / shell command
                                                                  ▼
                                                            Desktop apps
```

## Features

### Deck editor

- **Profiles and pages** — multiple PCs/layouts, up to 20 pages per profile, instant page switching.
- **Any grid you want** — 1×1 to 10×10 cells; buttons snap to slots; drag to rearrange or swap.
- **Buttons** — label, sublabel, 130+ categorized emoji icons (or paste your own), solid/gradient/image background, dark overlay, custom text color, per-button radius.
- **Backgrounds** — curated gradients, color presets, or import your own PNG/JPG/WEBP/GIF/BMP (up to 25 MB). Images are copied into the app's data folder and served to the phone.
- **Live preview** — the editor canvas is the same grid the phone renders, including slots and overflow warnings.
- **Backups** — export/import a ZIP containing the config and every background image; legacy JSON configs still import.
- **Instant sync** — every saved change is pushed to connected phones over WebSocket.

### Actions

- **Shortcuts** — Ctrl+C, Win+Shift+S, Alt+Tab, media keys, F-keys, punctuation…
- **Macros** — record chords, typing and pauses with pause/resume/undo; choose whether pauses and text grouping are captured; repeat a macro 1–50× with a gap; edit/reorder/duplicate steps; mouse click, double-click, hold, release, move and scroll; launch/URL/command steps; keys can press, hold or release.
- **Type text** — full Unicode text typed into the active window.
- **Launch applications** — pick an `.exe`, `.lnk`, `.bat` or `.cmd`, with arguments.
- **Open URLs** — http/https only.
- **Run commands** — run a command with your Windows user (clearly marked as trusted-only).
- **Media keys** — play/pause, next/prev, stop, volume up/down, mute.
- **Page navigation** — next/previous/goto, executed on the phone with no round-trip.
- Chain any number of actions on one button and test them from the editor.

### Pairing and networking

- **QR pairing** — scan with the normal camera app; the `phonedek://pair?...` deep link opens the app and connects.
- **LAN discovery** — desktop beacons over UDP; the phone lists available PCs automatically.
- **4-digit PIN auth** — every HTTP/WebSocket request needs the pairing PIN; generate a new PIN to revoke all phones. Wrong PINs are rate-limited.
- **Offline cache** — the phone keeps the last config and can render while the PC is asleep/offline.
- **Auto-reconnect** with backoff, heartbeat, and a clear connection status.

## Quick start (Windows)

> The easiest path is the [latest release](https://github.com/Pelozo/phonedek/releases/latest) or a GitHub Actions artifact. Every push builds a Windows installer, a macOS arm64 DMG/ZIP, and a debug APK.

1. Open the **Actions** tab → latest **Build** run → download:
   - `PhoneDeck-Windows` (installer `.exe`)
   - `PhoneDeck-macOS-arm64` (unsigned `.dmg` / `.zip`)
   - `PhoneDeck-Android` (`app-debug.apk`)
2. Run the installer. Windows SmartScreen may warn because the build is unsigned — choose **More info → Run anyway**.
3. Allow PhoneDeck through **Windows Defender Firewall** for **Private networks** when prompted.
4. Install the APK on Android (enable “Install unknown apps” for your file manager if needed).
5. In PhoneDeck Desktop press **Pair phone**. On Android, scan the QR with the camera app, or add the host/port/PIN manually.
6. Press a button. Done.

### Manual pairing

The desktop shows:

- host (for example `192.168.1.42`)
- port (`47654` by default)
- PIN (4 digits)
- pairing link / QR

The phone and PC must be on the same Wi-Fi. Guest networks with client isolation will not work.

## Build from source

### Desktop

Requirements: **Node.js 22+**, npm. Final apps: Windows 10/11 x64 or macOS 12+ Apple Silicon (unsigned arm64 DMG). Development also works on Linux for the UI; Linux key injection uses xdotool.

```bash
npm install
npm run dev        # Electron + Vite dev server
npm test           # shared + desktop core tests (Vitest)
npm run typecheck
npm run build
npm run dist:win   # NSIS installer in apps/desktop/release
```

On macOS, build the CGEvent helper before packaging: `npm run build:mac-helper -w @phonedek/desktop`, then `npm run dist:mac -w @phonedek/desktop`. The first app launch requires **Accessibility** permission; see [docs/MACOS.md](docs/MACOS.md).

On Linux, `npm install` may need a filesystem that supports `chmod` (avoid NTFS/FUSE mounts for `node_modules`).

### Android

Requirements: JDK 17/21 + Android SDK 34 (platform + build-tools 34.0.0).

```bash
cd apps/android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or open `apps/android` in Android Studio and run it.

## Macro options

Macros are built from ordered steps:

- shortcut (press & release, hold down, or release)
- type text
- delay
- media key
- mouse click / double-click / hold / release / move / scroll
- launch app, open URL, run command

Recording options: capture pauses as delays, group typing into text steps (turn off for game inputs), pause/resume, undo the last step, repeat the macro up to 50× with a per-repeat delay.

## How actions execute

The desktop keeps a persistent PowerShell helper (`resources/keyboard-helper.ps1`) that calls Win32 `SendInput`:

- chords are pressed/released in order,
- text is sent as Unicode (no clipboard pollution),
- media keys and mouse clicks use virtual-key/mouse events,
- `launch`, `url`, and `command` are executed by Electron's main process.

If the helper fails, the action result (and a hint) is shown on the phone and written to `phonedek.log` (Settings → Open logs).

## Security model

PhoneDeck is a LAN tool, not an internet service.

- The HTTP/WebSocket server binds `0.0.0.0` and requires the 4-digit pairing PIN (rate-limited after 6 wrong attempts per minute).
- Discovery beacons contain only the server name and port — never the PIN.
- The QR code contains the PIN, so treat a screenshot of it like a password.
- **Run command** and **Launch app** actions execute with your Windows account. Only import configs you trust.
- Generate a new PIN in **Pair phone** to disconnect every phone immediately.
- There is no TLS: do not expose the port to the internet or to untrusted networks. Use a firewall rule limited to Private networks.

## Repository layout

```
apps/
  desktop/          Electron main + preload + React configurator
  android/          Kotlin + Jetpack Compose deck app
packages/
  shared/           Config model, Zod schema, action planner, macro recorder, tests
docs/
  PROTOCOL.md       HTTP + WebSocket + discovery + config contract
  ARCHITECTURE.md   Design notes
  WINDOWS.md        Build, firewall, packaging, troubleshooting
  ANDROID.md        Build/install/pairing notes
```

## Diagnostics

- **Android:** Settings → Diagnostics / logs (also available from the pairing screen) shows the last pairing/network events and has **Copy**. Or use `adb logcat -s PhoneDeck`.
- **Windows:** Settings → Open logs (`%APPDATA%\PhoneDeck\phonedek.log`).

## macOS (unsigned preview)

> **Long-term:** the seamless path is Developer ID signing + notarization; the
> build pipeline is ready for it (see [docs/MACOS.md](docs/MACOS.md)). Unsigned
> previews need a one-time permission step per build.

1. Download `PhoneDeck-0.1.4-arm64.dmg` from the release and drag PhoneDeck to **Applications**.
2. Gatekeeper: right-click the app → **Open**, or use **System Settings → Privacy & Security → Open Anyway**.
3. Grant **input control** for key/mouse actions. PhoneDeck shows a banner with a
   **Grant permission** button that opens the native macOS prompt. The pane is
   **System Settings → Privacy & Security → Accessibility**, renamed **Device
   Control and Data Access** on macOS 27. If the switch alone doesn't stick, add
   `/Applications/PhoneDeck.app/Contents/MacOS/PhoneDeck` as a file — Settings →
   Input permission has **Show app file** and **Copy** for it. Allow **Local
   Network** on macOS 15+ for pairing/discovery.
4. Pair with the 4-digit PIN or QR exactly like Windows.

The macOS build is unsigned and arm64-only; in-app auto-update is disabled there until Developer ID signing/notarization. See [docs/MACOS.md](docs/MACOS.md).

## Manual testing

A step-by-step checklist is in [docs/TESTING.md](docs/TESTING.md). The current preview is published at [v0.1.4](https://github.com/Pelozo/phonedek/releases/tag/v0.1.4).

## Status

Early but usable. The core editor, protocol, action execution, Android rendering and pairing are implemented.

## License

MIT © 2026 Pelozo
