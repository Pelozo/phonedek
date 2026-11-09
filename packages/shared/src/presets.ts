/**
 * Predefined action packs for the desktop editor.
 *
 * These are plain JSON data: every item validates against `ActionSchema` and
 * can be copied into a button without transformation. Presets may carry
 * platform-specific actions/descriptions so the editor never shows a
 * Windows-only chord on macOS (or a macOS-only chord on Windows).
 */

import type { Action, DeckButton, MacroStep, MediaKey } from './types'
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

/**
 * A hotkey preset whose macOS variant is written explicitly (JetBrains keeps
 * several Ctrl chords on macOS instead of using Cmd).
 */
function dualHotkeyPreset(
  id: string,
  name: string,
  description: string,
  icon: string,
  baseKeys: string[],
  darwinKeys: string[],
  darwinDescription?: string,
): ActionPreset {
  return {
    id,
    name,
    description,
    icon,
    actions: [hotkey([...baseKeys])],
    platformActions: { darwin: [hotkey([...darwinKeys])] },
    platformDescriptions: {
      darwin: darwinDescription ?? formatCombo(darwinKeys, 'darwin'),
    },
  }
}

/** OpenCode TUI leader sequence: Ctrl+X, short delay, then one key. */
function leaderPreset(id: string, name: string, key: string, icon: string): ActionPreset {
  const steps: MacroStep[] = [
    { type: 'hotkey', keys: ['CTRL', 'X'] },
    { type: 'delay', ms: 80 },
    { type: 'hotkey', keys: [key] },
  ]
  return {
    id,
    name,
    description: `Ctrl+X then ${key}`,
    icon,
    actions: [{ type: 'macro', steps }],
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

const jetbrains: ActionPack = {
  id: 'jetbrains',
  name: 'JetBrains IDEs',
  description:
    'JetBrains shortcuts for Windows/Linux, with native macOS overrides. Logcat is Android Studio only.',
  presets: [
    dualHotkeyPreset('jetbrains-build', 'Build project', 'Ctrl + F9', '🔨', ['CTRL', 'F9'], ['WIN', 'F9']),
    dualHotkeyPreset('jetbrains-run', 'Run', 'Shift + F10', '▶️', ['SHIFT', 'F10'], ['CTRL', 'R']),
    dualHotkeyPreset('jetbrains-debug', 'Debug', 'Shift + F9', '🐞', ['SHIFT', 'F9'], ['CTRL', 'D']),
    dualHotkeyPreset('jetbrains-stop', 'Stop', 'Ctrl + F2', '⏹️', ['CTRL', 'F2'], ['WIN', 'F2']),
    dualHotkeyPreset(
      'jetbrains-find-action',
      'Find action',
      'Ctrl + Shift + A',
      '🔎',
      ['CTRL', 'SHIFT', 'A'],
      ['WIN', 'SHIFT', 'A'],
    ),
    dualHotkeyPreset('jetbrains-open-class', 'Open class', 'Ctrl + N', '🏷️', ['CTRL', 'N'], ['WIN', 'O']),
    dualHotkeyPreset(
      'jetbrains-open-file',
      'Open file',
      'Ctrl + Shift + N',
      '📄',
      ['CTRL', 'SHIFT', 'N'],
      ['WIN', 'SHIFT', 'O'],
    ),
    dualHotkeyPreset(
      'jetbrains-find-in-path',
      'Find in path',
      'Ctrl + Shift + F',
      '🔍',
      ['CTRL', 'SHIFT', 'F'],
      ['WIN', 'SHIFT', 'F'],
    ),
    dualHotkeyPreset(
      'jetbrains-replace-in-path',
      'Replace in path',
      'Ctrl + Shift + R',
      '🔁',
      ['CTRL', 'SHIFT', 'R'],
      ['WIN', 'SHIFT', 'R'],
    ),
    dualHotkeyPreset(
      'jetbrains-reformat',
      'Reformat code',
      'Ctrl + Alt + L',
      '🧹',
      ['CTRL', 'ALT', 'L'],
      ['WIN', 'ALT', 'L'],
    ),
    dualHotkeyPreset(
      'jetbrains-optimize-imports',
      'Optimize imports',
      'Ctrl + Alt + O',
      '🧼',
      ['CTRL', 'ALT', 'O'],
      ['CTRL', 'ALT', 'O'],
    ),
    dualHotkeyPreset(
      'jetbrains-terminal',
      'Toggle terminal',
      'Alt + F12',
      '⌨️',
      ['ALT', 'F12'],
      ['ALT', 'F12'],
    ),
    dualHotkeyPreset('jetbrains-project-view', 'Project view', 'Alt + 1', '🗂️', ['ALT', '1'], ['WIN', '1']),
    dualHotkeyPreset('jetbrains-git', 'Git', 'Alt + 9', '🌿', ['ALT', '9'], ['WIN', '9']),
    dualHotkeyPreset(
      'jetbrains-logcat',
      'Logcat',
      'Android Studio only — Alt + 6',
      '📜',
      ['ALT', '6'],
      ['WIN', '6'],
      'Android Studio only — Cmd + 6',
    ),
  ],
}

const opencode: ActionPack = {
  id: 'opencode',
  name: 'OpenCode',
  description:
    'OpenCode TUI leader shortcuts. Focus the TUI first; the leader is Ctrl+X with its ~2s window.',
  presets: [
    leaderPreset('opencode-new-session', 'New session', 'N', '➕'),
    leaderPreset('opencode-sessions', 'Sessions', 'L', '🗂️'),
    leaderPreset('opencode-models', 'Models', 'M', '🧠'),
    leaderPreset('opencode-agents', 'Agents', 'A', '🤖'),
    hotkeyPreset('opencode-command-palette', 'Command palette', 'Ctrl + P', '⌘', ['CTRL', 'P']),
    leaderPreset('opencode-undo', 'Undo', 'U', '↩️'),
    leaderPreset('opencode-redo', 'Redo', 'R', '↪️'),
    leaderPreset('opencode-compact-session', 'Compact session', 'C', '🗜️'),
    leaderPreset('opencode-toggle-sidebar', 'Toggle sidebar', 'B', '📑'),
    leaderPreset('opencode-editor', 'Editor', 'E', '✏️'),
    leaderPreset('opencode-themes', 'Themes', 'T', '🎨'),
    leaderPreset('opencode-export', 'Export', 'X', '📤'),
    leaderPreset('opencode-status', 'Status', 'S', '📊'),
    leaderPreset('opencode-exit', 'Exit', 'Q', '🚪'),
  ],
}

const wow: ActionPack = {
  id: 'wow',
  name: 'World of Warcraft',
  description:
    'Common WoW default keybinds. Action-bar slots and UI keys vary by character and addons — remap in-game if needed.',
  presets: [
    hotkeyPreset('wow-action-1', 'Action bar 1', 'Use action bar slot 1.', '1️⃣', ['1']),
    hotkeyPreset('wow-action-2', 'Action bar 2', 'Use action bar slot 2.', '2️⃣', ['2']),
    hotkeyPreset('wow-action-3', 'Action bar 3', 'Use action bar slot 3.', '3️⃣', ['3']),
    hotkeyPreset('wow-action-4', 'Action bar 4', 'Use action bar slot 4.', '4️⃣', ['4']),
    hotkeyPreset('wow-action-5', 'Action bar 5', 'Use action bar slot 5.', '5️⃣', ['5']),
    hotkeyPreset('wow-jump', 'Jump', 'Jump (Space).', '🦘', ['SPACE']),
    hotkeyPreset('wow-interact', 'Interact', 'Interact with target (F).', '🤝', ['F']),
    hotkeyPreset('wow-target-enemy', 'Target nearest enemy', 'Target nearest enemy (Tab).', '🎯', ['TAB']),
    hotkeyPreset('wow-character', 'Character sheet', 'Open character sheet (C).', '👤', ['C']),
    hotkeyPreset('wow-spellbook', 'Spellbook', 'Open spellbook (P).', '📖', ['P']),
    hotkeyPreset('wow-talents', 'Talents', 'Open talents (N).', '🌟', ['N']),
    hotkeyPreset('wow-quest-log', 'Quest log', 'Open quest log (L).', '📜', ['L']),
    hotkeyPreset('wow-map', 'World map', 'Open world map (M).', '🗺️', ['M']),
    hotkeyPreset('wow-inventory', 'Backpack', 'Open inventory (B).', '🎒', ['B']),
    hotkeyPreset('wow-social', 'Social', 'Open social panel (O).', '💬', ['O']),
    hotkeyPreset('wow-guild', 'Guild & communities', 'Open guild panel (J).', '🛡️', ['J']),
    hotkeyPreset('wow-collections', 'Collections', 'Open collections (Shift+P).', '🐎', ['SHIFT', 'P']),
    hotkeyPreset('wow-achievements', 'Achievements', 'Open achievements (Y).', '🏆', ['Y']),
    hotkeyPreset('wow-dungeon-finder', 'Dungeon finder', 'Open group finder (I).', '👥', ['I']),
    hotkeyPreset('wow-toggle-ui', 'Toggle UI', 'Hide the interface (Alt+Z).', '🖥️', ['ALT', 'Z']),
    hotkeyPreset('wow-screenshot', 'Screenshot', 'Take a screenshot (Print Screen).', '📸', ['PRINTSCREEN']),
  ],
}

const gw2: ActionPack = {
  id: 'gw2',
  name: 'Guild Wars 2',
  description:
    'Common Guild Wars 2 defaults. Skill slots and mount keys can be remapped in-game; adjust to your build.',
  presets: [
    hotkeyPreset('gw2-heal', 'Heal skill', 'Use healing skill (6).', '💚', ['6']),
    hotkeyPreset('gw2-utility-1', 'Utility 1', 'Use utility skill 1 (7).', '7️⃣', ['7']),
    hotkeyPreset('gw2-utility-2', 'Utility 2', 'Use utility skill 2 (8).', '8️⃣', ['8']),
    hotkeyPreset('gw2-utility-3', 'Utility 3', 'Use utility skill 3 (9).', '9️⃣', ['9']),
    hotkeyPreset('gw2-elite', 'Elite skill', 'Use elite skill (0).', '0️⃣', ['0']),
    hotkeyPreset('gw2-dodge', 'Dodge', 'Dodge (V).', '💨', ['V']),
    hotkeyPreset('gw2-interact', 'Interact', 'Interact with target (F).', '🤝', ['F']),
    hotkeyPreset('gw2-weapon-swap', 'Weapon swap', 'Swap weapon sets (`).', '🔄', ['`']),
    hotkeyPreset('gw2-mount', 'Mount', 'Mount up (X).', '🐎', ['X']),
    hotkeyPreset('gw2-target-enemy', 'Target nearest enemy', 'Target nearest enemy (Tab).', '🎯', ['TAB']),
    hotkeyPreset('gw2-jump', 'Jump', 'Jump (Space).', '🦘', ['SPACE']),
    hotkeyPreset('gw2-inventory', 'Inventory', 'Open inventory (I).', '🎒', ['I']),
    hotkeyPreset('gw2-hero', 'Hero panel', 'Open hero panel (H).', '👤', ['H']),
    hotkeyPreset('gw2-map', 'World map', 'Open world map (M).', '🗺️', ['M']),
    hotkeyPreset('gw2-guild', 'Guild', 'Open guild panel (G).', '🛡️', ['G']),
    hotkeyPreset('gw2-options', 'Options', 'Open game options (F11).', '⚙️', ['F11']),
    hotkeyPreset('gw2-screenshot', 'Screenshot', 'Take a screenshot (Print Screen).', '📸', ['PRINTSCREEN']),
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
      description: 'Full-screen PNG capture.',
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

export const ACTION_PACKS: ActionPack[] = [
  chrome,
  obs,
  vscode,
  jetbrains,
  opencode,
  wow,
  gw2,
  system,
  mediaPack,
]

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
