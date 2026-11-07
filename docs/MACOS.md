# macOS support

Status: **implemented as an unsigned Apple Silicon (arm64) build.** This is a
usable community build with full action parity, but it is not a signed or
notarized App Store-style release. The `macos` job in
`.github/workflows/build.yml` is authoritative for compiling Swift and packaging
the DMG/ZIP; Linux development machines cannot build or test those steps.

## What works

- Config editor, assets, backups, LAN HTTP/WS, UDP discovery, QR pairing and the
  Android protocol are platform-neutral and unchanged.
- Hotkeys, held keys, Unicode text, delays, media keys and mouse actions are
  injected by a persistent Swift helper (`CGEvent`), not AppleScript.
- Launch/URL/command actions work. macOS `.app` bundles are launched with
  `/usr/bin/open -a <app> --args ...`, so arguments are preserved.
- A native application menu provides Cmd+C/V/X/A/Z, window management and
  Cmd+Q. Closing the last window keeps PhoneDeck (and the deck server) alive in
  the dock; clicking the dock icon or launching again reopens it.
- Launch at login uses Electron's macOS login-item support.
- `PhoneDeck-<version>-arm64.dmg` and `.zip` are produced, with
  `latest-mac.yml` and blockmaps for the update feed.

## Files

| File | Purpose |
| --- | --- |
| `apps/desktop/resources/mac/keyboard-helper.swift` | JSONL helper: CGEvent keys/text/media/mouse, Accessibility check. |
| `apps/desktop/scripts/build-mac-helper.sh` | `swiftc` arm64 build; `universal` uses `lipo`. Not committed as a binary. |
| `apps/desktop/src/main/key-sender.ts` | Shared persistent helper sender + `MacKeySender`; maps permission errors to actionable text. |
| `apps/desktop/scripts/after-pack.cjs` | Ad-hoc signs the main executable and helper with stable identifiers so TCC matches the grant. |
| `apps/desktop/src/main/platform.ts` | Tested packaged/dev helper paths for Windows and macOS. |
| `apps/desktop/src/main/index.ts` | Helper prewarm, macOS menu, Accessibility settings action, dock/window lifecycle. |
| `apps/desktop/src/main/host-actions.ts` | `open -a … --args …` for macOS application bundles. |
| `apps/desktop/src/main/updater.ts` | Unsigned macOS build reports manual updates instead of using Squirrel.Mac. |
| `apps/desktop/electron-builder.yml` | arm64 DMG+ZIP, helper resource, unsigned identity, local-network description. |
| `.github/workflows/build.yml` | `macos-latest` arm64 job: helper build/self-test, tests, typecheck, build, package, artifact verification. |

## Helper protocol

The Swift helper uses the same line protocol as `keyboard-helper.ps1`:

```json
{"id":"1","steps":[{"kind":"keys","keys":["CTRL","C"],"holdMs":35}]}
{"id":"1","ok":true}
```

Failures are `{"id":"1","ok":false,"error":"…","permission":"accessibility"}`
when permission is the cause. Startup emits `{"ready":true}` only after setup;
commands re-check `AXIsProcessTrusted()` so granting permission does not require
restarting PhoneDeck. `--self-test` validates the key table without injecting
input, and `--check` prints Accessibility status. CI runs `--self-test`.

Behavior details:

- Canonical `WIN` maps to **Command**, `ALT` to **Option**, `CTRL` to
  **Control**; `SHIFT` is unchanged. Chords post modifiers around the base key.
- `press`, `down` and `up` are implemented; held modifiers survive across
  actions, and held keys are released on stdin EOF.
- Text uses `CGEventKeyboardSetUnicodeString` per grapheme, so accents, CJK and
  emoji work regardless of the active keyboard layout. Newline = Return,
  Tab = Tab, `perCharMs` is clamped to 0–1000 ms.
- Media keys use `NSEvent.systemDefined` (play/pause, next, previous, volume
  up/down, mute). **Stop** has no macOS NX key type and returns a clear error.
- Mouse coordinates are global display **points** (not physical pixels), with
  the primary display origin at top-left. Negative coordinates are valid on
  displays left of/above the primary one.
- `PRINTSCREEN`, `NUMLOCK`, `SCROLLLOCK`, `PAUSE`, `MENU` and `F21–F24` have no
  reliable macOS mapping and return descriptive errors.

## Building locally

On an Apple Silicon Mac with Xcode command line tools:

```sh
npm ci
npm run build:mac-helper -w @phonedek/desktop   # arm64 helper
npm run dist:mac -w @phonedek/desktop            # DMG + ZIP in apps/desktop/release
```

Universal helper and app (larger download, supports Intel):

```sh
npm run dist:mac:universal -w @phonedek/desktop
```

`npm run build` and `npm test`/`npm run typecheck` do **not** need the helper;
only packaging for macOS does. The helper binary is ignored by git and is built
by CI or locally.

### Stable local signing (recommended if you rebuild often)

Every ad-hoc rebuild changes the cdhash, so macOS 27 drops the privacy grant and
you have to add the executable again. Create a local self-signed code-signing
certificate once:

```sh
npm run make-signing-cert -w @phonedek/desktop
```

Then package normally. `after-pack.cjs` detects `PhoneDeck Local Signing` (or
`PHONEDEK_SIGN_IDENTITY`) and signs with it; electron-builder auto-discovers the
same identity and signs the whole bundle. TCC then stores a certificate-based
requirement that survives rebuilds. The certificate is trusted only in your
login keychain; nothing is committed, and Gatekeeper still treats the app as
unsigned (not notarized).

## CI

The `macos` job runs on `macos-latest`, asserts the runner is arm64, installs
Node 22 dependencies, builds and self-tests the Swift helper, runs `npm test`,
`npm run typecheck` and `npm run build`, then packages with
`npm run dist:mac -w @phonedek/desktop`. It sets
`CSC_IDENTITY_AUTO_DISCOVERY=false`, requires no signing secrets, extracts the
ZIP and verifies that the bundled helper is executable, arm64 and passes
`--self-test`. Artifacts: `*.dmg`, `*.zip`, `latest-mac.yml`, `*.blockmap`.

## Installing an unsigned build

1. Open the DMG and copy **PhoneDeck** to `/Applications` (do not run it from
   the DMG or Downloads; App Translocation makes permissions unpredictable).
2. Gatekeeper will warn that Apple cannot check the app. Use
   **System Settings → Privacy & Security → Open Anyway**, or
   right-click → **Open**. CLI equivalent:
   `xattr -dr com.apple.quarantine /Applications/PhoneDeck.app`.
3. Grant **input control**: use the **Grant permission** button in the
   PhoneDeck banner or **PhoneDeck → Grant … Permission…**, which opens the
   native macOS alert. In System Settings the pane is **Privacy & Security →
   Accessibility**, renamed **Device Control and Data Access** on macOS 27
   (same TCC service, same `…?Privacy_Accessibility` deep link).

   On macOS 27 the prompt's entry is sometimes not enough for an unsigned
   build; add the executable itself with **+** or by dragging it from Finder:

   ```
   /Applications/PhoneDeck.app/Contents/MacOS/PhoneDeck
   ```

   Settings → Input permission shows that path with **Show app file** and
   **Copy**. Only the executable is required — the helper inherits the app's
   decision. Restart PhoneDeck if input still fails.
4. Allow incoming connections and, on macOS 15+, **Local Network** access so
   pairing/discovery work. Third-party firewalls need TCP 47654 and UDP 47655.

Input Monitoring, Screen Recording and Automation are not required for CGEvent
injection. Secure Input/password prompts can still block synthetic input.

## Known limitations and risks

- **Unsigned**: every rebuild may change the ad-hoc signature and revoke the
  Accessibility grant. Gatekeeper bypass is required on each reinstall.
- **TCC identity**: `scripts/after-pack.cjs` signs the main executable and the
  helper with the app identifier (`com.phonedek.desktop` and
  `…keyboard-helper`). Without that, macOS 27 attributes input permission to
  the prebuilt Electron identity and the privacy toggle misses the app. On
  macOS 27 the app executable may still need to be added as a file (Settings →
  Input permission shows its path).
- **No auto-update**: Squirrel.Mac requires a signed, notarized app. The in-app
  updater is disabled on macOS and points users at manual DMG updates. Config
  and assets in `~/Library/Application Support/PhoneDeck` survive replacement.
- **TCC attribution**: macOS normally attributes the helper's events to the
  responsible PhoneDeck app, but it may list the helper separately. Verify on a
  packaged build; the fallback would be an in-process native addon, which this
  project deliberately avoids.
- **Arm64 only in CI**: Intel Macs need a universal or x64 build. Separate
  arm64/x64 builds cannot share one `latest-mac.yml`; prefer universal for a
  single update feed.
- **Media keys** rely on non-public `NSEvent` constants and can change between
  macOS releases. Mouse coordinates and Retina scaling vary by display setup.
- **Keyboard layouts**: virtual keycodes are physical, like Windows VK codes;
  Unicode text is layout-independent.

## Remaining signed/notarized release work

1. Obtain a Developer ID Application certificate and change `mac.identity` from
   `null` to that identity (or use CI `CSC_LINK`/`CSC_KEY_PASSWORD`).
2. Enable `hardenedRuntime`, add an entitlements plist (allow JIT for Electron,
   no app sandbox), and add `mac.binaries` for
   `Contents/Resources/keyboard-helper` so the nested helper is signed.
3. Enable notarization with `APPLE_API_KEY`/`APPLE_API_ISSUER` or
   `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`; remove `notarize:
   false`.
4. Re-enable `UpdateService` for packaged darwin builds and publish DMG, ZIP,
   `latest-mac.yml` and blockmaps in the same release as the Windows assets.
5. Verify `codesign --verify --deep --strict`, `spctl --assess --type execute`,
   `xcrun stapler validate`, and helper `lipo -info`; then test updating from a
   previous signed version.
6. Decide between arm64-only and universal distribution.

## Manual test checklist (needs a Mac)

- [ ] Unsigned arm64 DMG installs to `/Applications` and launches after the
      Gatekeeper bypass; rebuilding preserves config/assets but may need a new
      Accessibility grant.
- [ ] Accessibility denied → clear error, no crash; grant while running → input
      starts working without restart.
- [ ] Chords: Cmd+C/V/Tab/Q, Ctrl+arrow, Option+letter, Shift symbols, F1–F20,
      arrows/Home/End/PageUp/PageDown, numpad; US and one non-US layout.
- [ ] Text: ASCII, accents, CJK, emoji, newline/tab, long text, per-char delay,
      repeat, hold/release across TextEdit, Safari, VS Code and Terminal.
- [ ] Media: play/pause, next/previous and volume in Music/Spotify/YouTube.
- [ ] Mouse: move on primary and a left/above secondary display, all buttons,
      double-click, down/up drag, four scroll directions and amount limits.
- [ ] LAN/lifecycle: discovery, QR pairing, HTTP/WS, Android press, local
      network/firewall prompts, login item, close-window keep-alive, dock
      reopen, Cmd+Q stops the server, second launch focuses the window.
