# Audio devices

PhoneDeck can change the computer's default output and input from a deck
button, a cycle tile or a status tile. The same shared actions work on Windows,
macOS and Linux; only the platform backend differs.

## Add it

1. Select a tile and choose **Add action → Audio**.
2. Pick **Set output device**, **Set input device**, **Cycle output devices** or
   **Cycle input devices**.
3. Choose a live endpoint from the picker. Set actions save one device; cycle
   actions save an ordered list of 2–8 devices (two make a toggle).
4. Optionally add an **Audio device** status source to show the current device,
   or add a tile whose only state is the current output/input.

Saved devices keep both an opaque host id and a friendly name. The id is
resolved first; if the endpoint reappears with a different id, the exact name is
the fallback. Ambiguous duplicate names produce an error instead of guessing.

## Platform behavior

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| On tile | **OUT** / **IN** | **OUT** / **IN** | **OUT** / **IN** |
| Backend | Core Audio + `IPolicyConfig` | Core Audio | `pactl` (PulseAudio/PipeWire) |
| Set scope | Console, multimedia and communications roles (default) | Default output + system output, or default input | Default sink/source |
| Permission | Runs as the signed-in user | No Accessibility permission needed | User must be able to run `pactl` |
| Existing streams | Apps pinned to a device keep their route | Apps may keep their current device | New streams only; live streams are not moved |

### Windows

Windows has no supported public API for changing the default endpoint; PhoneDeck
uses the same `IPolicyConfig` path as common audio switchers. The **Set all
Windows roles** toggle applies the change to console, multimedia and
communications. Discord and Teams are the main reason to leave it on.

Bluetooth endpoints must be connected and appear active. A headset that is
paired but disconnected is not selectable. RDP, kiosk and policy-locked sessions
can reject the call; PhoneDeck reports the error and leaves the old default in
place.

### macOS

macOS uses public CoreAudio APIs. It does not need Accessibility permission for
device selection. Output switching sets both the default output and the default
system-output device; input switching sets the default input.

Aggregate devices, multi-output devices, AirPlay and a disconnected Bluetooth
headset can reject a change. PhoneDeck surfaces the CoreAudio status rather than
silently choosing another device.

### Linux

Linux needs `pactl` from PulseAudio or PipeWire. If `pactl` is not installed,
the capability is absent and the tile stays on its quiet `NO AUDIO` fallback.

Changing the default only affects **new** streams; already-playing apps keep
their sink or source until they reopen audio. PhoneDeck does not move live
streams. Monitor sources are listed like other sources; they follow the same
selection rules.

## Troubleshooting

| Symptom | Meaning |
| --- | --- |
| `NO AUDIO` | No controller was built for this host. On Linux install PulseAudio/PipeWire and `pactl`; on Windows/macOS the helper is missing from the build. |
| `NO DEVICE` | The saved device is disconnected, or the platform reports no default. Reconnect it or pick another device. |
| Device list is empty | No active endpoints, or the backend command failed. Use the refresh button and check the desktop log. |
| Change worked but an app stayed on the old device | The app pins its own device (OBS, some games) or was already playing a stream. Change it in the app or reopen its audio. |
| `Device name is ambiguous` | Two usable devices share the saved friendly name. Re-pick the device so PhoneDeck can save its opaque id. |

OBS input/output devices are independent of the system default; change them in
OBS. PhoneDeck can still switch the system default with the same action.

## Compatibility

- A new phone can use audio actions against an older desktop through the normal
  press path; the live chip may be absent on the old desktop.
- An older desktop can reject a config containing audio actions. Use **Settings
  → Backup → Export for older desktop** to strip rigs, rules, audio actions and
  audio states before importing.
- macOS/Linux audio switching depends on the helper/`pactl` being present at
  startup. The capability is absent rather than showing a picker that can only
  fail.
