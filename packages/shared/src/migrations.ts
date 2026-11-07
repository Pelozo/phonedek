import type { Action, DeckButton, DeckConfig } from './types'
import { normalizeHostPlatform } from './platform'

function hasHotkey(button: DeckButton, keys: string[]): boolean {
  return button.actions.length === 1 && isHotkey(button.actions[0], keys)
}

function isHotkey(action: Action | undefined, keys: string[]): boolean {
  return (
    action?.type === 'hotkey' &&
    action.keys.length === keys.length &&
    action.keys.every((key, index) => key === keys[index])
  )
}

function hasCommand(button: DeckButton, command: string): boolean {
  return (
    button.actions.length === 1 &&
    button.actions[0]?.type === 'command' &&
    button.actions[0].command === command
  )
}

function replaceButton(button: DeckButton, patch: Partial<DeckButton>): DeckButton {
  return { ...button, ...patch }
}

/**
 * One-time, non-destructive update of the untouched Windows starter keys when
 * the desktop is running on macOS. Only exact stock actions are changed; any
 * user-edited button is left alone. Returns the same object when nothing moved.
 */
export function migrateStarterDeck(config: DeckConfig, platform?: string): DeckConfig {
  if (normalizeHostPlatform(platform) !== 'darwin') return config

  let changed = false
  const profiles = config.profiles.map((profile) => {
    const pages = profile.pages.map((page) => {
      let pageChanged = false
      const buttons = page.buttons.map((button) => {
        switch (button.id) {
          case 'btn-copy':
            if (!hasHotkey(button, ['CTRL', 'C'])) return button
            pageChanged = true
            changed = true
            return replaceButton(button, {
              sublabel: 'Cmd + C',
              actions: [{ type: 'hotkey', keys: ['WIN', 'C'] }],
            })
          case 'btn-paste':
            if (!hasHotkey(button, ['CTRL', 'V'])) return button
            pageChanged = true
            changed = true
            return replaceButton(button, {
              sublabel: 'Cmd + V',
              actions: [{ type: 'hotkey', keys: ['WIN', 'V'] }],
            })
          case 'btn-undo':
            if (!hasHotkey(button, ['CTRL', 'Z'])) return button
            pageChanged = true
            changed = true
            return replaceButton(button, {
              sublabel: 'Cmd + Z',
              actions: [{ type: 'hotkey', keys: ['WIN', 'Z'] }],
            })
          case 'btn-taskview':
            if (!hasHotkey(button, ['WIN', 'TAB'])) return button
            pageChanged = true
            changed = true
            return replaceButton(button, {
              label: 'Mission Control',
              sublabel: 'Ctrl + Up',
              icon: '🧭',
              actions: [{ type: 'hotkey', keys: ['CTRL', 'UP'] }],
            })
          case 'btn-desktop':
            if (!hasHotkey(button, ['WIN', 'D'])) return button
            pageChanged = true
            changed = true
            return replaceButton(button, {
              sublabel: 'F11',
              actions: [{ type: 'hotkey', keys: ['F11'] }],
            })
          case 'btn-lock':
            if (!hasCommand(button, 'rundll32.exe user32.dll,LockWorkStation')) return button
            pageChanged = true
            changed = true
            return replaceButton(button, {
              sublabel: 'Ctrl + Cmd + Q',
              actions: [{ type: 'hotkey', keys: ['CTRL', 'WIN', 'Q'] }],
            })
          case 'btn-screenshot':
            if (button.sublabel !== 'Win + Shift + S') return button
            pageChanged = true
            changed = true
            return replaceButton(button, { sublabel: 'Full screen' })
          default:
            return button
        }
      })
      return pageChanged ? { ...page, buttons } : page
    })
    return pages.some((page, index) => page !== profile.pages[index]) ? { ...profile, pages } : profile
  })

  return changed ? { ...config, profiles } : config
}
