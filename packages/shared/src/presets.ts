/**
 * Predefined action packs for the desktop editor.
 *
 * These are plain JSON data: every item validates against `ActionSchema` and
 * can be copied into a button without transformation. The renderer only needs
 * to list the packs/presets and call `presetToButton()` when one is chosen.
 *
 * Platform note: the shared key layer maps WIN to Command on macOS. Packs that
 * need OS-specific chords (Chrome, VS Code) use Windows/Linux Ctrl chords by
 * default; on macOS the user can change Ctrl to Win in the action editor. Media
 * keys and the screenshot intent work on every supported host.
 */

import type { Action, DeckButton, MediaKey } from './types'
import { newId } from './ids'

export interface ActionPreset {
  /** Globally unique, stable id (letters, digits, "-" and "_"). */
  id: string
  name: string
  description: string
  /** Short emoji shown on the deck key. */
  icon?: string
  actions: Action[]
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

function mediaPreset(id: string, name: string, description: string, icon: string, key: MediaKey): ActionPreset {
  return { id, name, description, icon, actions: [media(key)] }
}

/**
 * Build a fresh deck button from a preset. Ids are generated so the same preset
 * can be added to multiple slots/pages.
 */
export function presetToButton(preset: ActionPreset, slot: number): DeckButton {
  return {
    id: newId('btn'),
    slot,
    label: preset.name,
    ...(preset.icon ? { icon: preset.icon } : {}),
    actions: structuredClone(preset.actions),
  }
}

const chrome: ActionPack = {
  id: 'chrome',
  name: 'Chrome',
  description:
    'Browser shortcuts on Windows/Linux chords. On macOS, change Ctrl to Win (Command) ' +
    'in the action editor — the key layer maps Win to Command.',
  presets: [
    hotkeyPreset('chrome-new-tab', 'New tab', 'Ctrl + T', '🌐', ['CTRL', 'T']),
    hotkeyPreset('chrome-new-window', 'New window', 'Ctrl + N', '🪟', ['CTRL', 'N']),
    hotkeyPreset('chrome-incognito', 'Incognito window', 'Ctrl + Shift + N', '🕶️', ['CTRL', 'SHIFT', 'N']),
    hotkeyPreset('chrome-reopen-tab', 'Reopen closed tab', 'Ctrl + Shift + T', '↩️', ['CTRL', 'SHIFT', 'T']),
    hotkeyPreset('chrome-address-bar', 'Address bar', 'Ctrl + L, then type a URL', '🔗', ['CTRL', 'L']),
    hotkeyPreset('chrome-find', 'Find on page', 'Ctrl + F', '🔍', ['CTRL', 'F']),
    hotkeyPreset('chrome-history', 'History', 'Ctrl + H', '🕘', ['CTRL', 'H']),
    hotkeyPreset('chrome-downloads', 'Downloads', 'Ctrl + J', '⬇️', ['CTRL', 'J']),
    hotkeyPreset('chrome-devtools', 'Developer tools', 'F12 (Cmd + Option + I on macOS)', '🛠️', ['F12']),
    hotkeyPreset('chrome-reload', 'Reload page', 'Ctrl + R', '🔄', ['CTRL', 'R']),
    hotkeyPreset('chrome-hard-reload', 'Hard reload', 'Ctrl + Shift + R (ignores cache)', '⚡', ['CTRL', 'SHIFT', 'R']),
    hotkeyPreset('chrome-zoom-in', 'Zoom in', 'Ctrl + +', '🔎', ['CTRL', '+']),
    hotkeyPreset('chrome-zoom-out', 'Zoom out', 'Ctrl + -', '➖', ['CTRL', '-']),
    hotkeyPreset('chrome-zoom-reset', 'Reset zoom', 'Ctrl + 0', '🎯', ['CTRL', '0']),
    hotkeyPreset('chrome-print', 'Print', 'Ctrl + P', '🖨️', ['CTRL', 'P']),
    hotkeyPreset('chrome-bookmark', 'Bookmark page', 'Ctrl + D', '⭐', ['CTRL', 'D']),
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
  description:
    'Editor shortcuts on Windows/Linux chords. On macOS, change Ctrl to Win (Command) in the ' +
    'action editor — the key layer maps Win to Command.',
  presets: [
    hotkeyPreset(
      'vscode-command-palette',
      'Command palette',
      'Ctrl + Shift + P',
      '⌘',
      ['CTRL', 'SHIFT', 'P'],
    ),
    hotkeyPreset('vscode-quick-open', 'Quick open file', 'Ctrl + P', '📂', ['CTRL', 'P']),
    hotkeyPreset('vscode-terminal', 'Toggle terminal', 'Ctrl + `', '⌨️', ['CTRL', '`']),
    hotkeyPreset('vscode-sidebar', 'Toggle sidebar', 'Ctrl + B', '📑', ['CTRL', 'B']),
    hotkeyPreset('vscode-search', 'Search in files', 'Ctrl + Shift + F', '🔎', ['CTRL', 'SHIFT', 'F']),
    hotkeyPreset('vscode-format', 'Format document', 'Shift + Alt + F', '🧹', ['SHIFT', 'ALT', 'F']),
    hotkeyPreset('vscode-rename', 'Rename symbol', 'F2', '✏️', ['F2']),
  ],
}

const system: ActionPack = {
  id: 'system',
  name: 'System',
  description:
    'Desktop controls with Windows-first defaults. macOS equivalents are noted where a ' +
    'different chord or command is needed.',
  presets: [
    {
      id: 'system-lock',
      name: 'Lock screen',
      description: 'Windows: LockWorkStation. macOS: use Ctrl + Win + Q instead.',
      icon: '🔒',
      actions: [{ type: 'command', command: 'rundll32.exe user32.dll,LockWorkStation', hidden: true }],
    },
    hotkeyPreset('system-task-view', 'Task view', 'Win + Tab (Windows)', '🗂️', ['WIN', 'TAB']),
    hotkeyPreset('system-show-desktop', 'Show desktop', 'Win + D (Windows)', '🖥️', ['WIN', 'D']),
    hotkeyPreset('system-mission-control', 'Mission Control', 'Ctrl + Up (macOS)', '🧭', ['CTRL', 'UP']),
    {
      id: 'system-file-manager',
      name: 'File manager',
      description: 'Opens Explorer on Windows. Edit to a Finder command on macOS.',
      icon: '📁',
      actions: [{ type: 'launch', path: 'explorer.exe' }],
    },
    hotkeyPreset(
      'system-screenshot',
      'Screenshot',
      'Full screen on macOS; Snipping Tool on Windows (Win + Shift + S)',
      '📸',
      ['WIN', 'SHIFT', 'S'],
    ),
    hotkeyPreset(
      'system-clipboard-history',
      'Clipboard history',
      'Win + V (Windows; enable history in Settings first)',
      '📋',
      ['WIN', 'V'],
    ),
    hotkeyPreset('system-settings', 'System settings', 'Win + I (Windows)', '⚙️', ['WIN', 'I']),
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
