/**
 * PhoneDeck shared model.
 *
 * This is the contract between the desktop configurator and the Android deck.
 * Keep it JSON-serializable: no Dates, Maps or class instances.
 */

export const PROTOCOL_VERSION = 1 as const
export const CONFIG_SCHEMA_VERSION = 1 as const

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
 * The MVP only supports *relative* bindings: a slider/dial emits deltas and the
 * desktop turns them into repeated media-volume steps or mouse-wheel scrolls.
 * Absolute values (level, position, arbitrary targets) are a later phase.
 */
export type ControlBinding =
  | {
      type: 'volume'
      mode: 'relative'
      /** Percent per full slider travel or dial tick. 1..25, default 2. */
      stepPercent?: number
    }
  | {
      type: 'scroll'
      axis: 'vertical' | 'horizontal'
      /** Reverse the wheel direction. */
      invert?: boolean
    }

/** Continuous control rendered instead of a tap-only tile. */
export interface ControlSpec {
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

export type ClientMessage =
  | { type: 'hello'; protocol: typeof PROTOCOL_VERSION; device: DeviceInfo }
  | PressMessage
  | { type: 'ping'; t: number }

export type ServerMessage =
  | {
      type: 'hello'
      protocol: typeof PROTOCOL_VERSION
      serverName: string
      config: DeckConfig
      /** Server clock in ms, used to detect skew. */
      serverTime: number
    }
  | { type: 'config'; config: DeckConfig }
  | { type: 'pressResult'; requestId: string; buttonId: string; ok: boolean; error?: string }
  | { type: 'navigate'; direction: 'next' | 'prev' | 'goto'; pageId?: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; t: number }

export interface PressResult {
  ok: boolean
  error?: string
}

export interface ConnectedClient {
  id: string
  address: string
  device: DeviceInfo | null
  connectedAt: number
  lastSeenAt: number
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
