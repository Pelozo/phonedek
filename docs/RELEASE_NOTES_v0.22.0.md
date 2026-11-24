# PhoneDeck 0.22.0

## macOS audio-device switching

The **Audio device** action and status tile now work on macOS through public
CoreAudio APIs:

- Set or cycle the default output or input from a deck button.
- The editor lists live output/input devices with the current device and form
  tags (USB, Bluetooth, HDMI, virtual, speakers/headphones/microphone).
- The tile shows the current device and the active target.
- Output switching sets both the default output and the default system-output
  device; input switching sets the default input.
- No Accessibility permission is needed for audio device selection.
- IDs are opaque hashes of the stable CoreAudio UID; raw UIDs stay on the
  desktop.
- Aggregate/multi-output devices, AirPlay and a disconnected Bluetooth headset
  can reject the change; the app surfaces the CoreAudio error instead of
  guessing.

## Also included

- Linux audio-device switching via PulseAudio/PipeWire `pactl` (from 0.21.0).
- Failed keyboard-helper commands release held shortcut keys/modifiers.
- Android versionCode 43; no Android behavior change.

## Manual QA still required

- Real macOS hosts: built-in speakers, USB interface, Bluetooth headset,
  HDMI/DisplayPort, AirPlay, aggregate device, duplicate names, hotplug and the
  packaged helper as a second process.
- Real Linux PulseAudio/PipeWire hosts: sinks/sources, Bluetooth/USB/HDMI,
  monitor sources, missing server and new-stream behavior.
- Windows 10/11: audio roles, communications role, hotplug and packaged helper.

## Upgrade notes

- Windows/macOS 0.21.x can auto-update.
- macOS unsigned builds need a manual install; signed builds update in-app.
- Android installs over 0.21.0/0.20.x (same debug key).
