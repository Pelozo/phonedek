import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/defaults'
import { parseConfig, validateConfig } from '../src/schema'

describe('config schema', () => {
  it('accepts the default config', () => {
    const result = validateConfig(createDefaultConfig())
    expect(result.ok).toBe(true)
  })

  it('rejects a button outside the grid', () => {
    const config = createDefaultConfig()
    config.profiles[0]!.pages[0]!.buttons[0]!.slot = 99
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/outside the/)
  })

  it('rejects duplicate slots on one page', () => {
    const config = createDefaultConfig()
    const buttons = config.profiles[0]!.pages[0]!.buttons
    buttons[1]!.slot = buttons[0]!.slot
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/share slot/)
  })

  it('rejects duplicate button ids', () => {
    const config = createDefaultConfig()
    const page = config.profiles[0]!.pages[0]!
    page.buttons[1]!.id = page.buttons[0]!.id
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/Duplicate button id/)
  })

  it('rejects unknown key names', () => {
    const config = createDefaultConfig()
    config.profiles[0]!.pages[0]!.buttons[0]!.actions = [{ type: 'hotkey', keys: ['HYPERDRIVE'] }]
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/Unknown key/)
  })

  it('rejects a goto page action without a page', () => {
    const config = createDefaultConfig()
    config.profiles[0]!.pages[0]!.buttons[0]!.actions = [{ type: 'page', direction: 'goto' }]
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/without a page/)
  })

  it('accepts advanced macro steps and repeat settings', () => {
    const config = createDefaultConfig()
    config.profiles[0]!.pages[0]!.buttons[0]!.actions = [
      {
        type: 'macro',
        repeat: 3,
        repeatDelayMs: 250,
        steps: [
          { type: 'hotkey', keys: ['SHIFT'], action: 'down' },
          { type: 'mouse', button: 'left', action: 'move', x: 50, y: 60 },
          { type: 'mouse', button: 'left', action: 'click' },
          { type: 'mouse', button: 'left', action: 'scroll', direction: 'down', amount: 2 },
          { type: 'hotkey', keys: ['SHIFT'], action: 'up' },
          { type: 'launch', path: 'notepad.exe', args: [] },
          { type: 'url', url: 'https://example.com' },
          { type: 'command', command: 'echo hi', hidden: true },
        ],
      },
    ]
    expect(validateConfig(config).ok).toBe(true)

    config.profiles[0]!.pages[0]!.buttons[0]!.actions = [
      { type: 'macro', repeat: 0, steps: [{ type: 'delay', ms: 1 }] },
    ]
    expect(validateConfig(config).ok).toBe(false)
  })

  it('parses and returns a deep object', () => {
    const config = parseConfig(createDefaultConfig())
    expect(config.profiles[0]!.pages.length).toBe(2)
    expect(config.serverName).toBe('PhoneDeck')
  })

  it('rejects path traversal in asset names', () => {
    const config = createDefaultConfig()
    config.profiles[0]!.theme.background = { type: 'image', asset: '../secret.png', fit: 'cover' }
    expect(validateConfig(config).ok).toBe(false)
  })

  it('accepts video backgrounds and media icons', () => {
    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!
    button.background = {
      type: 'video',
      asset: 'intro.MP4',
      fit: 'cover',
      loop: false,
      muted: false,
      autoplay: false,
      overlay: 0.25,
    }
    button.iconMedia = { type: 'video', asset: 'spinner.webm', fit: 'contain' }
    expect(validateConfig(config).ok).toBe(true)

    button.iconMedia = { type: 'image', asset: 'animated.GIF', fit: 'cover' }
    button.background = { type: 'image', asset: 'still.webp', fit: 'contain' }
    expect(validateConfig(config).ok).toBe(true)
  })

  it('keeps video/icon defaults optional (renderers default them to true)', () => {
    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!
    button.background = { type: 'video', asset: 'loop.m4v', fit: 'cover' }
    button.iconMedia = { type: 'image', asset: 'icon.png', fit: 'contain', loop: true, muted: false }
    const result = validateConfig(config)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const parsed = result.config.profiles[0]!.pages[0]!.buttons[0]!
    const background = parsed.background as { loop?: boolean; muted?: boolean; autoplay?: boolean }
    expect(background.loop).toBeUndefined()
    expect(background.muted).toBeUndefined()
    expect(background.autoplay).toBeUndefined()
    expect(parsed.iconMedia).toEqual({ type: 'image', asset: 'icon.png', fit: 'contain', loop: true, muted: false })
  })

  it('rejects mismatched or unsupported media extensions', () => {
    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!

    button.background = { type: 'video', asset: 'still.png', fit: 'cover' }
    let result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/video asset/)

    button.background = { type: 'image', asset: 'clip.mp4', fit: 'cover' }
    result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/image asset/)

    button.background = undefined
    button.iconMedia = { type: 'video', asset: 'icon.gif', fit: 'cover' }
    result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/video asset/)

    button.iconMedia = { type: 'image', asset: 'icon.mp4', fit: 'cover' }
    result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/image asset/)

    button.iconMedia = { type: 'video', asset: 'clip.avi', fit: 'cover' }
    expect(validateConfig(config).ok).toBe(false)

    button.iconMedia = undefined
    button.background = { type: 'image', asset: 'vector.svg', fit: 'cover' }
    expect(validateConfig(config).ok).toBe(false)
  })

  it('rejects traversal in video and icon asset names', () => {
    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!
    button.background = { type: 'video', asset: '../secret.mp4', fit: 'cover' }
    expect(validateConfig(config).ok).toBe(false)

    button.background = undefined
    button.iconMedia = { type: 'video', asset: '..%2Fsecret.mp4', fit: 'cover' }
    expect(validateConfig(config).ok).toBe(false)
  })
})
