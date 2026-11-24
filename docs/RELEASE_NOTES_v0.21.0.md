# PhoneDeck 0.21.0

## Linux audio-device switching

The same **Audio device** action and status tile now work on Linux when
PulseAudio or PipeWire is available through `pactl`:

- Set or cycle the default output/sink or input/source from a deck button.
- The editor lists live sinks/sources with the current device and form tags
  (USB, Bluetooth, HDMI, virtual, speakers/headphones/microphone).
- The tile shows the current device and the active target.
- Linux ignores the Windows-only "all roles" setting; it has one default per
  direction.
- Changing the default affects **new** streams. Apps already playing stay on
  their old sink/source until they reopen audio. PhoneDeck does not move live
  streams.
- The capability is advertised only when `pactl` exists. A missing
  PulseAudio/PipeWire setup leaves the tile on its quiet NO AUDIO fallback.

macOS audio-device switching is still not implemented.

## Shortcut safety

- If a keyboard-helper command fails, the helper now releases any held
  shortcut key or modifier before returning the error. A failed shortcut can no
  longer leave a key stuck down.

## Also

- Added shared contract coverage for every OBS phase-2 action, state binding,
  plan step and description. No OBS behavior changed.
- Android versionCode 42; no Android behavior change.

## Manual QA still required

- Real Linux PulseAudio and PipeWire hosts: list, set output/input, cycle,
  Bluetooth/USB/HDMI, monitor sources, missing server, and existing-stream
  behavior. The local development host has no `pactl`, so parsing and the
  backend are covered by fake-runner tests only.
- Windows 10/11: output/input, all roles, headset↔speakers, USB mic, active
  Bluetooth, HDMI/DP, virtual cables, duplicate names, hotplug and the packaged
  helper.

## Upgrade notes

- Windows 0.20.x can auto-update.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android installs over 0.20.1/0.20.0 (same debug key).
