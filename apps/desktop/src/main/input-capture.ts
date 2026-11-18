import { createRequire } from 'node:module'
import type { MouseButton, RawKeyEvent, RawMouseEvent } from '@phonedek/shared'
import { IPC } from '../shared/api'
import type {
  MacroCaptureStartInput,
  MacroCaptureStartResult,
  MacroCaptureStopResult,
  MacroCaptureSupportView,
} from '../shared/api'
import type { Logger } from './logger'

/**
 * Global macro capture built on libuiohook (`uiohook-napi`).
 *
 * The native module is required lazily and only from the main process. Tests
 * inject a fake hook, and unsupported hosts (Wayland, a missing/broken prebuild)
 * fall back to focused recording instead of failing app startup.
 *
 * Security note: libuiohook does not expose an "injected" event flag, so input
 * injected by the phone's own actions cannot be distinguished from real input.
 * If a phone button fires while recording, that action may become a macro step.
 */
export const MACRO_CAPTURE_STOP_HOTKEY = 'CommandOrControl+Alt+F10'

export type HookEventName = 'keydown' | 'keyup' | 'mousedown' | 'mouseup' | 'mousemove' | 'wheel'

export interface HookKeyboardEvent {
  type: 'keydown' | 'keyup'
  keycode: number
  time: number
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
  /** Platform adapters may flag injected events; libuiohook never sets it. */
  synthetic?: boolean
}

export interface HookMouseButtonEvent {
  type: 'mousedown' | 'mouseup'
  button: unknown
  x: number
  y: number
  time: number
  synthetic?: boolean
}

export interface HookMouseMoveEvent {
  type: 'mousemove'
  x: number
  y: number
  time: number
  synthetic?: boolean
}

export interface HookWheelEvent {
  type: 'wheel'
  /** libuiohook: 3 = vertical, 4 = horizontal. */
  direction: number
  /** Signed rotation; negative = up/left, positive = down/right. */
  rotation: number
  amount: number
  x: number
  y: number
  time: number
  synthetic?: boolean
}

export type HookEvent =
  | HookKeyboardEvent
  | HookMouseButtonEvent
  | HookMouseMoveEvent
  | HookWheelEvent

export interface HookLike {
  on(event: HookEventName, listener: (event: HookEvent) => void): unknown
  off?(event: HookEventName, listener: (event: HookEvent) => void): unknown
  removeListener?(event: HookEventName, listener: (event: HookEvent) => void): unknown
  start(): void
  stop(): void
}

export interface HookBundle {
  hook: HookLike
  /** The library's `UiohookKey` name → keycode table. */
  keys: Record<string, number>
}

export interface ShortcutLike {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface InputCaptureDeps {
  /** Lazy native-module loader; injected by tests. */
  hookFactory?: () => HookBundle
  shortcut?: ShortcutLike
  /** True while any PhoneDeck window has OS focus. */
  isSelfFocused?: () => boolean
  /** macOS Accessibility/Input Monitoring state; omitted on other platforms. */
  accessibilityGranted?: () => boolean
  /** Send a renderer event (usually `webContents.send`). */
  send?: (channel: string, payload: unknown) => void
  /** Native notification; failures are swallowed. */
  notify?: (title: string, body: string) => void
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  logger?: Logger
  now?: () => number
}

interface ActiveOptions {
  captureMouse: boolean
  captureMouseMove: boolean
  ignoreSelf: boolean
}

const NOOP_SHORTCUT: ShortcutLike = {
  register: () => false,
  unregister: () => undefined,
}

const NAMED_KEYS: Record<string, string> = {
  Backspace: 'BACKSPACE',
  Tab: 'TAB',
  Enter: 'ENTER',
  NumpadEnter: 'ENTER',
  CapsLock: 'CAPSLOCK',
  Escape: 'ESC',
  Space: 'SPACE',
  PageUp: 'PGUP',
  PageDown: 'PGDN',
  End: 'END',
  Home: 'HOME',
  ArrowLeft: 'LEFT',
  ArrowUp: 'UP',
  ArrowRight: 'RIGHT',
  ArrowDown: 'DOWN',
  Insert: 'INSERT',
  Delete: 'DELETE',
  Semicolon: ';',
  Equal: '=',
  Comma: ',',
  Minus: '-',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  BracketLeft: '[',
  Backslash: '\\',
  BracketRight: ']',
  Quote: "'",
  Ctrl: 'CTRL',
  CtrlRight: 'CTRL',
  Alt: 'ALT',
  AltRight: 'ALT',
  Shift: 'SHIFT',
  ShiftRight: 'SHIFT',
  Meta: 'WIN',
  MetaRight: 'WIN',
  NumLock: 'NUMLOCK',
  ScrollLock: 'SCROLLLOCK',
  PrintScreen: 'PRINTSCREEN',
  NumpadMultiply: '*',
  NumpadAdd: '+',
  NumpadSubtract: '-',
  NumpadDecimal: '.',
  NumpadDivide: '/',
  Numpad0: 'NUMPAD0',
  Numpad1: 'NUMPAD1',
  Numpad2: 'NUMPAD2',
  Numpad3: 'NUMPAD3',
  Numpad4: 'NUMPAD4',
  Numpad5: 'NUMPAD5',
  Numpad6: 'NUMPAD6',
  Numpad7: 'NUMPAD7',
  Numpad8: 'NUMPAD8',
  Numpad9: 'NUMPAD9',
}

/** Map one UiohookKey enum name to a canonical `keys.ts` name. */
export function canonicalKeyName(name: string): string | null {
  if (NAMED_KEYS[name]) return NAMED_KEYS[name]!
  if (/^[A-Z]$/.test(name)) return name
  if (/^[0-9]$/.test(name)) return name
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(name)) return name
  return null
}

/**
 * Build keycode → canonical-key lookup. Duplicate aliases (left/right
 * modifiers, numpad enter) resolve to the first name encountered.
 */
export function buildKeycodeMap(keys: Record<string, number>): Map<number, string> {
  const map = new Map<number, string>()
  for (const [name, code] of Object.entries(keys)) {
    if (!Number.isInteger(code) || code <= 0) continue
    const canonical = canonicalKeyName(name)
    if (!canonical) continue
    if (!map.has(code)) map.set(code, canonical)
  }
  return map
}

/** libuiohook mouse button numbers: 1 left, 2 right, 3 middle. */
export function mapMouseButton(button: unknown): MouseButton | null {
  if (button === 1) return 'left'
  if (button === 2) return 'right'
  if (button === 3) return 'middle'
  return null
}

/** Convert libuiohook's wheel axis/rotation/amount into a scroll step. */
export function mapWheel(
  direction: number,
  rotation: number,
  amount: number,
): { direction: 'up' | 'down' | 'left' | 'right'; amount: number } | null {
  let scrollDirection: 'up' | 'down' | 'left' | 'right'
  if (direction === 3) {
    scrollDirection = rotation < 0 ? 'up' : 'down'
  } else if (direction === 4) {
    scrollDirection = rotation < 0 ? 'left' : 'right'
  } else {
    return null
  }

  const hasClicks = Number.isFinite(amount) && amount > 0
  const raw = hasClicks ? amount : Math.abs(rotation) >= 120 ? Math.abs(rotation) / 120 : Math.abs(rotation)
  return {
    direction: scrollDirection,
    amount: Math.max(1, Math.min(100, Math.round(raw) || 1)),
  }
}

function supportError(platform: NodeJS.Platform, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  if (platform === 'darwin') {
    return `Global capture could not start: ${detail}. Grant PhoneDeck Accessibility and Input Monitoring permission, then try again.`
  }
  if (platform === 'linux') {
    return `Global capture could not start: ${detail}. uiohook requires an X11 session with the X11 libraries installed.`
  }
  return `Global capture could not start: ${detail}.`
}

/** Lazily load the pinned native module; never called by unit tests. */
export function loadUiohook(): HookBundle {
  const nodeRequire = createRequire(__filename)
  const loaded = nodeRequire('uiohook-napi') as {
    uIOhook: HookLike
    UiohookKey: Record<string, number>
  }
  return { hook: loaded.uIOhook, keys: loaded.UiohookKey }
}

export class InputCapture {
  private readonly deps: InputCaptureDeps
  private hook: HookLike | null = null
  private bundle: HookBundle | null = null
  private keyMap = new Map<number, string>()
  private listeners: Array<{ event: HookEventName; listener: (event: HookEvent) => void }> = []
  private active = false
  private disposed = false
  private options: ActiveOptions = {
    captureMouse: true,
    captureMouseMove: false,
    ignoreSelf: true,
  }
  private buttonsDown = new Set<MouseButton>()
  private stopChordActive = false
  private readonly platform: NodeJS.Platform
  private readonly env: NodeJS.ProcessEnv
  private readonly shortcut: ShortcutLike
  private readonly now: () => number

  constructor(deps: InputCaptureDeps = {}) {
    this.deps = deps
    this.platform = deps.platform ?? process.platform
    this.env = deps.env ?? process.env
    this.shortcut = deps.shortcut ?? NOOP_SHORTCUT
    this.now = deps.now ?? Date.now
  }

  get isActive(): boolean {
    return this.active
  }

  /** Report support without starting the hook. Safe to call from the renderer. */
  support(): MacroCaptureSupportView {
    if (this.platform === 'linux' && this.isWayland()) {
      return {
        supported: false,
        platform: this.platform,
        stopHotkey: MACRO_CAPTURE_STOP_HOTKEY,
        reason:
          'Global capture is unavailable on Wayland. Log in with an X11 session or use focused recording.',
      }
    }
    if (this.platform === 'darwin' && this.deps.accessibilityGranted?.() === false) {
      return {
        supported: false,
        platform: this.platform,
        stopHotkey: MACRO_CAPTURE_STOP_HOTKEY,
        reason:
          'Global capture needs macOS Accessibility and Input Monitoring permission for PhoneDeck. Grant it in System Settings, then reopen this dialog or use focused recording.',
      }
    }
    try {
      this.bundle ??= this.factory()()
      return { supported: true, platform: this.platform, stopHotkey: MACRO_CAPTURE_STOP_HOTKEY }
    } catch (error) {
      this.deps.logger?.warn(
        `Global macro capture unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
      return {
        supported: false,
        platform: this.platform,
        stopHotkey: MACRO_CAPTURE_STOP_HOTKEY,
        reason: supportError(this.platform, error),
      }
    }
  }

  start(input: MacroCaptureStartInput = {}): MacroCaptureStartResult {
    const stopHotkey = MACRO_CAPTURE_STOP_HOTKEY
    if (this.disposed) {
      return { ok: false, active: false, error: 'The capture service is shutting down.', stopHotkey, ...this.options }
    }
    if (this.active) {
      return { ok: true, active: true, stopHotkey, ...this.options }
    }

    const support = this.support()
    if (!support.supported) {
      return {
        ok: false,
        active: false,
        error: support.reason ?? 'Global capture is unavailable on this system.',
        stopHotkey,
        ...this.options,
      }
    }

    let registered = false
    try {
      registered = this.shortcut.register(stopHotkey, () => {
        this.stop('hotkey')
      })
    } catch (error) {
      this.deps.logger?.warn(
        `Could not register the macro stop shortcut: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!registered) {
      return {
        ok: false,
        active: false,
        error: `Could not register ${stopHotkey}. Another application may already use it; close it and try again, or use focused recording.`,
        stopHotkey,
        ...this.options,
      }
    }

    let bundle: HookBundle
    try {
      bundle = this.bundle ?? this.factory()()
      this.bundle = bundle
    } catch (error) {
      this.shortcut.unregister(stopHotkey)
      return {
        ok: false,
        active: false,
        error: supportError(this.platform, error),
        stopHotkey,
        ...this.options,
      }
    }

    this.hook = bundle.hook
    this.keyMap = buildKeycodeMap(bundle.keys)
    this.options = {
      captureMouse: input.captureMouse ?? true,
      captureMouseMove: input.captureMouseMove ?? false,
      ignoreSelf: input.ignoreSelf ?? true,
    }
    this.buttonsDown.clear()
    this.stopChordActive = false

    try {
      this.attach(bundle.hook)
      bundle.hook.start()
    } catch (error) {
      this.detach()
      try {
        bundle.hook.stop()
      } catch {
        // best effort
      }
      this.hook = null
      this.shortcut.unregister(stopHotkey)
      return {
        ok: false,
        active: false,
        error: supportError(this.platform, error),
        stopHotkey,
        ...this.options,
      }
    }

    this.active = true
    this.notify('PhoneDeck is recording a macro', `Press ${hotkeyLabel(stopHotkey)} to stop.`)
    return { ok: true, active: true, stopHotkey, ...this.options }
  }

  stop(reason: 'user' | 'hotkey' | 'disposed' | 'error' = 'user'): MacroCaptureStopResult {
    if (!this.active) return { ok: true, reason }
    this.active = false
    this.detach()

    const hook = this.hook
    this.hook = null
    if (hook) {
      try {
        hook.stop()
      } catch (error) {
        this.deps.logger?.warn(
          `Could not stop the global hook: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    try {
      this.shortcut.unregister(MACRO_CAPTURE_STOP_HOTKEY)
    } catch (error) {
      this.deps.logger?.warn(
        `Could not unregister the macro stop shortcut: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    this.buttonsDown.clear()
    this.stopChordActive = false

    if (reason !== 'disposed') {
      this.notify('PhoneDeck stopped recording', 'The captured steps are ready to review.')
    }
    this.emit(IPC.macroCaptureStoppedEvent, {
      reason,
      stopHotkey: MACRO_CAPTURE_STOP_HOTKEY,
      at: this.now(),
    })
    return { ok: true, reason }
  }

  dispose(): void {
    if (this.disposed) return
    this.stop('disposed')
    this.disposed = true
  }

  private factory(): () => HookBundle {
    return this.deps.hookFactory ?? loadUiohook
  }

  private isWayland(): boolean {
    if (this.env['WAYLAND_DISPLAY']) return true
    return (this.env['XDG_SESSION_TYPE'] ?? '').toLowerCase() === 'wayland'
  }

  private attach(hook: HookLike): void {
    const bind = (event: HookEventName, listener: (event: HookEvent) => void): void => {
      hook.on(event, listener)
      this.listeners.push({ event, listener })
    }
    bind('keydown', (event) => this.handleKeyboard(event as HookKeyboardEvent))
    bind('keyup', (event) => this.handleKeyboard(event as HookKeyboardEvent))
    bind('mousedown', (event) => this.handleMouseButton(event as HookMouseButtonEvent))
    bind('mouseup', (event) => this.handleMouseButton(event as HookMouseButtonEvent))
    bind('mousemove', (event) => this.handleMouseMove(event as HookMouseMoveEvent))
    bind('wheel', (event) => this.handleWheel(event as HookWheelEvent))
  }

  private detach(): void {
    const hook = this.hook
    if (!hook) {
      this.listeners = []
      return
    }
    for (const { event, listener } of this.listeners) {
      if (hook.off) hook.off(event, listener)
      else hook.removeListener?.(event, listener)
    }
    this.listeners = []
  }

  private allowed(event: { synthetic?: boolean }): boolean {
    if (!this.active) return false
    if (event.synthetic) return false
    if (this.options.ignoreSelf && this.deps.isSelfFocused?.()) return false
    return true
  }

  private handleKeyboard(event: HookKeyboardEvent): void {
    if (!this.allowed(event)) return
    const key = this.keyMap.get(event.keycode)
    if (!key) return

    if (this.stopChordActive) {
      if (event.type === 'keyup' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        this.stopChordActive = false
      }
      return
    }

    const command = this.platform === 'darwin' ? event.metaKey === true : event.ctrlKey === true
    if (key === 'F10' && command && event.altKey) {
      // The Electron global shortcut owns this chord; never record its keys.
      this.stopChordActive = true
      return
    }

    this.emitKey({ kind: event.type === 'keydown' ? 'down' : 'up', key, time: event.time })
  }

  private handleMouseButton(event: HookMouseButtonEvent): void {
    if (!this.allowed(event) || !this.options.captureMouse) return
    const button = mapMouseButton(event.button)
    if (!button) return
    if (event.type === 'mousedown') this.buttonsDown.add(button)
    else this.buttonsDown.delete(button)
    this.emitMouse({
      kind: event.type === 'mousedown' ? 'down' : 'up',
      button,
      x: event.x,
      y: event.y,
      time: event.time,
    })
  }

  private handleMouseMove(event: HookMouseMoveEvent): void {
    if (!this.allowed(event) || !this.options.captureMouse) return
    // Drag paths are always forwarded, even when free movement capture is off.
    if (!this.options.captureMouseMove && this.buttonsDown.size === 0) return
    this.emitMouse({ kind: 'move', x: event.x, y: event.y, time: event.time })
  }

  private handleWheel(event: HookWheelEvent): void {
    if (!this.allowed(event) || !this.options.captureMouse) return
    const scroll = mapWheel(event.direction, event.rotation, event.amount)
    if (!scroll) return
    this.emitMouse({
      kind: 'wheel',
      direction: scroll.direction,
      amount: scroll.amount,
      rotation: event.rotation,
      time: event.time,
    })
  }

  private emitKey(event: RawKeyEvent): void {
    this.emit(IPC.macroCaptureEvent, event)
  }

  private emitMouse(event: RawMouseEvent): void {
    this.emit(IPC.macroCaptureEvent, event)
  }

  private emit(channel: string, payload: unknown): void {
    try {
      this.deps.send?.(channel, payload)
    } catch (error) {
      this.deps.logger?.warn(
        `Could not send ${channel}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private notify(title: string, body: string): void {
    try {
      this.deps.notify?.(title, body)
    } catch (error) {
      this.deps.logger?.warn(
        `Could not show a capture notification: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

/** Human label for the cross-platform stop chord (docs/tests only). */
export function hotkeyLabel(accelerator: string): string {
  return accelerator
    .replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl')
    .replace(/\+/g, ' + ')
}
