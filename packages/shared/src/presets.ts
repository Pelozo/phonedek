/**
 * Predefined action packs for the desktop editor.
 *
 * These are plain JSON data: every item validates against `ActionSchema` and
 * can be copied into a button without transformation. Presets may carry
 * platform-specific actions/descriptions so the editor never shows a
 * Windows-only chord on macOS (or a macOS-only chord on Windows).
 */

import type { Action, DeckButton, MediaKey } from './types'
import type { HostPlatform } from './platform'
import { normalizeHostPlatform } from './platform'
import { formatCombo } from './keys'
import { newId } from './ids'

export interface ActionPreset {
  /** Globally unique, stable id (letters, digits, "-" and "_"). */
  id: string
  name: string
  description: string
  /** Short emoji shown on the deck key. */
  icon?: string
  actions: Action[]
  /** If omitted, available on every platform. */
  platforms?: HostPlatform[]
  /** Action override for a specific platform; falls back to `actions`. */
  platformActions?: Partial<Record<HostPlatform, Action[]>>
  /** Optional summary override, e.g. mac screenshot wording. */
  platformDescriptions?: Partial<Record<HostPlatform, string>>
}

export interface ActionPack {
  id: string
  name: string
  description: string
  presets: ActionPreset[]
}

function hotkey(keys: string[]): Action {
  return { type: 'hotkey', keys }
}

function media(key: MediaKey): Action {
  return { type: 'media', key }
}

function hotkeyPreset(
  id: string,
  name: string,
  description: string,
  icon: string,
  keys: string[],
): ActionPreset {
  return { id, name, description, icon, actions: [hotkey(keys)] }
}

/** Replace Ctrl with Cmd (WIN) for macOS; Alt maps to Option via the key layer. */
function macKeys(keys: readonly string[]): string[] {
  return keys.map((key) => (key === 'CTRL' ? 'WIN' : key))
}

/**
 * A hotkey preset with a macOS variant. The base actions stay Windows/Linux;
 * macOS swaps every Ctrl for WIN and gets a Cmd-based summary.
 */
function platformHotkeyPreset(
  id: string,
  name: string,
  description: string,
  icon: string,
  keys: string[],
  macDescription?: string,
): ActionPreset {
  const darwinKeys = macKeys(keys)
  return {
    id,
    name,
    description,
    icon,
    actions: [hotkey([...keys])],
    platformActions: { darwin: [hotkey(darwinKeys)] },
    platformDescriptions: { darwin: macDescription ?? formatCombo(darwinKeys, 'darwin') },
  }
}

function mediaPreset(id: string, name: string, description: string, icon: string, key: MediaKey): ActionPreset {
  return { id, name, description, icon, actions: [media(key)] }
}

/** Whether a preset should be shown on the given host platform. */
export function isPresetAvailable(preset: ActionPreset, platform: string): boolean {
  if (!preset.platforms) return true
  return preset.platforms.includes(normalizeHostPlatform(platform))
}

/** Resolve a preset's actions for the host platform (falls back to `actions`). */
export function resolvePresetActions(preset: ActionPreset, platform: string): Action[] {
  const host = normalizeHostPlatform(platform)
  return structuredClone(preset.platformActions?.[host] ?? preset.actions)
}

/**
 * Build a fresh deck button from a preset. Ids are generated so the same preset
 * can be added to multiple slots/pages. Pass a platform to use its resolved
 * actions; omit it for the platform-neutral base actions.
 */
export function presetToButton(preset: ActionPreset, slot: number, platform?: string): DeckButton {
  const actions = platform ? resolvePresetActions(preset, platform) : structuredClone(preset.actions)
  return {
    id: newId('btn'),
    slot,
    label: preset.name,
    ...(preset.icon ? { icon: preset.icon } : {}),
    actions,
  }
}

const chrome: ActionPack = {
  id: 'chrome',
  name: 'Chrome',
  description: 'Browser shortcuts for the active host OS.',
  presets: [
    platformHotkeyPreset('chrome-new-tab', 'New tab', 'Ctrl + T', '🌐', ['CTRL', 'T']),
    platformHotkeyPreset('chrome-new-window', 'New window', 'Ctrl + N', '🪟', ['CTRL', 'N']),
    platformHotkeyPreset(
      'chrome-incognito',
      'Incognito window',
      'Ctrl + Shift + N',
      '🕶️',
      ['CTRL', 'SHIFT', 'N'],
    ),
    platformHotkeyPreset(
      'chrome-reopen-tab',
      'Reopen closed tab',
      'Ctrl + Shift + T',
      '↩️',
      ['CTRL', 'SHIFT', 'T'],
    ),
    platformHotkeyPreset(
      'chrome-address-bar',
      'Address bar',
      'Ctrl + L, then type a URL',
      '🔗',
      ['CTRL', 'L'],
      'Cmd + L, then type a URL',
    ),
    platformHotkeyPreset('chrome-find', 'Find on page', 'Ctrl + F', '🔍', ['CTRL', 'F']),
    platformHotkeyPreset('chrome-history', 'History', 'Ctrl + H', '🕘', ['CTRL', 'H']),
    platformHotkeyPreset('chrome-downloads', 'Downloads', 'Ctrl + J', '⬇️', ['CTRL', 'J']),
    platformHotkeyPreset(
      'chrome-devtools',
      'Developer tools',
      'F12',
      '🛠️',
      ['F12'],
      'F12 (or Cmd + Option + I)',
    ),
    platformHotkeyPreset('chrome-reload', 'Reload page', 'Ctrl + R', '🔄', ['CTRL', 'R']),
    platformHotkeyPreset(
      'chrome-hard-reload',
      'Hard reload',
      'Ctrl + Shift + R (ignores cache)',
      '⚡',
      ['CTRL', 'SHIFT', 'R'],
      'Cmd + Shift + R (ignores cache)',
    ),
    platformHotkeyPreset('chrome-zoom-in', 'Zoom in', 'Ctrl + +', '🔎', ['CTRL', '+']),
    platformHotkeyPreset('chrome-zoom-out', 'Zoom out', 'Ctrl + -', '➖', ['CTRL', '-']),
    platformHotkeyPreset('chrome-zoom-reset', 'Reset zoom', 'Ctrl + 0', '🎯', ['CTRL', '0']),
    platformHotkeyPreset('chrome-print', 'Print', 'Ctrl + P', '🖨️', ['CTRL', 'P']),
    platformHotkeyPreset('chrome-bookmark', 'Bookmark page', 'Ctrl + D', '⭐', ['CTRL', 'D']),
  ],
}

const obs: ActionPack = {
  id: 'obs',
  name: 'OBS Studio',
  description:
    'OBS ships without recording/streaming hotkeys. These presets suggest chords — ' +
    'bind the same chords in OBS Settings → Hotkeys, or edit the action.',
  presets: [
    {
      id: 'obs-launch',
      name: 'Launch OBS',
      description: 'Windows default install path; edit the path if OBS lives elsewhere.',
      icon: '🎬',
      actions: [{ type: 'launch', path: 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe' }],
      platformActions: { darwin: [{ type: 'launch', path: '/Applications/OBS.app' }] },
      platformDescriptions: { darwin: 'Opens OBS from /Applications' },
    },
    hotkeyPreset('obs-start-recording', 'Start recording', 'Suggested OBS hotkey: F9', '⏺️', ['F9']),
    hotkeyPreset('obs-stop-recording', 'Stop recording', 'Suggested OBS hotkey: Shift + F9', '⏹️', ['SHIFT', 'F9']),
    hotkeyPreset('obs-start-streaming', 'Start streaming', 'Suggested OBS hotkey: F10', '📡', ['F10']),
    hotkeyPreset('obs-stop-streaming', 'Stop streaming', 'Suggested OBS hotkey: Shift + F10', '🔴', ['SHIFT', 'F10']),
    hotkeyPreset('obs-settings', 'OBS settings', 'Suggested OBS hotkey: Ctrl + , (rebind in OBS)', '⚙️', ['CTRL', ',']),
    hotkeyPreset(
      'obs-mute-mic',
      'Mute microphone',
      'Suggested OBS hotkey: Ctrl + Alt + M (bind to your mic source)',
      '🎙️',
      ['CTRL', 'ALT', 'M'],
    ),
  ],
}

const vscode: ActionPack = {
  id: 'vscode',
  name: 'VS Code',
  description: 'Editor shortcuts for the active host OS.',
  presets: [
    platformHotkeyPreset(
      'vscode-command-palette',
      'Command palette',
      'Ctrl + Shift + P',
      '⌘',
      ['CTRL', 'SHIFT', 'P'],
    ),
    platformHotkeyPreset('vscode-quick-open', 'Quick open file', 'Ctrl + P', '📂', ['CTRL', 'P']),
    platformHotkeyPreset('vscode-terminal', 'Toggle terminal', 'Ctrl + `', '⌨️', ['CTRL', '`']),
    platformHotkeyPreset('vscode-sidebar', 'Toggle sidebar', 'Ctrl + B', '📑', ['CTRL', 'B']),
    platformHotkeyPreset('vscode-search', 'Search in files', 'Ctrl + Shift + F', '🔎', ['CTRL', 'SHIFT', 'F']),
    platformHotkeyPreset('vscode-format', 'Format document', 'Shift + Alt + F', '🧹', ['SHIFT', 'ALT', 'F']),
    platformHotkeyPreset('vscode-rename', 'Rename symbol', 'F2', '✏️', ['F2']),
  ],
}

const system: ActionPack = {
  id: 'system',
  name: 'System',
  description: 'Desktop controls, filtered to the active host OS.',
  presets: [
    {
      id: 'system-lock',
      name: 'Lock screen',
      description: 'LockWorkStation on Windows/Linux; Ctrl + Cmd + Q on macOS.',
      icon: '🔒',
      actions: [{ type: 'command', command: 'rundll32.exe user32.dll,LockWorkStation', hidden: true }],
      platformActions: { darwin: [hotkey(['CTRL', 'WIN', 'Q'])] },
      platformDescriptions: { darwin: 'Ctrl + Cmd + Q' },
    },
    {
      ...hotkeyPreset('system-task-view', 'Task view', 'Win + Tab (Windows)', '🗂️', ['WIN', 'TAB']),
      platforms: ['win32'],
    },
    {
      id: 'system-show-desktop',
      name: 'Show desktop',
      description: 'Win + D on Windows/Linux; F11 on macOS.',
      icon: '🖥️',
      actions: [hotkey(['WIN', 'D'])],
      platformActions: { darwin: [hotkey(['F11'])] },
      platformDescriptions: { darwin: 'F11 (Show Desktop)' },
    },
    {
      ...hotkeyPreset('system-mission-control', 'Mission Control', 'Ctrl + Up (macOS)', '🧭', ['CTRL', 'UP']),
      platforms: ['darwin'],
    },
    {
      id: 'system-file-manager',
      name: 'File manager',
      description: 'Opens Explorer on Windows and Finder on macOS.',
      icon: '📁',
      actions: [{ type: 'launch', path: 'explorer.exe' }],
      platformActions: { darwin: [{ type: 'launch', path: '/System/Applications/Finder.app' }] },
      platformDescriptions: { darwin: 'Opens Finder' },
      platforms: ['win32', 'darwin'],
    },
    {
      id: 'system-screenshot',
      name: 'Screenshot',
      description: 'Region capture on Windows; full-screen PNG on macOS.',
      icon: '📸',
      actions: [hotkey(['WIN', 'SHIFT', 'S'])],
      platformDescriptions: { darwin: 'Cmd + Shift + S · full-screen capture' },
    },
    {
      ...hotkeyPreset(
        'system-clipboard-history',
        'Clipboard history',
        'Win + V (Windows; enable history in Settings first)',
        '📋',
        ['WIN', 'V'],
      ),
      platforms: ['win32'],
    },
    {
      ...hotkeyPreset('system-settings', 'System settings', 'Win + I (Windows)', '⚙️', ['WIN', 'I']),
      platforms: ['win32'],
    },
  ],
}

const mediaPack: ActionPack = {
  id: 'media',
  name: 'Media',
  description: 'System media keys; these work on Windows, macOS and Linux hosts.',
  presets: [
    mediaPreset('media-play-pause', 'Play / pause', 'Media play/pause key', '⏯️', 'playpause'),
    mediaPreset('media-next', 'Next track', 'Media next key', '⏭️', 'next'),
    mediaPreset('media-previous', 'Previous track', 'Media previous key', '⏮️', 'prev'),
    mediaPreset('media-stop', 'Stop playback', 'Media stop key', '⏹️', 'stop'),
    mediaPreset('media-volume-up', 'Volume up', 'System volume up', '🔊', 'volumeup'),
    mediaPreset('media-volume-down', 'Volume down', 'System volume down', '🔉', 'volumedown'),
    mediaPreset('media-mute', 'Mute', 'System mute toggle', '🔇', 'mute'),
  ],
}

export const ACTION_PACKS: ActionPack[] = [chrome, obs, vscode, system, mediaPack]

export function findActionPack(packId: string): ActionPack | undefined {
  return ACTION_PACKS.find((pack) => pack.id === packId)
}

export function findActionPreset(presetId: string): ActionPreset | undefined {
  for (const pack of ACTION_PACKS) {
    const preset = pack.presets.find((candidate) => candidate.id === presetId)
    if (preset) return preset
  }
  return undefined
}
