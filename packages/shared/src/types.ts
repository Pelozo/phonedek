/**
 * PhoneDeck shared model.
 *
 * This is the contract between the desktop configurator and the Android deck.
 * Keep it JSON-serializable: no Dates, Maps or class instances.
 */

export const PROTOCOL_VERSION = 1 as const
export const CONFIG_SCHEMA_VERSION = 1 as const

/** Phone capability for transient window-brightness control (0..1 / system). */
export const BRIGHTNESS_CAPABILITY = 'brightness-v1' as const

/** Desktop capability for trackpad/pointer control over the `pointer` message. */
export const POINTER_CAPABILITY = 'pointer-v1' as const

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

/** Footprint of a button measured in grid cells. */
export interface CellSpan {
  /** 1..10 cells wide. */
  columns: number
  /** 1..10 cells tall. MVP renderers may only honour rows = 1. */
  rows: number
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
  | {
      type: 'scroll'
      axis: 'vertical' | 'horizontal'
      /** Reverse the wheel direction. */
      invert?: boolean
    }

/**
 * Pointer binding used by a `trackpad` control.
 *
 * Pointer input travels over the `pointer` message, not the `input` message, and
 * never synthesises an `Action`.
 */
export interface PointerBinding {
  type: 'pointer'
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

export type KeyboardPlanStep = KeyPlanStep | TextPlanStep | DelayPlanStep | MediaPlanStep | MousePlanStep

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
