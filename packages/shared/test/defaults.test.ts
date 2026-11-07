import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/defaults'
import { validateConfig } from '../src/schema'
import type { DeckButton, DeckConfig } from '../src/types'

function button(config: DeckConfig, id: string): DeckButton {
  const found = config.profiles[0]!.pages[0]!.buttons.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`Missing starter button: ${id}`)
  return found
}

describe('starter deck platform defaults', () => {
  it('keeps Windows/Linux starters on win32, linux and the default', () => {
    for (const platform of ['win32', 'linux', undefined]) {
      const config = createDefaultConfig(platform)
      expect(validateConfig(config).ok).toBe(true)

      expect(button(config, 'btn-taskview').label).toBe('Task view')
      expect(button(config, 'btn-taskview').actions).toEqual([{ type: 'hotkey', keys: ['WIN', 'TAB'] }])
      expect(button(config, 'btn-desktop').actions).toEqual([{ type: 'hotkey', keys: ['WIN', 'D'] }])
      expect(button(config, 'btn-lock').actions[0]).toMatchObject({ type: 'command' })
      expect(button(config, 'btn-copy').actions).toEqual([{ type: 'hotkey', keys: ['CTRL', 'C'] }])
      expect(button(config, 'btn-paste').actions).toEqual([{ type: 'hotkey', keys: ['CTRL', 'V'] }])
      expect(button(config, 'btn-undo').actions).toEqual([{ type: 'hotkey', keys: ['CTRL', 'Z'] }])
    }
  })

  it('uses macOS shortcuts on darwin', () => {
    const config = createDefaultConfig('darwin')
    expect(validateConfig(config).ok).toBe(true)

    expect(button(config, 'btn-copy').actions).toEqual([{ type: 'hotkey', keys: ['WIN', 'C'] }])
    expect(button(config, 'btn-paste').actions).toEqual([{ type: 'hotkey', keys: ['WIN', 'V'] }])
    expect(button(config, 'btn-undo').actions).toEqual([{ type: 'hotkey', keys: ['WIN', 'Z'] }])

    expect(button(config, 'btn-taskview').label).toBe('Mission Control')
    expect(button(config, 'btn-taskview').actions).toEqual([{ type: 'hotkey', keys: ['CTRL', 'UP'] }])
    expect(button(config, 'btn-desktop').actions).toEqual([{ type: 'hotkey', keys: ['F11'] }])
    expect(button(config, 'btn-lock').actions).toEqual([{ type: 'hotkey', keys: ['CTRL', 'WIN', 'Q'] }])

    expect(button(config, 'btn-screenshot').actions).toEqual([
      { type: 'hotkey', keys: ['WIN', 'SHIFT', 'S'] },
    ])
    expect(button(config, 'btn-screenshot').sublabel).toBe('Full screen')

    // Media starters are platform-neutral.
    expect(button(config, 'btn-vol-down').actions).toEqual([{ type: 'media', key: 'volumedown' }])
    expect(button(config, 'btn-play').actions).toEqual([{ type: 'media', key: 'playpause' }])
  })

  it('normalizes unknown platforms to the Windows/Linux starter deck', () => {
    const config = createDefaultConfig('plan9')
    expect(button(config, 'btn-copy').actions).toEqual([{ type: 'hotkey', keys: ['CTRL', 'C'] }])
    expect(button(config, 'btn-desktop').actions).toEqual([{ type: 'hotkey', keys: ['WIN', 'D'] }])
  })
})
