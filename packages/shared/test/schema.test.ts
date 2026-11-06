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
})
