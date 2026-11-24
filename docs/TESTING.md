# Manual test checklist

Use this after installing from [the latest release](https://github.com/Pelozo/phonedek/releases/latest).
Report issues with `%APPDATA%\PhoneDeck\phonedek.log`, the Windows version and the Android model/version.

## Desktop only

- [ ] Installer runs; Windows SmartScreen → **More info → Run anyway**.
- [ ] App opens with the starter deck and **Saved** in the top bar.
- [ ] Server pill/status bar shows **LAN server on 47654**.
- [ ] **Pair phone** shows a QR, host, port and 4-digit PIN; **Copy** puts the link on the clipboard.
- [ ] **Advertised host** lists the detected LAN addresses; choosing another adapter changes the QR host.
- [ ] Change the port to `47655`-ish (e.g. 49000), Apply → status updates; the QR host/port changes.
- [ ] Change the deck name in **Settings** → the QR/name updates.
- [ ] Create a profile, add a page, switch pages, rename them.
- [ ] Add a button, set label/sublabel/emoji, pick a gradient, import a PNG background.
- [ ] Change grid columns/rows; confirm the warning when buttons would be dropped.
- [ ] Drag a button to another slot; drag onto an occupied slot to swap.
- [ ] Add a shortcut action (record Ctrl+Shift+S), a text action, a URL action, a media action.
- [ ] Add a macro action → Record → type `hello`, press Ctrl+C, wait, Stop → Add steps.
- [ ] In the recorder toggle **Capture pauses** and **Group typing**, use Pause/Resume and Undo, then save.
- [ ] Edit a macro: set repeat ×2, add a mouse scroll and a launch/URL step, reorder/duplicate steps.
- [ ] Press **Test** on the button; Notepad receives the shortcut/text (focus Notepad first if needed).
- [ ] **Run all actions on this PC** returns a success toast, or a useful error.
- [ ] Export backup (ZIP), delete a profile, import the backup → layout and images return.
- [ ] Close and reopen the app → configuration persists.

## Phone + desktop

- [ ] Update the phone over Wi-Fi; allow **Private networks** in the Windows firewall prompt.
- [ ] Install the APK (allow unknown apps) and open it.
- [ ] Scan the QR with the normal camera app → PhoneDeck opens and connects (green status).
- [ ] Or tap **Add server manually** and enter host/port/PIN → connects.
- [ ] Discovery: with the pairing screen open, the PC appears in the list (tap → enter PIN).
- [ ] Press Copy/Paste/Undo in Notepad → the PC receives the shortcut.
- [ ] Press Play/Pause → media toggles; volume buttons change volume.
- [ ] Edit a button label/background on the desktop → phone updates live without re-pairing.
- [ ] Press a page button → phone switches instantly; page indicator/state is correct.
- [ ] Lock the phone screen and unlock → deck still works; screen stays on while deck is open.
- [ ] Rotate the phone → grid reflows and remains usable.
- [ ] Generate a new PIN on the desktop → phone disconnects; re-pairing works.
- [ ] Close PhoneDeck on the PC → phone shows **offline** and still renders the cached deck.
- [ ] Reopen PhoneDeck → phone reconnects and fetches the current config.
- [ ] Change Wi-Fi/disable Wi-Fi → phone shows reconnecting; enable Wi-Fi → recovers.

## Edge cases

- [ ] Wrong PIN → pairing shows a clear rejection message; six wrong attempts get a 60s rate-limit message, no crash.
- [ ] Wrong port/host → timeout message.
- [ ] Empty button (no actions) → pressing shows no action and does not crash.
- [ ] Button with a `goto` page action removed on the desktop → phone falls back to the default page.
- [ ] Import a config with an image background whose asset is missing → fallback background, no crash.
- [ ] Press 30 buttons quickly → rate limiting returns an error instead of freezing.
- [ ] Kill the desktop window while the phone is connected → phone reconnects when relaunched.

## Known non-bugs

- Macro recording only captures keys while the PhoneDeck window is focused.
- PhoneDeck cannot send input to an app running as Administrator unless PhoneDeck is elevated.
- Games with anti-cheat may ignore synthetic input.
- The installer is unsigned; SmartScreen warns on first run.

## macOS preview

- [ ] Drag the arm64 DMG to Applications, open once via Gatekeeper.
- [ ] Grant Accessibility; key/text/media/mouse actions work.
- [ ] Grant Local Network; QR pairing/discovery works.
- [ ] Launch `.app` with arguments, URL and shell command actions.
- [ ] Close the window; dock icon reopens it and the server stays alive; Cmd+Q stops it.

## Audio devices (Windows, macOS, Linux)

- [ ] Add **Audio → Set output device** and pick the current device; the tile
  shows **OUT** and the status card shows **CURRENT**.
- [ ] Switch to a second output and back; the OS default changes and the tile
  chip follows within about a second.
- [ ] Add **Cycle output devices** with two devices; each press toggles the
  default and skips a disconnected device.
- [ ] Add **Audio device** state as a generic output/input source and as a
  specific target; confirm the current name, `ACTIVE` target and `NO AUDIO` /
  `NO DEVICE` fallbacks.
- [ ] Add an input device action; confirm the microphone/capture default
  changes and apps see the new input after reopening audio.

### Windows

- [ ] Leave **Set all Windows roles** on; check Discord/Teams communications
  input/output follows the change.
- [ ] Turn it off; only the console/multimedia default should follow.
- [ ] Test built-in speakers, USB interface, connected Bluetooth headset and
  HDMI/DisplayPort; hotplug each and refresh the picker.
- [ ] Confirm a disconnected Bluetooth endpoint is not selectable.
- [ ] Use the packaged app, not only `npm run dev`; the helper must be beside
  `resources/audio-device-helper.ps1`.

### macOS

- [ ] Test built-in speakers, USB interface, connected Bluetooth headset and
  HDMI/DisplayPort; hotplug each and refresh the picker.
- [ ] Confirm output switching changes both default output and system output.
- [ ] Test an AirPlay or aggregate device; a rejected change must show an error
  and leave the old default in place.
- [ ] Confirm no Accessibility prompt appears for audio-only actions.
- [ ] Use the packaged `.app`; the Swift helper must be the second process.

### Linux

- [ ] With PulseAudio or PipeWire and `pactl` installed, add set/cycle actions
  and confirm new apps use the new sink/source.
- [ ] Confirm an already-playing app keeps its old stream until it reopens
  audio (PhoneDeck does not move live streams).
- [ ] Test Bluetooth/USB/HDMI endpoints, monitor sources, duplicate names and
  a missing PulseAudio server (`NO AUDIO` / clear error, no picker crash).
- [ ] Without `pactl`, confirm the audio capability is absent rather than a
  picker that can only fail.

## Android video pages

- [ ] Put a video background and a video button icon on two pages.
- [ ] Swipe back and forth several times; the settled page plays, adjacent
  pages show their fallback, and no black frame or decoder error remains.
- [ ] Lock/unlock and background/foreground the app; video resumes on the
  settled page only.
- [ ] Rotate the phone; video fit/rotation still works.
- [ ] Check the log for repeated `Video playback failed` entries after page
  turns.
