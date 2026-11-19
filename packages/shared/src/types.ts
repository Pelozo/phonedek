/**
 * PhoneDeck shared model.
 *
 * This is the contract between the desktop configurator and the Android deck.
 * Keep it JSON-serializable: no Dates, Maps or class instances.
 */

import type { ModifierKey } from './keys'

export const PROTOCOL_VERSION = 1 as const
export const CONFIG_SCHEMA_VERSION = 1 as const

/** Phone capability for transient window-brightness control (0..1 / system). */
export const BRIGHTNESS_CAPABILITY = 'brightness-v1' as const

/** Desktop capability for trackpad/pointer control over the `pointer` message. */
export const POINTER_CAPABILITY = 'pointer-v1' as const

/** Desktop capability for live control state (volume readback and friends). */
export const CONTROL_STATE_CAPABILITY = 'control-state-v1' as const

/** Desktop capability for phone keyboard text/key injection. */
export const KEYBOARD_CAPABILITY = 'keyboard-v1' as const

/**
 * Desktop capability for physical key down/up frames (`action: 'down' | 'up'`).
 * Old desktops treat every key frame as a one-shot press, so a direct keyboard
 * must only stream held states when this is advertised.
 */
export const KEYBOARD_STATE_CAPABILITY = 'keyboard-v2' as const

/** Desktop capability for OBS WebSocket input volume/mute control. */
export const OBS_CAPABILITY = 'obs-v1' as const

/** Desktop capability for Twitch Helix reads and actions (authorized only). */
export const TWITCH_CAPABILITY = 'twitch-v1' as const

/** Desktop capability for local smart-light control and readback. */
export const LIGHT_CAPABILITY = 'light-v1' as const

/** Desktop capability for per-application audio volume/mute control. */
export const MIXER_CAPABILITY = 'mixer-v1' as const

/**
 * Desktop capability for enumerating PC audio endpoints and switching the
 * default output/input device (`audio-device-v1`).
 */
export const AUDIO_DEVICE_CAPABILITY = 'audio-device-v1' as const

/** Desktop capability for triggering Streamer.bot actions over its local API. */
export const STREAMERBOT_CAPABILITY = 'streamerbot-v1' as const

/**
 * Desktop capability for rig presets (`rigProgress` frames and last-run
 * readback). Old phones treat a rig button as an ordinary press.
 */
export const RIG_CAPABILITY = 'rig-v1' as const

/**
 * Desktop capability for config-owned event rules.
 *
 * Advertised unconditionally (like `rig-v1`); the MVP phone neither sends nor
 * reads any rule message.
 */
export const RULES_CAPABILITY = 'rules-v1' as const

/** Phase 2: the `notice` rule action rendered as a phone snackbar. */
export const NOTICE_CAPABILITY = 'notice-v1' as const

/** Hard limits for rig presets, enforced by the config schema. */
export const RIG_MAX_PRESETS = 16
export const RIG_MAX_STEPS = 32
export const RIG_MAX_GUARDS = 8
export const RIG_MAX_STEP_DELAY_MS = 10_000
export const RIG_MAX_DEADLINE_MS = 600_000
export const RIG_DEFAULT_DEADLINE_MS = 120_000
/** Serialized `config.rigs` must stay below this to keep the hello frame small. */
export const RIG_MAX_SERIALIZED_BYTES = 128 * 1024

/** Hard limits for event rules, enforced by the config schema. */
export const RULES_MAX_RULES = 32
export const RULE_MAX_ACTIONS = 4
export const RULE_MAX_CONDITIONS = 4
export const RULE_MAX_NAME = 60
export const RULE_MAX_NOTICE = 80
export const RULE_MAX_SCENE = 120
export const RULE_MAX_PROCESS = 160
/** Serialized `config.rules` must stay below this to keep the hello frame small. */
export const RULE_MAX_SERIALIZED_BYTES = 64 * 1024

/** Stability window before a rule executes; default 1500 ms. */
export const RULE_DEBOUNCE_DEFAULT_MS = 1_500
export const RULE_DEBOUNCE_MAX_MS = 30_000
/** Minimum gap between two fires of the same rule; default 10 s. */
export const RULE_COOLDOWN_DEFAULT_MS = 10_000
export const RULE_COOLDOWN_MAX_MS = 3_600_000
/** Baselines keep updating for this long after a run before rules may fire. */
export const RULE_SETTLE_MS = 4_000
/** Global storm brake: drops (never queues) excess fires in a rolling minute. */
export const RULE_MAX_FIRES_PER_MINUTE = 12
/** In-memory run history shown in the dialog. */
export const RULE_HISTORY_MAX = 50
/** Twitch live polling while at least one Twitch rule is enabled. */
export const RULE_TWITCH_POLL_MS = 60_000
/** A process must be missing twice (≈6 s) before `process.stopped` fires. */
export const RULE_PROCESS_EXIT_TICKS = 2

/** Streamer.bot WebSocket API default port (`ws://127.0.0.1:8080/`). */
export const STREAMERBOT_DEFAULT_PORT = 8080
/** Streamer.bot WebSocket API default host. */
export const STREAMERBOT_DEFAULT_HOST = '127.0.0.1'

/** Hard limits for a `streamerbot` action, enforced by the config schema. */
export const STREAMERBOT_MAX_ACTION_NAME = 128
export const STREAMERBOT_MAX_ARGS = 16
export const STREAMERBOT_MAX_ARG_KEY = 64
export const STREAMERBOT_MAX_ARG_VALUE = 512

/** Local-light providers supported by the desktop adapters. */
export type LightDeviceType = 'elgato' | 'hue' | 'nanoleaf'

export const LIGHT_DEVICE_TYPES: readonly LightDeviceType[] = ['elgato', 'hue', 'nanoleaf']

/** Elgato Key Light / Key Light Air / Key Light Mini default HTTP port. */
export const LIGHT_DEFAULT_PORT = 9123
/** Philips Hue bridge CLIP v1 HTTPS port. */
export const HUE_DEFAULT_PORT = 443
/** Nanoleaf OpenAPI HTTP port. */
export const NANOLEAF_DEFAULT_PORT = 16021

/** Default port for a provider; unknown values fall back to Elgato's port. */
export function lightDefaultPort(type: LightDeviceType | undefined): number {
  switch (type) {
    case 'hue':
      return HUE_DEFAULT_PORT
    case 'nanoleaf':
      return NANOLEAF_DEFAULT_PORT
    default:
      return LIGHT_DEFAULT_PORT
  }
}

/** Elgato's white-balance range, expressed in mireds (1e6 / Kelvin). */
export const ELGATO_TEMPERATURE_MIN = 143
export const ELGATO_TEMPERATURE_MAX = 344

/**
 * Philips Hue CLIP v1 color-temperature range in mireds. The app's slider is
 * still expressed in Elgato's 143..344 mired range; values are clamped when
 * they cross the bridge API boundary.
 */
export const HUE_COLOR_TEMPERATURE_MIN = 153
export const HUE_COLOR_TEMPERATURE_MAX = 500

/** Nanoleaf OpenAPI color temperature is expressed in Kelvin. */
export const NANOLEAF_TEMPERATURE_MIN_KELVIN = 1200
export const NANOLEAF_TEMPERATURE_MAX_KELVIN = 6500

export const DEFAULT_HTTP_PORT = 47654
export const DISCOVERY_PORT = 47655
export const DISCOVERY_MAGIC = 'PHONEDECK'

export type HexColor = string

export interface ColorBackground {
  type: 'color'
  color: HexColor
  /** 0..1 black overlay, useful behind text. */
  overlay?: number
}

export interface GradientBackground {
  type: 'gradient'
  from: HexColor
  to: HexColor
  /** CSS angle in degrees. */
  angle?: number
  overlay?: number
}

export interface ImageBackground {
  type: 'image'
  /** File name inside the desktop asset store, never a path. */
  asset: string
  fit: 'cover' | 'contain'
  overlay?: number
}

export interface VideoBackground {
  type: 'video'
  /** File name inside the desktop asset store, never a path. */
  asset: string
  fit: 'cover' | 'contain'
  /** Defaults to true when omitted. */
  loop?: boolean
  /** Defaults to true when omitted. */
  muted?: boolean
  /** Defaults to true when omitted. */
  autoplay?: boolean
  overlay?: number
}

export type Background = ColorBackground | GradientBackground | ImageBackground | VideoBackground

/** Animated GIF/video icon. `button.icon` remains the emoji fallback. */
export interface MediaIcon {
  type: 'image' | 'video'
  /** File name inside the desktop asset store, never a path. */
  asset: string
  fit: 'cover' | 'contain'
  /** Video defaults to true when omitted. */
  loop?: boolean
  /** Video defaults to true when omitted. */
  muted?: boolean
}

export interface GridSettings {
  /** 1..10 */
  columns: number
  /** 1..10 */
  rows: number
  gap: number
  padding: number
}

export interface ProfileTheme {
  background: Background
  buttonBackground: Background
  textColor: HexColor
  /** Vibrant accent used by the desktop editor for selection states. */
  accentColor: HexColor
  fontSize: number
  buttonRadius: number
}

export type MediaKey =
  | 'playpause'
  | 'next'
  | 'prev'
  | 'stop'
  | 'volumeup'
  | 'volumedown'
  | 'mute'

export type MouseButton = 'left' | 'right' | 'middle'
export type MouseAction = 'click' | 'doubleclick' | 'down' | 'up' | 'move' | 'scroll'

export interface HotkeyStep {
  type: 'hotkey'
  /** Keys pressed together, e.g. ["CTRL", "SHIFT", "ESC"]. */
  keys: string[]
  /** How long to hold a `press` chord, in milliseconds. */
  holdMs?: number
  /** press = down+up, down/up = keep held / release (for drags and held modifiers). */
  action?: 'press' | 'down' | 'up'
}

export interface TextStep {
  type: 'text'
  text: string
  /** Delay between characters, in milliseconds. */
  perCharMs?: number
}

export interface DelayStep {
  type: 'delay'
  ms: number
}

export interface MediaStep {
  type: 'media'
  key: MediaKey
}

export interface MouseStep {
  type: 'mouse'
  button: MouseButton
  action: MouseAction
  x?: number
  y?: number
  /** Scroll direction; only used when action is "scroll". */
  direction?: 'up' | 'down' | 'left' | 'right'
  /** Scroll notches (default 1). */
  amount?: number
}

export type MacroStep =
  | HotkeyStep
  | TextStep
  | DelayStep
  | MediaStep
  | MouseStep
  | LaunchAction
  | UrlAction
  | CommandAction

export interface HotkeyAction extends HotkeyStep {
  type: 'hotkey'
}

export interface TextAction extends TextStep {
  type: 'text'
}

export interface MacroAction {
  type: 'macro'
  steps: MacroStep[]
  /** Run the whole step list 1..50 times. */
  repeat?: number
  /** Pause between repeats, in milliseconds. */
  repeatDelayMs?: number
}

export interface LaunchAction {
  type: 'launch'
  /** Absolute path on the desktop machine. */
  path: string
  args?: string[]
}

export interface UrlAction {
  type: 'url'
  url: string
}

export interface CommandAction {
  type: 'command'
  command: string
  cwd?: string
  hidden?: boolean
}

export interface MediaAction extends MediaStep {
  type: 'media'
}

export interface DelayAction extends DelayStep {
  type: 'delay'
}

export interface PageAction {
  type: 'page'
  direction: 'next' | 'prev' | 'goto'
  pageId?: string
}

/** Toggle mute on the default capture device. No value/setGain in the MVP. */
export interface MicAction {
  type: 'mic'
  action: 'toggleMute'
}

/**
 * OBS actions. Names are user-defined OBS strings (scene-collection scoped),
 * validated by the config schema and resolved on the desktop at execution time.
 *
 * - `toggleMute` / input volume: `input` omitted = first audio-like input.
 * - `setScene`: `scene` omitted = the first scene in OBS's scene list.
 * - source visibility: `scene` omitted = the current program scene.
 * - `addMarker`: stream/recording chapter marker, optional `name`.
 */
export type ObsAction =
  | { type: 'obs'; action: 'toggleMute'; input?: string }
  | { type: 'obs'; action: 'setScene'; scene?: string }
  | { type: 'obs'; action: 'toggleStream' | 'startStream' | 'stopStream' }
  | { type: 'obs'; action: 'toggleRecord' | 'startRecord' | 'stopRecord' }
  | { type: 'obs'; action: 'startReplay' | 'stopReplay' | 'toggleReplay' | 'saveReplay' }
  | { type: 'obs'; action: 'toggleVirtualCam' }
  | {
      type: 'obs'
      action: 'setSourceVisibility'
      scene?: string
      source: string
      visible: boolean
    }
  | { type: 'obs'; action: 'toggleSourceVisibility'; scene?: string; source: string }
  | { type: 'obs'; action: 'addMarker'; name?: string }

/** A button executes its actions in order. */
export type Action =
  | HotkeyAction
  | TextAction
  | MacroAction
  | LaunchAction
  | UrlAction
  | CommandAction
  | MediaAction
  | DelayAction
  | PageAction
  | ObsAction

/**
 * Twitch Helix actions. Text is configured on the desktop and validated by the
 * config schema; the phone never supplies it. Limits follow Twitch:
 * chat 500, marker description 140, stream title 140.
 */
export type TwitchAction =
  | { type: 'twitch'; action: 'sendChat'; message: string }
  | { type: 'twitch'; action: 'createMarker'; description?: string }
  | { type: 'twitch'; action: 'setTitle'; title: string }
  | { type: 'twitch'; action: 'setGame'; game: string }

/**
 * Local smart-light actions. `light` is a configured device id; omitted = the
 * first configured light. Power is an action (not a value control): on/off is
 * better served by a tap tile plus a `light` state binding.
 */
export type LightAction =
  | { type: 'light'; action: 'setPower'; light?: string; on: boolean }
  | { type: 'light'; action: 'togglePower'; light?: string }

/**
 * Phone-local keyboard launcher. Tapping a button with this action opens the
 * phone's keyboard panel; it never runs on the desktop, so `actionsToPlan`
 * omits it and the executor stays untouched.
 */
export interface KeyboardAction {
  type: 'keyboard'
  action: 'open'
}

/** Phone-local per-app mixer launcher; never runs on the desktop. */
export interface MixerAction {
  type: 'mixer'
  action: 'open'
}

/**
 * Trigger one Streamer.bot action by name over its local WebSocket API.
 *
 * The action name and arguments are desktop-configured; the phone never
 * supplies them. Streamer.bot runs arbitrary subactions (chat, alerts, OBS,
 * sounds, programs), so this carries the same trust level as `command`.
 * Args are a small string map (Streamer.bot exposes them as `%key%`).
 */
export interface StreamerBotAction {
  type: 'streamerbot'
  action: 'doAction'
  /** Existing Streamer.bot action name, 1..128 chars. */
  actionName: string
  /** Up to 16 string arguments. */
  args?: Record<string, string>
}

/**
 * Everything the host can execute. `MicAction` and `TwitchAction` are accepted
 * by ActionSchema and the plan builder but deliberately stay out of `Action`
 * so older renderers do not have to handle them.
 */
export type ExecutableAction = Action | MicAction | TwitchAction

/**
 * Everything the host can execute plus the newer local-light cluster. Kept
 * separate from `ExecutableAction` so a renderer that keys maps by
 * `ExecutableAction['type']` compiles unchanged until it adds that UI.
 *
 * `StreamerBotAction` follows the same rule: the desktop plans and executes it,
 * while the renderer adds its editor entry in a follow-up. `AudioDeviceAction`
 * is the same staged pattern: it is plannable/executable now, and it joins
 * `ConfigAction`/`StateBinding` when the editor UI lands.
 */
export type PlannableAction = ExecutableAction | LightAction | StreamerBotAction | AudioDeviceAction

/**
 * Action union currently consumed by the editor UI. `StreamerBotAction` is
 * deliberately not listed yet: shared schema, planning and the desktop executor
 * already support it, while the renderer adds its editor entry in a follow-up
 * (the same staged pattern used for mic/Twitch/lights originally).
 */
export type ConfigAction = ExecutableAction | LightAction | KeyboardAction | MixerAction

/** Footprint of a button measured in grid cells. */
export interface CellSpan {
  /** 1..10 cells wide. */
  columns: number
  /** 1..10 cells tall. MVP renderers may only honour rows = 1. */
  rows: number
}

/**
 * One OBS input's volume, in percent (100 = 0 dB, 200 = +6 dB).
 *
 * `input` is scene-collection scoped. Omitted = desktop fallback: the first
 * audio-like input, then the first input. Max 128 chars.
 */
export interface ObsInputVolumeBinding {
  type: 'obs'
  target: 'inputVolume'
  input?: string
}

/** Read-only OBS status a normal button tile can display. */
export type ObsStateTarget =
  | 'streaming'
  | 'recording'
  | 'replay'
  | 'virtualCam'
  | 'scene'
  | 'inputMute'
  | 'inputVolume'

/**
 * Read-only status binding for a normal button. The button's `actions` still
 * perform the write; this only drives `control-state-v1` readback.
 *
 * - `scene` on a `scene` target marks the tile active when that scene is live.
 * - `scene` on the source-visibility targets is informational only (state is
 *   for one OBS input's mute/volume).
 * - `input` selects the OBS input for `inputMute` / `inputVolume`.
 */
export interface ObsStateBinding {
  type: 'obs'
  target: ObsStateTarget
  scene?: string
  input?: string
}

/** Read-only Twitch status a normal button tile can display. */
export type TwitchStateTarget = 'live' | 'viewers' | 'uptime' | 'title' | 'game'

/** Read-only Twitch status binding; `target` selects the Helix field. */
export interface TwitchStateBinding {
  type: 'twitch'
  target: TwitchStateTarget
}

/** What a light slider/dial or status tile reads or controls. */
export type LightTarget = 'power' | 'brightness' | 'temperature'

/**
 * A local-light value control.
 *
 * - `brightness`: raw 0..100.
 * - `temperature`: white balance in mireds, Elgato's native 143..344 range
 *   (143 ≈ 6993 K coolest, 344 ≈ 2907 K warmest). See `miredToKelvin`.
 * - `power`: 0..100 treated as off (< 50) / on (>= 50). Prefer actions for
 *   on/off and a `LightStateBinding` for the tile readout; the value form is
 *   accepted for symmetry with older value-control plumbing.
 *
 * `light` is a configured device id; omitted = the first configured light.
 */
export interface LightBinding {
  type: 'light'
  target: LightTarget
  light?: string
}

/** Read-only light status binding for a normal button. */
export interface LightStateBinding {
  type: 'light'
  target: LightTarget
  /** Configured device id; omitted = the first configured light. */
  light?: string
}

/**
 * Selects application audio sessions by process/application name.
 *
 * Matching is case-insensitive, ignores a leading path and an optional `.exe`
 * suffix. Omitted = no session matches (the control reports `NO SESSION`).
 */
export interface AppVolumeMatch {
  /** Process or application name, e.g. `discord` or `Google Chrome`. */
  process?: string
}

/**
 * Per-application volume slider/dial.
 *
 * The wire value is normalized 0..1; the editor stores `min: 0`, `max: 100`,
 * `unit: '%'`, so 42% is 0.42 on the phone. When several sessions match the
 * process, the first one is controlled and the state reports the ambiguity.
 */
export interface AppVolumeBinding {
  type: 'appVolume'
  target: 'volume'
  match: AppVolumeMatch
}

/** What a per-app status tile reads: the session's volume or mute state. */
export type AppVolumeStateTarget = 'volume' | 'mute'

/** Read-only per-app volume/mute status for a normal button. */
export interface AppVolumeStateBinding {
  type: 'appVolume'
  target: AppVolumeStateTarget
  match: AppVolumeMatch
}

/**
 * Per-app mute actions. `match` is resolved on the desktop at execution time.
 * Absolute volume is a control value, not an action.
 */
export type AppVolumeAction =
  | { type: 'appVolume'; action: 'setMute'; match: AppVolumeMatch; muted: boolean }
  | { type: 'appVolume'; action: 'toggleMute'; match: AppVolumeMatch }

/* ------------------------------------------------------------------ */
/* PC audio devices                                                     */
/* ------------------------------------------------------------------ */

/** Which system default an audio-device action or state refers to. */
export type AudioDeviceKind = 'output' | 'input'

/** Cosmetic picker tag for an endpoint (e.g. `USB`, `BT`, `HDMI`). */
export type AudioDeviceForm =
  | 'speakers'
  | 'headphones'
  | 'headset'
  | 'microphone'
  | 'usb'
  | 'bluetooth'
  | 'hdmi'
  | 'virtual'
  | 'other'

/**
 * A desktop-config-owned device target.
 *
 * `id` is a host-generated opaque key (a hash of the OS endpoint id), never a
 * registry key or endpoint path. `name` is the friendly-name fallback used when
 * the OS recreates the endpoint id after a driver update. The schema requires
 * at least one of the two; both ids and names are resolved on the desktop only.
 */
export interface AudioDeviceRef {
  /** Opaque host key, 1..128 safe characters. */
  id?: string
  /** Friendly name fallback, 1..120 characters. */
  name?: string
}

/**
 * Set the default output/input, or cycle through an ordered 2..8 target list.
 *
 * Staged union: `ActionSchema` (including `rigStepActionSchema`) already accepts
 * this shape so new configs validate and round-trip. P1 adds it to
 * `PlannableAction` and the desktop plan/executor; it stays out of `Action`,
 * `ConfigAction`, `RigStepAction` and `StateBinding` until the editor and phone
 * readback land (so the existing renderer keeps compiling).
 *
 * `allRoles` is Windows-only (console + multimedia + communications, default
 * true); macOS and Linux have one system-wide default per direction.
 */
export type AudioDeviceAction =
  | {
      type: 'audioDevice'
      action: 'set'
      kind: AudioDeviceKind
      device: AudioDeviceRef
      allRoles?: boolean
    }
  | {
      type: 'audioDevice'
      action: 'cycle'
      kind: AudioDeviceKind
      /** Ordered 2..8 targets. Two targets make it a toggle. */
      devices: AudioDeviceRef[]
      allRoles?: boolean
    }

/**
 * Read-only current-default tile read through `control-state-v1`.
 *
 * Staged union: accepted by `StateBindingSchema`, but not yet part of
 * `StateBinding`; P1/P4 add runtime readback and renderer/phone display.
 * Without `device` the tile is a generic Output/Input readout. With it, the
 * tile is active only while that target is the current default.
 */
export interface AudioDeviceStateBinding {
  type: 'audioDevice'
  target: AudioDeviceKind
  device?: AudioDeviceRef
}

/* ------------------------------------------------------------------ */
/* Rig presets                                                          */
/* ------------------------------------------------------------------ */

/**
 * A read-only environment check evaluated before a rig starts. `expect`
 * defaults to true; `expect: false` means "only run if NOT …".
 *
 * `arg` is the process/application name for `appRunning` (required) and the
 * configured light id for `lightOn` (optional = first light).
 */
export type RigGuardProbe =
  | 'obsStreaming'
  | 'obsRecording'
  | 'twitchLive'
  | 'micMuted'
  | 'appRunning'
  | 'lightOn'

export interface RigGuard {
  probe: RigGuardProbe
  /** Default true. False inverts the probe ("run only if not …"). */
  expect?: boolean
  /** Process name for `appRunning`; light id for `lightOn`. */
  arg?: string
  /** Optional display override; defaults to `describeRigGuard`. */
  label?: string
}

/**
 * One host action allowed inside a rig step.
 *
 * Deliberately explicit: page navigation, phone-local keyboard/mixer launchers
 * and nested rigs are not valid steps, so a rig can never recurse or move the
 * phone away while it runs. AppVolume is already accepted by the schema and the
 * planner; it stays outside `PlannableAction` until the renderer catches up.
 *
 * `AudioDeviceAction` is excluded statically: the schema accepts it (and the
 * host planner/executor handle the resulting step), but the editor's rig-step
 * picker union is still narrow. P3 widens the renderer and removes this
 * exclusion.
 */
export type RigStepAction =
  | Exclude<PlannableAction, PageAction | AudioDeviceAction>
  | AppVolumeAction

export interface RigStep {
  /** Optional stable id, unique within its rig. */
  id?: string
  /** Defaults to `describeAction(action)`, ≤60 chars. */
  label?: string
  action: RigStepAction
  /** Pause after a successful step, 0..10000 ms. */
  delayMs?: number
  /** Overrides the rig's `onError` for this step. */
  continueOnError?: boolean
}

/**
 * A named, guarded, ordered list of existing host actions.
 *
 * A rig is not a transaction: there is no rollback and no automatic retry.
 * Guards run first; the desktop runs one rig at a time.
 */
export interface RigPreset {
  id: string
  /** 1..60 chars. */
  name: string
  icon?: string
  /** ≤140 chars. */
  description?: string
  /** 1..32 steps, executed in order. */
  steps: RigStep[]
  /** 0..8 guards, evaluated before the first step. */
  guards?: RigGuard[]
  /** Default `failFast`. */
  onError?: 'failFast' | 'continue'
  /** 1000..600000 ms, default 120000. */
  deadlineMs?: number
}

/**
 * A button action that starts one configured rig.
 *
 * Staged union: this is intentionally NOT part of `Action` or `ConfigAction`
 * yet. The schema accepts it so new configs validate and round-trip, while old
 * renderers keep compiling against the narrower union. The renderer widening
 * lands in P3 (P1/P2 only consume it structurally through `rigs.ts`).
 */
export interface RigRunAction {
  type: 'rig'
  action: 'run'
  /** Existing `DeckConfig.rigs[].id`. */
  presetId: string
}

/**
 * A status tile that shows the last run of one rig through `control-state-v1`.
 *
 * Staged union: like `RigRunAction`, it is accepted by the schema but not added
 * to `StateBinding` until the renderers can display it.
 */
export interface RigStateBinding {
  type: 'rig'
  presetId: string
}

/* ------------------------------------------------------------------ */
/* Event rules                                                          */
/* ------------------------------------------------------------------ */

/**
 * A state transition that may fire a rule.
 *
 * Edges, not levels: a boolean trigger carries the *desired* state and fires
 * only when the observed state changes to it. `obs.scene` and `process.*` are
 * discrete edges produced by their adapters. This is deliberately a closed
 * union: a wrong field is a schema error, not a runtime surprise.
 */
export type EventTrigger =
  | {
      kind: 'obs.streaming' | 'obs.recording' | 'obs.replay' | 'twitch.live'
      /** Desired state. `false` = the "stopped/offline" edge. */
      active: boolean
    }
  | { kind: 'obs.scene'; scene: string }
  | { kind: 'process.started' | 'process.stopped'; process: string }
  | { kind: 'phone.connected' | 'phone.disconnected' }

export type EventTriggerKind = EventTrigger['kind']

/**
 * One ordered, reference-only action inside a rule.
 *
 * A rule never executes a host action directly: `runRig` calls the same
 * `RigRunner` as a button, `showProfile`/`showPage` reuse the existing server
 * broadcasts, and `notice` is phase 2. `kind` (not `type`) keeps these visually
 * distinct from button `Action` members. There is no inline `Action[]`.
 */
export type RuleAction =
  | { kind: 'runRig'; presetId: string }
  | { kind: 'showProfile'; profileId: string }
  /** Switch profile first when needed, then `navigate {direction:'goto'}`. */
  | { kind: 'showPage'; profileId: string; pageId: string }
  /** Phase 2, requires `notice-v1`. */
  | { kind: 'notice'; text: string }

/**
 * A config-owned automation: trigger → conditions → reference-only actions.
 *
 * Additive in schema version 1. Rules are disarmed on every PC through
 * `settings.automationEnabled`, never through a config field.
 */
export interface EventRule {
  /** Stable id, unique in the config; `rule-1` style. */
  id: string
  /** 1..60 chars. */
  name: string
  /** Manual per-rule switch, default true. */
  enabled?: boolean
  trigger: EventTrigger
  /** Reuse the rig guard vocabulary; ALL must pass, fail closed. 0..4. */
  conditions?: RigGuard[]
  /** 1..4, executed in order. */
  actions: RuleAction[]
  /** Stability window before executing; default 1500. 0..30000. */
  debounceMs?: number
  /** Minimum gap between two fires of this rule; default 10000. 0..3600000. */
  cooldownMs?: number
  /** `runRig` hit an active run: `skip` (default) or run the rest. */
  onBusy?: 'skip' | 'continue'
}

export type RuleRunStatus =
  | 'ok'
  | 'partial'
  | 'failed'
  | 'blocked'
  | 'busy'
  | 'missing'
  | 'skipped'
  | 'throttled'

export interface RuleActionOutcome {
  kind: RuleAction['kind']
  ok: boolean
  /** Human target, e.g. `Go live`, `Streaming / Gameplay`, `3 phones`. */
  target?: string
  message?: string
}

/**
 * One in-memory run-history row. Newest first, capped at `RULE_HISTORY_MAX`.
 * Never persisted; contains no secrets.
 */
export interface RuleHistoryEntry {
  seq: number
  ruleId: string
  ruleName: string
  /** End time in ms; the renderer formats `NOW`/`12m`/`3h`. */
  at: number
  /** One-line trigger summary. */
  trigger: string
  status: RuleRunStatus
  /** Why it was skipped/blocked, first error, or success summary. */
  detail?: string
  durationMs: number
  source: 'event' | 'manual'
  actions: RuleActionOutcome[]
}

/**
 * One mixer channel. `id` is desktop-defined and opaque (stable while the
 * session lives); `process` is the normalized match name and `name` is the
 * display name. `volume` is 0..100.
 */
export interface MixerSession {
  id: string
  process: string
  name: string
  volume: number
  muted: boolean
  /** False when the session vanished after the snapshot was requested. */
  available?: boolean
}

/**
 * Full-screen mixer snapshot. `ambiguous` lists process names that produced
 * more than one live session. Also the shape used by the `mixerState` wire
 * message (additive, `mixer-v1`).
 */
export interface MixerSnapshot {
  available: boolean
  sessions: MixerSession[]
  /** Normalized process names with more than one live session. */
  ambiguous?: string[]
  /** Why the mixer is unavailable (unsupported platform, helper missing). */
  reason?: string
  updatedAt: number
}

/**
 * Live mixer snapshot pushed to a subscribed phone. Old peers that never send
 * `mixer` simply never receive it.
 */
export interface MixerStateMessage {
  type: 'mixerState'
  available: boolean
  sessions: MixerSession[]
  /** Why the mixer is unavailable (unsupported platform, helper missing). */
  reason?: string
  /** Desktop clock in ms when this snapshot was produced. */
  updatedAt: number
}

/** State binding union; OBS, Twitch, light and per-app status tiles. */
export type StateBinding =
  | ObsStateBinding
  | TwitchStateBinding
  | LightStateBinding
  | AppVolumeStateBinding

/**
 * A key wheel: one chord per dial detent or slider slice.
 *
 * `holdKeys` are pressed (key down) on the first movement of a gesture and
 * released when it ends; they are never part of the emitted chord. The reverse
 * direction sends `reverseKeys` when provided, otherwise `keys`.
 */
export interface ShortcutBinding {
  type: 'shortcut'
  /** Chord for positive movement (right/up/clockwise). 1..8 keys. */
  keys: string[]
  /** Chord for negative movement. Defaults to `keys`. */
  reverseKeys?: string[]
  /** Keys held down for the whole gesture (e.g. ALT for the app switcher). */
  holdKeys?: string[]
  /** Repeat each chord 1..5 times. Default 1. */
  repeat?: number
  /** Slider slices across the full track, 4..100. Default 20. Dials ignore it. */
  travelSteps?: number
}

/**
 * A media scrub control for the active media session.
 *
 * The wire value is normalized 0..1. `commit: 'end'` (recommended) sends only
 * the final position; `commit: 'live'` may send throttled updates while
 * dragging. `display: 'time'` renders the mono `1:23 / 3:45` readout.
 */
export interface MediaBinding {
  type: 'media'
  target: 'position'
}

/**
 * A modifier held around a scroll gesture, e.g. Ctrl+wheel for zoom.
 * Aliases (`Control`, `Cmd`, `Option`, …) are normalized by the schema.
 */
export type ScrollModifier = ModifierKey

/**
 * Mouse-wheel control. Optional `modifiers` turn it into Ctrl+wheel zoom or
 * Shift+wheel horizontal scroll; they are pressed around each wheel notch.
 */
export interface ScrollBinding {
  type: 'scroll'
  axis: 'vertical' | 'horizontal'
  /** Reverse the wheel direction. */
  invert?: boolean
  /**
   * Modifiers held down around the wheel notch (Ctrl+wheel zoom, Shift+wheel
   * horizontal scroll). Pressed in order, released in reverse order.
   */
  modifiers?: ScrollModifier[]
}

/**
 * What a continuous control drives.
 *
 * Relative volume emits deltas that become repeated media-volume keys. Absolute
 * volume emits a normalized 0..1 value and sets the system volume directly.
 */
export type ControlBinding =
  | {
      type: 'volume'
      mode: 'relative'
      /** Percent per full slider travel or dial tick. 1..25, default 2. */
      stepPercent?: number
    }
  | {
      type: 'volume'
      mode: 'absolute'
      /** Not used in absolute mode; kept for older renderer type access. */
      stepPercent?: never
    }
  | ScrollBinding
  | {
      /** Default capture device gain (MVP: gain only, no device picker). */
      type: 'mic'
      mode: 'gain'
    }
  | ObsInputVolumeBinding
  | LightBinding
  | AppVolumeBinding
  | ShortcutBinding
  | MediaBinding

/**
 * Pointer binding used by a `trackpad` control.
 *
 * Pointer input travels over the `pointer` message, not the `input` message, and
 * never synthesises an `Action`.
 */
export interface PointerBinding {
  type: 'pointer'
  /**
   * How the phone exposes the pad. `inline` turns the deck tile itself into
   * the pad (default); `fullscreen` makes the tile a launcher for the
   * full-screen pad.
   */
  mode?: 'inline' | 'fullscreen'
  /** Cursor gain multiplier, 0.25..3, default 1. */
  sensitivity?: number
  /** Two-finger scroll follows finger movement (default true). */
  naturalScroll?: boolean
  /** Default true. */
  tapToClick?: boolean
  /** Default true. */
  dragLock?: boolean
}

/** Slider or dial control rendered instead of a tap-only tile. */
export interface SliderOrDialControlSpec {
  kind: 'slider' | 'dial'
  /** Slider direction; dials may ignore it. */
  axis?: 'horizontal' | 'vertical'
  emit: 'value' | 'delta'
  binding: ControlBinding
  /** Slider/dial display range. Runtime values are never stored in the config. */
  min?: number
  max?: number
  step?: number
  initial?: number
  unit?: string
  /** Defaults to true in renderers when omitted. */
  haptics?: boolean
  /**
   * Default 'live'. 'end' applies only the final value of a gesture; use it for
   * expensive backends such as media seek.
   */
  commit?: 'live' | 'end'
  /** Display formatter; default 'raw'. Media scrub usually uses 'time'. */
  display?: 'raw' | 'percent' | 'time'
}

/**
 * Trackpad launch tile: tapping it opens the full-screen pointer pad on the
 * phone. Kept separate from sliders/dials so a pointer binding cannot be
 * attached to a value control.
 */
export interface TrackpadControlSpec {
  kind: 'trackpad'
  emit: 'delta'
  binding: PointerBinding
  haptics?: boolean
}

/** Continuous control rendered instead of a tap-only tile. */
export type ControlSpec = SliderOrDialControlSpec | TrackpadControlSpec

export interface DeckButton {
  id: string
  /** Zero-based anchor index (top-left cell) in the profile grid. */
  slot: number
  label: string
  sublabel?: string
  /** Short emoji or text shown above the label. Also the fallback for iconMedia. */
  icon?: string
  /** Preferred over `icon` when present. */
  iconMedia?: MediaIcon
  /** Overrides the profile's default button background. */
  background?: Background
  textColor?: HexColor
  actions: Action[]
  /** Optional continuous control rendered instead of a tap-only tile. */
  control?: ControlSpec
  /** Optional read-only status shown on a normal tap tile (OBS phase 2). */
  state?: StateBinding
  /** Optional footprint; omitted = 1x1. */
  span?: CellSpan
}

export interface DeckPage {
  id: string
  name: string
  /** Optional page-wide background override. */
  background?: Background
  /** Optional per-page grid override. Omitted = inherit profile.grid. */
  grid?: GridSettings
  buttons: DeckButton[]
}

export interface DeckProfile {
  id: string
  name: string
  grid: GridSettings
  theme: ProfileTheme
  pages: DeckPage[]
  defaultPageId: string
}

export interface DeckConfig {
  schemaVersion: typeof CONFIG_SCHEMA_VERSION
  /** ISO timestamp, maintained by the desktop store. */
  updatedAt: string
  /** Friendly name shown on the phone. */
  serverName: string
  defaultProfileId: string
  profiles: DeckProfile[]
  /**
   * Optional config-owned rig presets. Additive in schema version 1: configs
   * without rigs stay byte-identical after round-trip.
   */
  rigs?: RigPreset[]
  /**
   * Optional event → rig/profile/page automations. Additive in schema version
   * 1: configs without rules stay byte-identical after round-trip. Armed per
   * installation through `settings.automationEnabled`, never through config.
   */
  rules?: EventRule[]
}

/* ------------------------------------------------------------------ */
/* Action execution plans (shared by desktop executor and tests)       */
/* ------------------------------------------------------------------ */

export interface KeyPlanStep {
  kind: 'keys'
  keys: string[]
  holdMs: number
  action: 'press' | 'down' | 'up'
}

export interface TextPlanStep {
  kind: 'text'
  text: string
  perCharMs: number
}

export interface DelayPlanStep {
  kind: 'delay'
  ms: number
}

export interface MediaPlanStep {
  kind: 'media'
  key: MediaKey
}

export interface MousePlanStep {
  kind: 'mouse'
  button: MouseButton
  action: MouseAction
  x?: number
  y?: number
  direction?: 'up' | 'down' | 'left' | 'right'
  amount?: number
}

export interface LaunchPlanStep {
  kind: 'launch'
  path: string
  args: string[]
}

export interface UrlPlanStep {
  kind: 'url'
  url: string
}

export interface CommandPlanStep {
  kind: 'command'
  command: string
  cwd?: string
  hidden: boolean
}

export interface PagePlanStep {
  kind: 'page'
  direction: 'next' | 'prev' | 'goto'
  pageId?: string
}

export interface MicPlanStep {
  kind: 'mic'
  action: 'toggleMute'
}

export type ObsPlanStep =
  | { kind: 'obs'; action: 'toggleMute'; input?: string }
  | { kind: 'obs'; action: 'setScene'; scene?: string }
  | { kind: 'obs'; action: 'toggleStream' | 'startStream' | 'stopStream' }
  | { kind: 'obs'; action: 'toggleRecord' | 'startRecord' | 'stopRecord' }
  | { kind: 'obs'; action: 'startReplay' | 'stopReplay' | 'toggleReplay' | 'saveReplay' }
  | { kind: 'obs'; action: 'toggleVirtualCam' }
  | {
      kind: 'obs'
      action: 'setSourceVisibility'
      scene?: string
      source: string
      visible: boolean
    }
  | { kind: 'obs'; action: 'toggleSourceVisibility'; scene?: string; source: string }
  | { kind: 'obs'; action: 'addMarker'; name?: string }

export type TwitchPlanStep =
  | { kind: 'twitch'; action: 'sendChat'; message: string }
  | { kind: 'twitch'; action: 'createMarker'; description?: string }
  | { kind: 'twitch'; action: 'setTitle'; title: string }
  | { kind: 'twitch'; action: 'setGame'; game: string }

export type LightPlanStep =
  | { kind: 'light'; action: 'setPower'; light?: string; on: boolean }
  | { kind: 'light'; action: 'togglePower'; light?: string }

export type AppVolumePlanStep =
  | { kind: 'appVolume'; action: 'setMute'; match: AppVolumeMatch; muted: boolean }
  | { kind: 'appVolume'; action: 'toggleMute'; match: AppVolumeMatch }

export interface StreamerBotPlanStep {
  kind: 'streamerbot'
  action: 'doAction'
  actionName: string
  args?: Record<string, string>
}

/**
 * Switch (or cycle) the OS default output/input device.
 *
 * The refs are copied from the config action; resolution against the live host
 * enumeration happens in the desktop controller, never in the plan builder.
 * `allRoles` is Windows-only (console + multimedia + communications).
 */
export type AudioDevicePlanStep =
  | {
      kind: 'audioDevice'
      action: 'set'
      deviceKind: AudioDeviceKind
      device: AudioDeviceRef
      allRoles?: boolean
    }
  | {
      kind: 'audioDevice'
      action: 'cycle'
      deviceKind: AudioDeviceKind
      devices: AudioDeviceRef[]
      allRoles?: boolean
    }

export type PlanStep =
  | KeyPlanStep
  | TextPlanStep
  | DelayPlanStep
  | MediaPlanStep
  | MousePlanStep
  | LaunchPlanStep
  | UrlPlanStep
  | CommandPlanStep
  | PagePlanStep
  | MicPlanStep
  | ObsPlanStep
  | TwitchPlanStep
  | LightPlanStep
  | AppVolumePlanStep
  | StreamerBotPlanStep
  | AudioDevicePlanStep

export type KeyboardPlanStep = KeyPlanStep | TextPlanStep | DelayPlanStep | MediaPlanStep | MousePlanStep

/**
 * A contiguous slice of a plan that can fail/pause independently. A rig step
 * maps to one group (a macro expands into many plan steps but stays one group),
 * so `continueOnError` and `delayMs` apply at the rig-step boundary.
 *
 * Existing button presses remain a single implicit group; the executor
 * refactor in P1 makes `execute()` a one-group call.
 */
export interface PlanGroup {
  label: string
  steps: PlanStep[]
  /** Pause after the group succeeds, in milliseconds. */
  delayMs?: number
  /** Continue after a failed step instead of aborting the rig. */
  continueOnError?: boolean
}

/* ------------------------------------------------------------------ */
/* Wire protocol                                                       */
/* ------------------------------------------------------------------ */

export interface DeviceInfo {
  name: string
  model?: string
  appVersion?: string
}

export interface PressMessage {
  type: 'press'
  requestId: string
  profileId: string
  pageId: string
  buttonId: string
}

/** Continuous-control input: relative deltas are coalesced on the desktop. */
export interface InputMessage {
  type: 'input'
  requestId: string
  profileId: string
  pageId: string
  controlId: string
  phase: 'start' | 'move' | 'end'
  /** Absolute value (0..1) for future value controls; unused by the MVP. */
  value?: number
  /** Signed delta for relative controls. */
  delta?: number
}

/**
 * Subscribe to live state for the controls on the visible page. One
 * subscription per connection; the last watch replaces the previous one.
 * An empty `controlIds` drops the subscription.
 */
export interface WatchMessage {
  type: 'watch'
  profileId: string
  pageId: string
  /** 0..32 control ids; omitted = every continuous control on the page. */
  controlIds?: string[]
  /** Poll interval while a subscribed control is visible. Default 1000 ms. */
  intervalMs?: number
}

/** Keyboard text/chord entry from the phone. */
export type KeyboardPhase = 'start' | 'text' | 'key' | 'release' | 'end' | 'cancel' | 'keepalive'

export interface KeyboardStartMessage {
  type: 'keyboard'
  seq: number
  phase: 'start'
  profileId: string
  pageId: string
  controlId: string
}

export interface KeyboardTextMessage {
  type: 'keyboard'
  seq: number
  phase: 'text'
  /** UTF-16 text, at most 4096 characters per message. */
  text: string
}

export interface KeyboardKeyMessage {
  type: 'keyboard'
  seq: number
  phase: 'key'
  /** Chord, e.g. ["CTRL", "C"] or ["BACKSPACE"]; max 8 keys. */
  keys: string[]
  /** Repeat the chord 1..100 times. */
  repeat?: number
  /**
   * Physical key state. `press` (default) taps the chord; `down`/`up` let the
   * phone hold Shift/Tab or stream a live key while the finger is down.
   */
  action?: 'press' | 'down' | 'up'
}

export interface KeyboardSimpleMessage {
  type: 'keyboard'
  seq: number
  /**
   * Release latched keys/modifiers, finish, abort, or refresh the held-key
   * watchdog while a key is kept down (no key state changes).
   */
  phase: 'release' | 'end' | 'cancel' | 'keepalive'
}

export type KeyboardMessage =
  | KeyboardStartMessage
  | KeyboardTextMessage
  | KeyboardKeyMessage
  | KeyboardSimpleMessage

/** Sent for rejected messages and once on end/cancel; text/key frames are not acked. */
export interface KeyboardResult {
  seq: number
  ok: boolean
  error?: string
}

/**
 * Subscribe to the live per-app mixer for this connection. One subscription
 * per client; `stop` (or closing the socket) releases it. The desktop sends an
 * immediate `mixerState` snapshot and then polls at ~1 Hz while subscribed.
 */
export interface MixerMessage {
  type: 'mixer'
  phase: 'start' | 'stop'
}

/**
 * Set one mixer channel by session id. At least one of `volume`/`muted` must
 * be present; both may be sent to apply volume and mute together.
 */
export interface MixerCommandMessage {
  type: 'mixerCommand'
  requestId: string
  /** Opaque desktop session id from the latest `mixerState`. 1..512 chars. */
  sessionId: string
  /** 0..100 percent; clamped by the desktop. */
  volume?: number
  muted?: boolean
}

/** Acknowledges a `mixerCommand` (success or a human-readable error). */
export interface MixerResult {
  requestId: string
  ok: boolean
  error?: string
}

/**
 * One audio endpoint row in a live device list. `id` is an opaque host key;
 * `name` is the sanitized friendly name. `form` is a cosmetic picker tag and
 * `detail` an optional short host note.
 */
export interface AudioDeviceEntry {
  id: string
  name: string
  deviceKind: AudioDeviceKind
  form?: AudioDeviceForm
  /** True while this endpoint is the current OS default for its kind. */
  current: boolean
  /** False when the endpoint vanished after the snapshot was requested. */
  available: boolean
  /** Optional short display detail, ≤64 chars. */
  detail?: string
}

/**
 * Subscribe to (or stop) the live audio-device panel for this connection. The
 * desktop replies with an immediate `audioDevicesState` and then polls while
 * subscribed. Additive: old peers ignore it and never receive state.
 */
export interface AudioDevicesMessage {
  type: 'audioDevices'
  phase: 'start' | 'stop'
}

/**
 * Set the OS default device by opaque id. The phone never sends a name or path:
 * the desktop validates the id against its latest enumeration.
 */
export interface AudioDeviceSetMessage {
  type: 'audioDeviceSet'
  requestId: string
  deviceKind: AudioDeviceKind
  /** Opaque id from the latest `audioDevicesState`, 1..64 chars. */
  deviceId: string
}

/** Server → subscribed phone: live audio-device snapshot (~1 Hz). */
export interface AudioDevicesStateMessage {
  type: 'audioDevicesState'
  available: boolean
  /** Why switching is unavailable (unsupported platform, helper missing). */
  reason?: string
  output: AudioDeviceEntry[]
  input: AudioDeviceEntry[]
  currentOutputId?: string
  currentInputId?: string
  /** Desktop clock in ms when this snapshot was produced. */
  updatedAt: number
}

/** Acknowledges an `audioDeviceSet` (success or a human-readable error). */
export interface AudioDeviceResult {
  requestId: string
  ok: boolean
  error?: string
  /** The new current endpoint id for the requested kind, when known. */
  currentId?: string
}

export type ClientMessage =
  | {
      type: 'hello'
      protocol: typeof PROTOCOL_VERSION
      device: DeviceInfo
      /** Optional feature markers advertised by the phone. */
      capabilities?: string[]
    }
  | PressMessage
  | InputMessage
  | PointerMessage
  | WatchMessage
  | KeyboardMessage
  | MixerMessage
  | MixerCommandMessage
  | AudioDevicesMessage
  | AudioDeviceSetMessage
  | { type: 'ping'; t: number }

/* ------------------------------------------------------------------ */
/* Pointer / trackpad protocol                                        */
/* ------------------------------------------------------------------ */

export type PointerButton = 'left' | 'right' | 'middle'
export type PointerButtonAction = 'down' | 'up' | 'click' | 'doubleclick'
export type PointerPhase = 'start' | 'move' | 'end' | 'cancel'

/** Ordered button transition; `click` expands atomically on the desktop. */
export interface PointerButtonEvent {
  button: PointerButton
  action: PointerButtonAction
}

/** Binds a gesture to a trackpad control so the desktop can resolve settings. */
export interface PointerStartMessage {
  type: 'pointer'
  /** Per-connection monotonic integer; the desktop ignores stale/duplicate seq. */
  seq: number
  phase: 'start'
  profileId: string
  pageId: string
  controlId: string
}

/**
 * Relative movement, scroll notches and/or button transitions.
 *
 * `dx`/`dy` are fractions of the pad height (+right/+down); `scrollX`/`scrollY`
 * are wheel notches (+right/+up). `end` does not imply a button release.
 */
export interface PointerMoveMessage {
  type: 'pointer'
  seq: number
  phase: 'move' | 'end'
  /** Clamped to ±2 on both ends. */
  dx?: number
  dy?: number
  /** Clamped to ±10 notches on both ends. */
  scrollX?: number
  scrollY?: number
  /** At most 4 ordered transitions. */
  buttons?: PointerButtonEvent[]
}

/** Abort a gesture; the desktop releases every held button. */
export interface PointerCancelMessage {
  type: 'pointer'
  seq: number
  phase: 'cancel'
}

export type PointerMessage = PointerStartMessage | PointerMoveMessage | PointerCancelMessage

/** Sent on a rejected `start` and once on `end`/`cancel`; moves are not acked. */
export interface PointerResult {
  seq: number
  ok: boolean
  error?: string
}

/** Transient phone window brightness; null restores system/auto brightness. */
export interface BrightnessMessage {
  type: 'brightness'
  /** 0..1, or null for the system default. */
  level: number | null
}

/**
 * Ask every connected phone to show another profile. Sent by the desktop when
 * an auto-profile rule matches a newly launched process. Additive: older
 * phones ignore unknown server messages and keep their current profile.
 */
export interface ProfileMessage {
  type: 'profile'
  /** Existing profile id from the deck config. */
  profileId: string
}

/** Live state for one control the phone is watching. */
export interface ControlStateEntry {
  controlId: string
  /** Monotonic per control; the phone ignores older revisions. */
  revision: number
  /** Normalized 0..1 for value controls. */
  value?: number
  muted?: boolean
  /** On/off/live/visible for status and toggle tiles (additive). */
  active?: boolean
  /** False when the backend is missing or the value is unknown. */
  available: boolean
  /** Optional short display string, e.g. "42%", "LIVE", "REC", "GAME". */
  detail?: string
  /** Diagnostic reason; `detail` stays the short display string (additive). */
  error?: string
  /** Media only: elapsed position in milliseconds (additive). */
  positionMs?: number
  /** Media only: total duration in milliseconds (additive). */
  durationMs?: number
  /** Media only: whether the session is playing (additive). */
  playing?: boolean
  /** Media only: current track title (additive). */
  title?: string
  /** Media only: current track artist (additive). */
  artist?: string
}

/** Batched state snapshot; sent immediately on watch and then on change/interval. */
export interface ControlStateMessage {
  type: 'controlState'
  profileId: string
  pageId: string
  states: ControlStateEntry[]
}

/** Final status of one rig run. `partial` is a failure with some steps done. */
export type RigRunStatus = 'ok' | 'partial' | 'failed' | 'blocked' | 'cancelled' | 'timeout' | 'busy'

/**
 * Live rig progress, sent only to clients that advertised `rig-v1`.
 *
 * - `start`: the run was accepted; `index` is 0 and `total` is the step count.
 * - `step`: `index` is the 1-based step that just finished.
 * - `done`: the run ended; `status`/`ok`/`durationMs` are populated.
 */
export interface RigProgressMessage {
  type: 'rigProgress'
  phase: 'start' | 'step' | 'done'
  presetId: string
  /** Present when the run was started from a deck button. */
  buttonId?: string
  /** 1-based step index; 0 on `start`. */
  index: number
  total: number
  /** Step label or rig name, ≤60 chars. */
  label?: string
  status?: RigRunStatus
  ok?: boolean
  error?: string
  durationMs?: number
}

export type ServerMessage =
  | {
      type: 'hello'
      protocol: typeof PROTOCOL_VERSION
      serverName: string
      config: DeckConfig
      /** Server clock in ms, used to detect skew. */
      serverTime: number
      /** Optional feature markers (additive; older servers omit this). */
      capabilities?: string[]
    }
  | { type: 'config'; config: DeckConfig }
  | { type: 'pressResult'; requestId: string; buttonId: string; ok: boolean; error?: string; message?: string }
  | { type: 'inputResult'; requestId: string; controlId: string; ok: boolean; error?: string }
  | ({ type: 'pointerResult' } & PointerResult)
  | BrightnessMessage
  | ProfileMessage
  | ControlStateMessage
  | RigProgressMessage
  | MixerStateMessage
  | ({ type: 'mixerResult' } & MixerResult)
  | AudioDevicesStateMessage
  | ({ type: 'audioDeviceResult' } & AudioDeviceResult)
  | ({ type: 'keyboardResult' } & KeyboardResult)
  | { type: 'navigate'; direction: 'next' | 'prev' | 'goto'; pageId?: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; t: number }

export interface PressResult {
  ok: boolean
  error?: string
  /** Optional user-facing note, e.g. where a screenshot was saved. */
  message?: string
}

/** Result of a continuous-control input batch (sent on end or error). */
export interface InputResult {
  ok: boolean
  error?: string
}

export interface ConnectedClient {
  id: string
  address: string
  device: DeviceInfo | null
  connectedAt: number
  lastSeenAt: number
  /** Feature markers from the phone's hello (e.g. `brightness-v1`). */
  capabilities?: string[]
  /** Last brightness level sent this connection; null = system. */
  brightnessLevel?: number | null
}

/* ------------------------------------------------------------------ */
/* Pairing                                                             */
/* ------------------------------------------------------------------ */

export interface PairPayload {
  host: string
  port: number
  token: string
  name?: string
  version: typeof PROTOCOL_VERSION
}

export interface DiscoveryBeacon {
  magic: typeof DISCOVERY_MAGIC
  protocol: typeof PROTOCOL_VERSION
  type: 'beacon'
  name: string
  port: number
  version: string
}

export interface DiscoverProbe {
  magic: typeof DISCOVERY_MAGIC
  protocol: typeof PROTOCOL_VERSION
  type: 'discover'
}
