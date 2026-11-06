# PhoneDeck for Android

PhoneDeck turns an Android phone into a wireless Stream Deck for the PhoneDeck
desktop app. The desktop owns the configuration and executes actions; the phone
renders the deck, sends button presses over a LAN WebSocket, and handles page
navigation locally.

- Package: `com.phonedek.app`
- Language/UI: Kotlin + Jetpack Compose, Material 3, forced dark theme
- Minimum Android: 8.0 (API 26), target/compile SDK 34

## Build

Prerequisites:

- JDK 17 or newer (JDK 21 works)
- Android SDK with platform 34, build-tools 34.0.0 and platform-tools
- `local.properties` containing `sdk.dir=/path/to/android-sdk` (gitignored)

```bash
cd apps/android
./gradlew assembleDebug
./gradlew lintDebug
```

The debug APK is written to:

```
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

Install it on a connected phone:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The wrapper currently pins Gradle 8.9. The originally requested Gradle 8.5.2
distribution is no longer served by `services.gradle.org`/the Gradle GitHub
releases (it returns 404), so the closest available wrapper was used. AGP is
still 8.5.2 and Kotlin/Compose are 2.0.20 / BOM 2024.12.01 as specified.

## Pairing

There are three ways to pair:

1. **QR code / deep link** – scanning the desktop's QR code opens
   `phonedek://pair?host=192.168.1.42&port=47654&token=…&name=My%20PC&v=1`.
   The app validates the token by fetching `/api/config` and saves the pairing
   automatically. Cold starts and `onNewIntent` (singleTop) are both handled.
2. **Nearby PCs** – while the pairing screen is visible the app listens on UDP
   47655 and broadcasts a `discover` probe every 2 seconds. Tap a discovered PC
   to fill in its address, then enter the token. If a token was already supplied
   (for example by a deep link), tapping a discovered PC connects immediately.
3. **Manual entry** – host/IP, port (default 47654) and the token shown in the
   desktop app.

The token is validated with `GET /api/config` using
`Authorization: Bearer <token>`. A 401/403, timeout, or unreachable host is shown
inline with a concrete message.

## Using the deck

- The active profile/page grid comes from the desktop config. `slot` is
  row-major; empty slots are blank.
- Button backgrounds support color, angled gradients, and desktop-hosted images
  loaded with Coil (with the bearer token). Overlay scrim, text color, radius,
  font size, grid gap and padding all follow the config, with theme fallbacks.
- Pressing a button gives a scale/ripple animation and haptic feedback. Presses
  are only sent while the WebSocket is connected; otherwise the offline badge is
  visible and the app reports that the action was not sent.
- Page actions (`next`, `prev`, `goto`) run locally and wrap around. A button
  that mixes page and non-page actions still sends one `press` for the rest.
- The status pill shows Connected (green), Connecting/Reconnecting (amber), or
  Offline (red). Tap or long-press the pill, or use the gear, to open settings.
- Settings shows the server, reconnect, change server (forget pairing),
  keep-screen-on and app version.

## Architecture

```
app/src/main/java/com/phonedek/app/
├── MainActivity.kt          edge-to-edge/immersive activity, deep links, lifecycle
├── data/
│   ├── DeckModels.kt        lenient kotlinx.serialization model + normalization
│   ├── PrefsRepository.kt   DataStore Preferences (host/port/token/name/page)
│   └── ConfigCache.kt       raw last-good config JSON in filesDir (offline cold start)
├── net/
│   ├── HttpApi.kt           OkHttp config fetch, typed failures, asset URLs
│   ├── DeckConnection.kt    WebSocket hello/ping/press, reconnect with backoff
│   └── DiscoveryClient.kt   UDP 47655 beacon listener + discover probe
├── ui/
│   ├── MainViewModel.kt     state, pairing, config ingestion, page navigation
│   ├── PairingScreen.kt     manual form + live discovery
│   ├── DeckScreen.kt        grid, page indicator, status pill, empty state
│   ├── DeckButtonView.kt    responsive button rendering + press feedback
│   ├── SettingsSheet.kt     bottom sheet
│   ├── Backgrounds.kt       colors, CSS-angle gradients, token-auth images
│   ├── Theme.kt             deep navy / emerald dark theme
│   ├── Brand.kt             in-app logo
│   └── PhoneDeckApp.kt      root composition + snackbars
└── util/Endpoints.kt        host/host:port/URL input parsing
```

Lifecycle behavior:

- `onStart` starts/reconnects the WebSocket when a server is paired.
- `onStop` disconnects; the last config remains rendered from memory/cache.
- Reconnects use exponential backoff with jitter and refetch `/api/config`.
- Server `hello`, `config`, `pressResult`, `error`, `navigate` and `pong`
  messages are handled. Unknown message types and unknown config fields are
  ignored for forward compatibility.
- The last active profile/page is saved in DataStore and restored if it still
  exists; otherwise the profile default is used.

## Network notes

PhoneDeck is LAN-only. The manifest allows cleartext traffic because the desktop
uses plain `http://` and `ws://` on the local network, and includes
`ACCESS_WIFI_STATE` + `CHANGE_WIFI_MULTICAST_STATE` for discovery. No cloud
services are used.
