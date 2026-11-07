# macOS support plan

Investigation only (2026-11-06); no source changes. Brief for after the updater work.

## Verdict: moderate

PhoneDeck is ~90% platform-neutral (editor, config, HTTP/WS, discovery, pairing,
assets, backups, host actions are Electron/Node); the work is one native input helper
plus packaging, permissions and release constraints.

**Effort:** ~1.5–2 focused days for an unsigned arm64 build with full input parity
(keys/text/media/mouse); ~3–4.5 days release-ready with universal arch, menu polish,
CI, docs and signing/notarization. Not "hard", but macOS TCC and Squirrel.Mac force
decisions Windows does not have.

## What already works

- `npm run dev` / `npm run build` run on macOS; no native Node modules.
- Config editor, assets, backups and storage under
  `~/Library/Application Support/PhoneDeck` (`app.getPath('userData')`).
- LAN HTTP/WS, UDP discovery, QR pairing and the Android protocol: no changes.
- `openUrl` already uses `open`; `runCommand` uses `/bin/sh -c`; `.app` launch works
  indirectly via `shell.openPath` (directory branch), but arguments are lost.
- `app.setLoginItemSettings` has a `darwin` branch; logger paths/rotation are
  platform-neutral; `safeStorage` is unused (the PIN would need Keychain).

**Gaps:** `createKeySender` returns `UnsupportedKeySender`; `helperPath()` always
names the PowerShell script; tests/CI cover only Windows + Android; auto-update is
Windows-only; `Menu.setApplicationMenu(null)` removes Copy/Paste/Quit; closing the
window stops the server; electron-builder only produces a ZIP for mac.

## Key/mouse injection: small Swift CGEvent helper

| Option | Verdict |
| --- | --- |
| AppleScript / System Events (`osascript`) | Not as the primary path. Zero build cost, but needs **both** Automation and Accessibility TCC, spawns a ~100–300 ms process per chord, cannot send system media keys, has weak mouse/scroll support, and `keystroke` depends on the active keyboard layout (emoji/non-US text unreliable). Cannot reliably hold/release. A throwaway text/chord fallback only. |
| Swift/Objective-C helper with Quartz `CGEvent` | **Recommended.** ~250–350 lines, full parity, layout-independent Unicode, one persistent process (~1 ms/command), no npm dependency. |
| Native Node addon (`napi-rs`/node-gyp) | Works and keeps TCC identity in Electron, but adds ABI/arch builds, prebuilds and native CI. Fallback if helper TCC attribution is bad. |
| `cliclick` / `robotjs` | Avoid. External install or stale native addon; no media-key parity. |

### Helper behaviour (same JSONL protocol as `keyboard-helper.ps1`)

- **Chords:** `CGEvent(keyboardEventSource:virtualKey:keyDown:)` posted to
  `.cghidEventTap`; canonical keys map to macOS virtual keycodes (ANSI table).
  `WIN` → Command, `ALT` → Option, `CTRL` → Control. Set `.maskCommand` etc.; post
  modifiers around the base key; implement `press`/`down`/`up` with `holdMs` (the
  Windows helper currently ignores the action).
- **Unicode text:** `CGEventKeyboardSetUnicodeString` with UTF-16 units, one grapheme
  at a time (chunk surrogate pairs). Layout-independent; supports accents, CJK and
  emoji. Newline → Return, tab → Tab, honour `perCharMs`. Games/secure-input fields
  may ignore synthetic text.
- **Media:** `NSEvent.otherEvent(with: .systemDefined, subtype: 8, data1: (NX_KEYTYPE
  << 16) | (0xa << 8), data2: -1)`, post `cgEvent`. Types: play/pause 16, next 17,
  previous 18, sound up 0, down 1, mute 7. No AppleScript app targeting.
- **Mouse:** `CGEvent(mouseEventSource:mouseType:mouseCursorPosition:mouseButton:)`
  for move/down/up/drag; `CGEvent(scrollWheelEvent2Source:units:.line,...)` for
  scroll. Coordinates are global display points (primary top-left, y down, negative
  on displays left/above), not physical pixels.
- **Permissions:** `AXIsProcessTrustedWithOptions(...prompt: true)`; return a
  machine-readable `permission: "accessibility"` error. Input Monitoring, Screen
  Recording and Automation are not needed with CGEvent.

Keep the helper a plain executable (no bundle ID), spawned as a child of PhoneDeck,
so macOS normally attributes TCC to the responsible parent. Verify on a packaged
build; if macOS lists the helper separately, document adding it or move the code to
an in-process N-API addon.

## Minimal viable path

1. **MVP:** arm64 unsigned DMG + ZIP, Swift helper with all input kinds,
   Accessibility guidance, minimal app menu. Do not ship AppleScript as a stopgap; it
   adds a permission model and still cannot do media/mouse.
2. **Parity/release:** hold/release, multi-monitor mouse, "Cmd" labels, login item,
   close-window/dock behaviour, then universal (or arm64-only), signing/notarization,
   `latest-mac.yml`, CI, docs. **Optional:** Keychain PIN, tray icon.

## File-by-file plan

| File | Change |
| --- | --- |
| `apps/desktop/resources/mac/keyboard-helper.swift` (new) | CGEvent helper above; JSONL `{"ready":true}` / `{"id","steps"}` / `{"id","ok","error","permission"}`. |
| `apps/desktop/resources/mac/keyboard-helper` + `scripts/build-mac-helper.sh` (new) | Optional universal prebuilt (commit only if local dev without Xcode matters) built by `swiftc` arm64/x86_64 + `lipo -create`; `chmod +x`. |
| `apps/desktop/src/main/key-sender.ts` | Add `MacKeySender` (or generalise `WindowsKeySender` into a spawn-command-parameterised helper sender); `createKeySender` → darwin; map permission failures to actionable text. |
| `apps/desktop/src/main/index.ts` | `helperPath()` per platform; prewarm for `win32 \|\| darwin`; mac app menu (`appMenu`, `editMenu`, `windowMenu`); keep app/server alive on `window-all-closed`; `activate` reopens; optional "Grant Accessibility" action. |
| `apps/desktop/src/main/host-actions.ts` | darwin + `.app`: `open -a <path> --args ...` so args work; keep `shell.openPath` for folders/`.app` without args; tests for both. |
| `apps/desktop/src/main/updater.ts` | Enable on darwin only for signed builds; fix "installed Windows app" copy; unsigned build reports disabled with a Releases link. |
| `packages/shared/src/keys.ts` + renderer | Platform-aware `formatKeyLabel`/`formatCombo`: `WIN` shows **Cmd** on mac, **Win** on Windows; map `PRINTSCREEN`/`NUMLOCK`/`SCROLLLOCK`/`PAUSE`/`MENU` to errors or safe equivalents. |
| `apps/desktop/electron-builder.yml` | Move PS1 to `win.extraResources`; add `mac.extraResources`; `mac.target: [dmg, zip]`; `mac.binaries` for the helper; hardened runtime + `build/entitlements.mac.plist` (`allow-jit`, no sandbox); `extendInfo.NSLocalNetworkUsageDescription`; `identity: '-'` for unsigned. |
| `apps/desktop/package.json` | `build:mac-helper`, `dist:mac`, `dist:mac:universal` scripts. |
| `.github/workflows/build.yml` | `macos` job on `macos-latest` (arm64) or `macos-15-intel`; build, test, typecheck, `dist:mac`, upload DMG/ZIP/latest-mac.yml. |

## Packaging, CI and auto-update

- **Targets:** `dmg` for humans, `zip` for electron-updater; Squirrel.Mac needs both.
  `artifactName: "${productName}-${version}-${arch}.${ext}"` avoids overwriting
  arm64/x64/universal assets.
- **Arch:** start with arm64; current `macos-latest` is arm64. Universal is the clean
  way to support Intel and keep one update feed: `electron-builder --mac --universal`
  on the arm64 runner (it downloads x64 Electron). Separate arm64 + x64 builds cannot
  share one `latest-mac.yml`. Universal roughly doubles download size.
- **Unsigned:** usable for personal/testing with Gatekeeper bypass. Use
  `mac.identity: "-"` (ad-hoc), `hardenedRuntime: false`, `notarize: false`; or
  `identity: null`. Ad-hoc signatures change every build, so Accessibility grants
  reset after each update. Squirrel.Mac requires a signed app, so unsigned/ad-hoc
  cannot auto-update; keep the updater disabled and link to Releases.
- **Signed release:** Developer ID Application + hardened runtime + notarization
  (`APPLE_API_KEY` or `APPLE_ID` secrets, `notarize: true`). `mac.binaries:
  ["Contents/Resources/keyboard-helper"]` signs the nested helper. Verify with
  `codesign --verify --deep --strict`, `spctl --assess --type execute`,
  `xcrun stapler validate`, `lipo -info`.
- **CI:** `macos-latest` (arm64) is current; `macos-14` was retired 2026-11-02. Steps
  mirror Windows; set `CSC_IDENTITY_AUTO_DISCOVERY=false` without secrets. Upload
  `release/*.dmg`, `release/*.zip`, `release/latest-mac.yml` and any `*.blockmap`.
- **Auto-update:** enable `UpdateService` for packaged darwin; electron-updater's
  GitHub provider reads `latest-mac.yml` + ZIP. Publish DMG, ZIP and `latest-mac.yml`
  in the same release as Windows `latest.yml`; do not mix arches. `app-update.yml` is
  generated automatically.
- **Info.plist:** `NSLocalNetworkUsageDescription` for macOS 15+ prompts; no Apple
  Events keys unless AppleScript is used; no sandbox; `minimumSystemVersion` not
  below Electron 45's floor.

## Security, permissions and user-facing caveats

- **Accessibility** (System Settings → Privacy & Security → Accessibility): required
  for CGEvent injection. Add **PhoneDeck** (and the helper if listed); restart may be
  needed. Input Monitoring, Automation and Screen Recording are not needed.
- **Gatekeeper:** unsigned/ad-hoc downloads show "Apple cannot check it for malicious
  software"; use right-click **Open** or Privacy & Security → **Open Anyway**.
  `xattr -dr com.apple.quarantine /Applications/PhoneDeck.app` is the CLI equivalent.
  Run from `/Applications`, not the DMG/Downloads, to avoid translocation and TCC
  path surprises.
- **Firewall / local network:** allow incoming connections; on macOS 15+ allow
  **Local Network**, otherwise pairing/discovery fail. Third-party firewalls need
  TCP 47654 and UDP 47655 rules. No TLS: trusted LAN only, never port-forward.
- **Secure Input / login:** password dialogs can block synthetic input (expected).
  Login item works for the packaged app and in System Settings → General → Login Items.

## Risks

- **TCC attribution:** a child helper may be listed separately from PhoneDeck;
  ad-hoc rebuilds change the signature and revoke permission. Main unknown—verify
  early on a packaged arm64 build. Fallback: in-process N-API addon.
- **Auto-update vs signing:** unsigned Macs cannot use Squirrel.Mac updates. The
  $99/year Developer ID + notarization is effectively required for a polished
  release, and notarization adds CI secrets and Apple latency.
- **Keyboard layouts:** virtual keycodes are physical, so chords follow the physical
  key (like Windows VK codes); Unicode text is layout-independent. Document `Cmd` vs
  `Win` and unsupported keys.
- **Media / mouse:** system-defined NSEvent constants are not a public stable API,
  and mouse coordinates are points, not pixels; Retina and multi-display negative
  origins can surprise users. Test media on each macOS release and record
  coordinates on the same Mac.
- **Lifecycle:** keeping the app alive after the last window closes is macOS
  convention but changes server behaviour; make it explicit and test Quit.
- **Packaging:** forgetting `mac.binaries` breaks signing/notarization; universal
  builds are slower/larger. The Windows helper's `down`/`up` handling is incomplete;
  implement it correctly on Mac instead of mirroring it.

## Test checklist

- [ ] Unsigned arm64 DMG installs to `/Applications`, launches after Gatekeeper
      bypass, and survives a rebuild.
- [ ] Accessibility denied → clear error, no crash; grant → chords work without
      restart (or document the restart).
- [ ] Chords: Cmd+C/V/Tab/Q, Ctrl+arrow, Option+letter, Shift symbols, F1–F12,
      arrows/Home/End/PageUp/PageDown, numpad; US + one non-US layout.
- [ ] Text/macro: ASCII, accents, CJK, emoji, newline/tab, long text, per-char delay,
      repeat, hold/release, mixed keys/text/launch/URL/command in TextEdit, Safari,
      VS Code and Terminal.
- [ ] Media: play/pause, next/prev, volume up/down/mute in Music/Spotify/YouTube.
- [ ] Mouse: move on primary and a left/above secondary display; left/right/middle
      click; double-click; down/up drag; scroll in all directions; amount limits.
- [ ] LAN/lifecycle: discovery, QR pairing, HTTP/WS, Android press, local-network and
      firewall prompts, advertised host; login item, close-window keep-alive, dock
      reopen, Cmd+Q stops server, second launch focuses the window.
- [ ] Signed build: `codesign`, `spctl`, `stapler validate`, helper `lipo -info`;
      auto-update from previous signed version (check/download/install/relaunch).
- [ ] Unsigned build: updater disabled; manual DMG update preserves config/assets but
      requires re-granting Accessibility.
