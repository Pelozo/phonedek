# Android guide

## Requirements

- Android 8.0 (API 26) or newer.
- Same Wi-Fi/LAN as the desktop. Guest networks with client isolation will not work.
- The desktop app running and reachable.

## Build

From the repo root:

```bash
cd apps/android
./gradlew assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

Or open `apps/android` in Android Studio (Ladybug or newer), let Gradle sync, and press Run.

Requirements: JDK 17/21, Android SDK Platform 34, Build-Tools 34.0.0. The project uses Gradle 8.9, AGP 8.5.2, Kotlin 2.0.20 and Compose.

On **arm64 Linux** hosts the Android SDK ships an x86_64 `aapt2`, which needs binfmt/qemu; the GitHub Actions x64 runner is the simplest way to build the APK. Windows and x86_64 Linux build natively.

## Install the APK

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or copy the APK to the phone and open it (allow “Install unknown apps” for the file manager/browser you use).

Debug builds use the committed `apps/android/debug.keystore` (standard debug credentials, not a secret) so every CI build has the same signature and APKs can update each other. That is fine for personal use; create a private release keystore before distributing on a store.

## Pair

### Recommended: QR

1. Desktop → **Pair phone**.
2. Scan the QR with the normal Android camera app.
3. The `phonedek://pair?...` link opens PhoneDeck and connects.

The QR contains the host, port and 4-digit pairing PIN. Treat it like a password.

### Manual

1. Desktop → **Pair phone** shows host, port and PIN.
2. Android → **Add server manually**.
3. Enter the details and connect.

### Discovery

While the pairing screen is open, the phone listens for desktop UDP beacons on 47655 and sends probes. Tap a discovered PC, then enter the PIN (discovery never broadcasts the PIN).

## Using the deck

- The app runs fullscreen/immersive and keeps the screen on (toggle in settings).
- Buttons are laid out by the desktop grid (`slot` is row-major).
- Page buttons (next/prev/goto) are handled locally; other actions are sent to the PC.
- The status pill shows **connected**, **reconnecting** or **offline**.
- Long-press the pill (or the gear) for: server info, reconnect, change server, keep screen on, app version.
- The last config is cached, so the deck is still visible while the PC is offline.

## Permissions

- `INTERNET` — LAN HTTP/WebSocket.
- `ACCESS_WIFI_STATE` / `CHANGE_WIFI_MULTICAST_STATE` — UDP discovery.
- `WAKE_LOCK` — keep the screen on while the deck is active.
- Cleartext HTTP is allowed because the desktop server is LAN-only and has no TLS.

No camera permission is needed: pairing uses the system camera app + deep link, not an in-app scanner.

## Debug tips

Simulate a pairing deep link:

```bash
adb shell am start -a android.intent.action.VIEW \
  -d 'phonedek://pair?host=192.168.1.42&port=47654&token=4821&v=1'
```

Check connectivity from the phone:

```bash
adb shell curl http://192.168.1.42:47654/api/info
```

(If `curl` is missing, use `toybox wget` or the desktop log to see whether a connection arrived.)

Diagnostics in the app:

- **Settings → Diagnostics / logs** (and the link at the bottom of the pairing screen) shows the last 40 pairing/network events, with **Copy** for sharing.
- The same lines go to logcat with tag `PhoneDeck`:

```bash
adb logcat -s PhoneDeck
```

PINs and tokens are redacted/length-only in these logs.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
