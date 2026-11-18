import { describe, expect, it } from 'vitest'
import {
  buildKeycodeMap,
  canonicalKeyName,
  InputCapture,
  mapMouseButton,
  mapWheel,
  MACRO_CAPTURE_STOP_HOTKEY,
  type HookBundle,
  type HookEvent,
  type HookEventName,
  type HookLike,
  type ShortcutLike,
} from '../src/main/input-capture'
import { IPC } from '../src/shared/api'
import type { MacroCaptureInputEvent, MacroCaptureStoppedView } from '../src/shared/api'

const KEYS = {
  Ctrl: 29,
  CtrlRight: 3613,
  Alt: 56,
  Shift: 42,
  F10: 68,
  A: 30,
  ArrowUp: 57416,
  Numpad5: 76,
  Semicolon: 39,
  Backslash: 43,
  PrintScreen: 3639,
  UnknownName: 200,
}

class FakeHook implements HookLike {
  readonly listeners = new Map<HookEventName, Set<(event: HookEvent) => void>>()
  starts = 0
  stops = 0
  startError: Error | null = null

  on(event: HookEventName, listener: (event: HookEvent) => void): this {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
    return this
  }

  off(event: HookEventName, listener: (event: HookEvent) => void): this {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  start(): void {
    this.starts += 1
    if (this.startError) throw this.startError
  }

  stop(): void {
    this.stops += 1
  }

  emit(event: HookEventName, payload: HookEvent): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload)
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, set) => total + set.size, 0)
  }
}

class FakeShortcut implements ShortcutLike {
  readonly callbacks = new Map<string, () => void>()
  readonly unregistered: string[] = []
  fail = false
  throwOnRegister = false

  register(accelerator: string, callback: () => void): boolean {
    if (this.throwOnRegister) throw new Error('shortcut backend failed')
    if (this.fail) return false
    this.callbacks.set(accelerator, callback)
    return true
  }

  unregister(accelerator: string): void {
    this.unregistered.push(accelerator)
    this.callbacks.delete(accelerator)
  }

  pressStop(): void {
    for (const callback of [...this.callbacks.values()]) callback()
  }
}

function makeCapture(options: {
  hook?: FakeHook
  shortcut?: FakeShortcut
  focused?: () => boolean
  hookFactory?: () => HookBundle
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  accessibilityGranted?: () => boolean
} = {}) {
  const hook = options.hook ?? new FakeHook()
  const shortcut = options.shortcut ?? new FakeShortcut()
  const sent: Array<{ channel: string; payload: unknown }> = []
  const notifications: Array<{ title: string; body: string }> = []
  const capture = new InputCapture({
    hookFactory: options.hookFactory ?? (() => ({ hook, keys: KEYS })),
    shortcut,
    platform: options.platform ?? 'win32',
    env: options.env ?? {},
    isSelfFocused: options.focused ?? (() => false),
    accessibilityGranted: options.accessibilityGranted,
    send: (channel, payload) => sent.push({ channel, payload }),
    notify: (title, body) => notifications.push({ title, body }),
    now: () => 1234,
  })
  return { capture, hook, shortcut, sent, notifications }
}

function events(sent: Array<{ channel: string; payload: unknown }>): MacroCaptureInputEvent[] {
  return sent
    .filter((entry) => entry.channel === IPC.macroCaptureEvent)
    .map((entry) => entry.payload as MacroCaptureInputEvent)
}

describe('input capture mapping', () => {
  it('maps libuiohook keycodes to canonical key names', () => {
    const map = buildKeycodeMap(KEYS)
    expect(map.get(29)).toBe('CTRL')
    expect(map.get(3613)).toBe('CTRL')
    expect(map.get(30)).toBe('A')
    expect(map.get(57416)).toBe('UP')
    expect(map.get(76)).toBe('NUMPAD5')
    expect(map.get(39)).toBe(';')
    expect(map.get(43)).toBe('\\')
    expect(map.get(3639)).toBe('PRINTSCREEN')
    expect(map.has(200)).toBe(false)

    expect(canonicalKeyName('F12')).toBe('F12')
    expect(canonicalKeyName('Numpad9')).toBe('NUMPAD9')
    expect(canonicalKeyName('Nope')).toBeNull()
    expect(buildKeycodeMap({ NumpadEnter: 0 }).size).toBe(0)
  })

  it('maps mouse buttons and wheel axes', () => {
    expect(mapMouseButton(1)).toBe('left')
    expect(mapMouseButton(2)).toBe('right')
    expect(mapMouseButton(3)).toBe('middle')
    expect(mapMouseButton(4)).toBeNull()
    expect(mapMouseButton('1')).toBeNull()

    expect(mapWheel(3, -120, 1)).toEqual({ direction: 'up', amount: 1 })
    expect(mapWheel(3, 120, 2)).toEqual({ direction: 'down', amount: 2 })
    expect(mapWheel(4, -1, 1)).toEqual({ direction: 'left', amount: 1 })
    expect(mapWheel(4, 1, 1)).toEqual({ direction: 'right', amount: 1 })
    expect(mapWheel(9, 1, 1)).toBeNull()
    expect(mapWheel(3, 120, 500)).toEqual({ direction: 'down', amount: 100 })
    expect(mapWheel(3, 0, 0)).toEqual({ direction: 'down', amount: 1 })
  })
})

describe('InputCapture lifecycle and filtering', () => {
  it('forwards mapped keyboard and mouse events', () => {
    const { capture, hook, sent } = makeCapture()
    expect(capture.start({ captureMouse: true, captureMouseMove: false })).toMatchObject({
      ok: true,
      active: true,
      captureMouse: true,
      captureMouseMove: false,
      ignoreSelf: true,
      stopHotkey: MACRO_CAPTURE_STOP_HOTKEY,
    })

    hook.emit('keydown', { type: 'keydown', keycode: 30, time: 10 })
    hook.emit('keyup', { type: 'keyup', keycode: 30, time: 20 })
    hook.emit('mousedown', { type: 'mousedown', button: 1, x: 10, y: 20, time: 30 })
    hook.emit('mouseup', { type: 'mouseup', button: 1, x: 10, y: 20, time: 40 })
    hook.emit('wheel', { type: 'wheel', direction: 3, rotation: -120, amount: 1, x: 10, y: 20, time: 50 })

    expect(events(sent)).toEqual([
      { kind: 'down', key: 'A', time: 10 },
      { kind: 'up', key: 'A', time: 20 },
      { kind: 'down', button: 'left', x: 10, y: 20, time: 30 },
      { kind: 'up', button: 'left', x: 10, y: 20, time: 40 },
      { kind: 'wheel', direction: 'up', amount: 1, rotation: -120, time: 50 },
    ])
  })

  it('drops self-focused, synthetic, unknown and unsupported events', () => {
    let focused = true
    const { capture, hook, sent } = makeCapture({ focused: () => focused })

    capture.start({ captureMouse: true })
    hook.emit('keydown', { type: 'keydown', keycode: 30, time: 1 })
    hook.emit('mousedown', { type: 'mousedown', button: 1, x: 1, y: 1, time: 2 })
    expect(events(sent)).toEqual([])

    focused = false
    hook.emit('keydown', { type: 'keydown', keycode: 30, time: 3, synthetic: true })
    hook.emit('keydown', { type: 'keydown', keycode: 999, time: 4 })
    hook.emit('mousedown', { type: 'mousedown', button: 4, x: 1, y: 1, time: 5 })
    hook.emit('wheel', { type: 'wheel', direction: 9, rotation: 1, amount: 1, x: 1, y: 1, time: 6 })
    expect(events(sent)).toEqual([])

    hook.emit('keydown', { type: 'keydown', keycode: 30, time: 7 })
    expect(events(sent)).toEqual([{ kind: 'down', key: 'A', time: 7 }])
  })

  it('forwards drag moves but drops free movement when movement capture is off', () => {
    const { capture, hook, sent } = makeCapture()
    capture.start({ captureMouse: true, captureMouseMove: false })

    hook.emit('mousemove', { type: 'mousemove', x: 100, y: 100, time: 1 })
    hook.emit('mousedown', { type: 'mousedown', button: 1, x: 100, y: 100, time: 2 })
    hook.emit('mousemove', { type: 'mousemove', x: 120, y: 140, time: 3 })
    hook.emit('mouseup', { type: 'mouseup', button: 1, x: 120, y: 140, time: 4 })
    hook.emit('mousemove', { type: 'mousemove', x: 150, y: 160, time: 5 })

    expect(events(sent).map((event) => event.kind)).toEqual(['down', 'move', 'up'])
  })

  it('captures free movement when enabled and respects captureMouse off', () => {
    const { capture, hook, sent } = makeCapture()
    capture.start({ captureMouse: true, captureMouseMove: true })
    hook.emit('mousemove', { type: 'mousemove', x: 5, y: 6, time: 1 })
    expect(events(sent)).toEqual([{ kind: 'move', x: 5, y: 6, time: 1 }])

    capture.stop('user')
    const second = makeCapture()
    second.capture.start({ captureMouse: false, captureMouseMove: true })
    second.hook.emit('mousedown', { type: 'mousedown', button: 1, x: 1, y: 2, time: 1 })
    second.hook.emit('mousemove', { type: 'mousemove', x: 3, y: 4, time: 2 })
    second.hook.emit('wheel', { type: 'wheel', direction: 3, rotation: 1, amount: 1, x: 1, y: 1, time: 3 })
    expect(events(second.sent)).toEqual([])
  })

  it('starts/stops idempotently and cleans up the hook and shortcut', () => {
    const { capture, hook, shortcut, sent, notifications } = makeCapture()
    expect(hook.listenerCount()).toBe(0)

    const first = capture.start({ captureMouse: true })
    expect(first.ok).toBe(true)
    expect(hook.starts).toBe(1)
    expect(hook.listenerCount()).toBe(6)
    expect(shortcut.callbacks.has(MACRO_CAPTURE_STOP_HOTKEY)).toBe(true)
    expect(notifications).toHaveLength(1)

    const again = capture.start({ captureMouse: false })
    expect(again.ok).toBe(true)
    expect(again.captureMouse).toBe(true) // active session options win
    expect(hook.starts).toBe(1)

    const stopped = capture.stop('user')
    expect(stopped).toEqual({ ok: true, reason: 'user' })
    expect(hook.stops).toBe(1)
    expect(hook.listenerCount()).toBe(0)
    expect(shortcut.unregistered).toContain(MACRO_CAPTURE_STOP_HOTKEY)
    expect(notifications).toHaveLength(2)
    expect(sent.at(-1)).toEqual({
      channel: IPC.macroCaptureStoppedEvent,
      payload: { reason: 'user', stopHotkey: MACRO_CAPTURE_STOP_HOTKEY, at: 1234 },
    })

    // Idempotent stop emits nothing more.
    expect(capture.stop('user')).toEqual({ ok: true, reason: 'user' })
    expect(sent).toHaveLength(1)
  })

  it('stops from the global shortcut and ignores the stop chord keys', () => {
    const { capture, hook, shortcut, sent } = makeCapture({ platform: 'win32' })
    capture.start({ captureMouse: true })

    hook.emit('keydown', { type: 'keydown', keycode: 29, time: 1, ctrlKey: true })
    hook.emit('keydown', { type: 'keydown', keycode: 56, time: 2, ctrlKey: true, altKey: true })
    hook.emit('keydown', { type: 'keydown', keycode: 68, time: 3, ctrlKey: true, altKey: true })
    shortcut.pressStop()

    expect(events(sent).some((event) => 'key' in event && event.key === 'F10')).toBe(false)
    const stopped = sent.find((entry) => entry.channel === IPC.macroCaptureStoppedEvent)
    expect((stopped?.payload as MacroCaptureStoppedView).reason).toBe('hotkey')
    expect(hook.stops).toBe(1)
    expect(shortcut.unregistered).toContain(MACRO_CAPTURE_STOP_HOTKEY)
  })

  it('returns a clear error when the stop shortcut cannot be registered', () => {
    const shortcut = new FakeShortcut()
    shortcut.fail = true
    const { capture, hook, sent } = makeCapture({ shortcut })

    const result = capture.start()
    expect(result.ok).toBe(false)
    expect(result.active).toBe(false)
    expect(result.error).toContain(MACRO_CAPTURE_STOP_HOTKEY)
    expect(hook.starts).toBe(0)
    expect(sent).toEqual([])
  })

  it('reports unsupported hosts and factory failures without starting', () => {
    const wayland = makeCapture({ platform: 'linux', env: { WAYLAND_DISPLAY: ':0' } })
    const waylandSupport = wayland.capture.support()
    expect(waylandSupport.supported).toBe(false)
    expect(waylandSupport.reason).toContain('Wayland')
    expect(wayland.capture.start().ok).toBe(false)
    expect(wayland.hook.starts).toBe(0)
    expect(wayland.shortcut.callbacks.size).toBe(0)

    const broken = makeCapture({
      hookFactory: () => {
        throw new Error('cannot load .node')
      },
    })
    const support = broken.capture.support()
    expect(support.supported).toBe(false)
    expect(support.reason).toContain('cannot load .node')
    const result = broken.capture.start()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('cannot load .node')
    expect(broken.shortcut.callbacks.size).toBe(0)

    const mac = makeCapture({ platform: 'darwin', accessibilityGranted: () => false })
    const macSupport = mac.capture.support()
    expect(macSupport.supported).toBe(false)
    expect(macSupport.reason).toContain('Accessibility')
  })

  it('unregisters the shortcut and removes listeners when the hook start throws', () => {
    const hook = new FakeHook()
    hook.startError = new Error('hook start failed')
    const { capture, shortcut, sent } = makeCapture({ hook })

    const result = capture.start()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('hook start failed')
    expect(hook.stops).toBe(1)
    expect(hook.listenerCount()).toBe(0)
    expect(shortcut.unregistered).toContain(MACRO_CAPTURE_STOP_HOTKEY)
    expect(sent).toEqual([])
  })

  it('dispose stops an active session without a stopped notification', () => {
    const { capture, hook, shortcut, sent, notifications } = makeCapture()
    capture.start()
    capture.dispose()
    expect(hook.stops).toBe(1)
    expect(shortcut.unregistered).toContain(MACRO_CAPTURE_STOP_HOTKEY)
    expect(notifications).toHaveLength(1) // start only
    const stopped = sent.find((entry) => entry.channel === IPC.macroCaptureStoppedEvent)
    expect((stopped?.payload as MacroCaptureStoppedView).reason).toBe('disposed')

    const after = capture.start()
    expect(after.ok).toBe(false)
  })
})
