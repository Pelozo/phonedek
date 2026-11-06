import type {
  Action,
  Background,
  DeckButton,
  DeckConfig,
  DeckPage,
  DeckProfile,
  GridSettings,
  ProfileTheme,
} from './types'
import { CONFIG_SCHEMA_VERSION } from './types'
import { newId } from './ids'

export const GRADIENTS = [
  { name: 'Ocean', from: '#0ea5e9', to: '#2563eb' },
  { name: 'Mint', from: '#10b981', to: '#0d9488' },
  { name: 'Sunset', from: '#f59e0b', to: '#ef4444' },
  { name: 'Grape', from: '#8b5cf6', to: '#d946ef' },
  { name: 'Rose', from: '#f43f5e', to: '#be123c' },
  { name: 'Slate', from: '#334155', to: '#0f172a' },
  { name: 'Cyber', from: '#22d3ee', to: '#a855f7' },
  { name: 'Lime', from: '#84cc16', to: '#15803d' },
] as const

export const SOLID_PRESETS = [
  '#0f172a',
  '#1e293b',
  '#334155',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#f8fafc',
] as const

export function gradient(from: string, to: string, angle = 145, overlay?: number): Background {
  return overlay === undefined ? { type: 'gradient', from, to, angle } : { type: 'gradient', from, to, angle, overlay }
}

export function solid(color: string, overlay?: number): Background {
  return overlay === undefined ? { type: 'color', color } : { type: 'color', color, overlay }
}

export const DEFAULT_THEME: ProfileTheme = {
  background: gradient('#080d19', '#111c33', 160),
  buttonBackground: gradient('#1e293b', '#334155', 145),
  textColor: '#f8fafc',
  accentColor: '#34d399',
  fontSize: 15,
  buttonRadius: 18,
}

export const DEFAULT_GRID: GridSettings = {
  columns: 5,
  rows: 3,
  gap: 12,
  padding: 14,
}

export function createEmptyButton(slot: number, label = 'New button'): DeckButton {
  return {
    id: newId('btn'),
    slot,
    label,
    icon: '＋',
    actions: [],
  }
}

export function createEmptyPage(name = 'New page'): DeckPage {
  return { id: newId('page'), name, buttons: [] }
}

export function createEmptyProfile(name = 'New profile'): DeckProfile {
  const page = createEmptyPage('Main')
  return {
    id: newId('profile'),
    name,
    grid: { ...DEFAULT_GRID },
    theme: structuredClone(DEFAULT_THEME),
    pages: [page],
    defaultPageId: page.id,
  }
}

interface StarterButton {
  slot: number
  label: string
  sublabel?: string
  icon: string
  background: Background
  actions: Action[]
}

function starter(id: string, input: StarterButton): DeckButton {
  return {
    id,
    slot: input.slot,
    label: input.label,
    sublabel: input.sublabel,
    icon: input.icon,
    background: input.background,
    actions: input.actions,
  }
}

function media(key: 'playpause' | 'next' | 'prev' | 'stop' | 'volumeup' | 'volumedown' | 'mute'): Action {
  return { type: 'media', key }
}

function hotkey(...keys: string[]): Action {
  return { type: 'hotkey', keys }
}

function mainPage(): DeckPage {
  return {
    id: 'page-main',
    name: 'Main',
    buttons: [
      starter('btn-vol-down', {
        slot: 0,
        label: 'Volume down',
        icon: '🔉',
        background: gradient('#0f766e', '#0d9488'),
        actions: [media('volumedown')],
      }),
      starter('btn-mute', {
        slot: 1,
        label: 'Mute',
        icon: '🔇',
        background: gradient('#475569', '#1e293b'),
        actions: [media('mute')],
      }),
      starter('btn-vol-up', {
        slot: 2,
        label: 'Volume up',
        icon: '🔊',
        background: gradient('#0e7490', '#0891b2'),
        actions: [media('volumeup')],
      }),
      starter('btn-prev', {
        slot: 3,
        label: 'Previous',
        icon: '⏮️',
        background: gradient('#4338ca', '#6366f1'),
        actions: [media('prev')],
      }),
      starter('btn-next', {
        slot: 4,
        label: 'Next track',
        icon: '⏭️',
        background: gradient('#6d28d9', '#8b5cf6'),
        actions: [media('next')],
      }),
      starter('btn-play', {
        slot: 5,
        label: 'Play / pause',
        icon: '⏯️',
        background: gradient('#047857', '#10b981'),
        actions: [media('playpause')],
      }),
      starter('btn-screenshot', {
        slot: 6,
        label: 'Screenshot',
        sublabel: 'Win + Shift + S',
        icon: '📸',
        background: gradient('#0369a1', '#0ea5e9'),
        actions: [hotkey('WIN', 'SHIFT', 'S')],
      }),
      starter('btn-taskview', {
        slot: 7,
        label: 'Task view',
        sublabel: 'Win + Tab',
        icon: '🗂️',
        background: gradient('#1e40af', '#3b82f6'),
        actions: [hotkey('WIN', 'TAB')],
      }),
      starter('btn-desktop', {
        slot: 8,
        label: 'Show desktop',
        sublabel: 'Win + D',
        icon: '🖥️',
        background: gradient('#334155', '#64748b'),
        actions: [hotkey('WIN', 'D')],
      }),
      starter('btn-lock', {
        slot: 9,
        label: 'Lock PC',
        icon: '🔒',
        background: gradient('#9f1239', '#e11d48'),
        actions: [{ type: 'command', command: 'rundll32.exe user32.dll,LockWorkStation', hidden: true }],
      }),
      starter('btn-copy', {
        slot: 10,
        label: 'Copy',
        sublabel: 'Ctrl + C',
        icon: '📋',
        background: gradient('#065f46', '#059669'),
        actions: [hotkey('CTRL', 'C')],
      }),
      starter('btn-paste', {
        slot: 11,
        label: 'Paste',
        sublabel: 'Ctrl + V',
        icon: '📌',
        background: gradient('#7c2d12', '#ea580c'),
        actions: [hotkey('CTRL', 'V')],
      }),
      starter('btn-undo', {
        slot: 12,
        label: 'Undo',
        sublabel: 'Ctrl + Z',
        icon: '↩️',
        background: gradient('#854d0e', '#ca8a04'),
        actions: [hotkey('CTRL', 'Z')],
      }),
      starter('btn-youtube', {
        slot: 13,
        label: 'YouTube',
        icon: '▶️',
        background: gradient('#b91c1c', '#ef4444'),
        actions: [{ type: 'url', url: 'https://www.youtube.com' }],
      }),
      starter('btn-media-page', {
        slot: 14,
        label: 'Media page',
        sublabel: 'Page 2',
        icon: '🎵',
        background: gradient('#7e22ce', '#c026d3'),
        actions: [{ type: 'page', direction: 'next' }],
      }),
    ],
  }
}

function mediaPage(): DeckPage {
  return {
    id: 'page-media',
    name: 'Media',
    background: gradient('#12081f', '#251040', 160),
    buttons: [
      starter('btn-back-main', {
        slot: 0,
        label: 'Back',
        icon: '◀️',
        background: gradient('#312e81', '#4f46e5'),
        actions: [{ type: 'page', direction: 'prev' }],
      }),
      starter('btn-media-prev', {
        slot: 1,
        label: 'Previous',
        icon: '⏮️',
        background: gradient('#4338ca', '#6366f1'),
        actions: [media('prev')],
      }),
      starter('btn-media-play', {
        slot: 2,
        label: 'Play / pause',
        icon: '⏯️',
        background: gradient('#047857', '#10b981'),
        actions: [media('playpause')],
      }),
      starter('btn-media-next', {
        slot: 3,
        label: 'Next track',
        icon: '⏭️',
        background: gradient('#6d28d9', '#8b5cf6'),
        actions: [media('next')],
      }),
      starter('btn-media-stop', {
        slot: 4,
        label: 'Stop',
        icon: '⏹️',
        background: gradient('#7f1d1d', '#dc2626'),
        actions: [media('stop')],
      }),
      starter('btn-media-voldown', {
        slot: 5,
        label: 'Volume down',
        icon: '🔉',
        background: gradient('#0f766e', '#0d9488'),
        actions: [media('volumedown')],
      }),
      starter('btn-media-mute', {
        slot: 6,
        label: 'Mute',
        icon: '🔇',
        background: gradient('#475569', '#1e293b'),
        actions: [media('mute')],
      }),
      starter('btn-media-volup', {
        slot: 7,
        label: 'Volume up',
        icon: '🔊',
        background: gradient('#0e7490', '#0891b2'),
        actions: [media('volumeup')],
      }),
      starter('btn-spotify', {
        slot: 8,
        label: 'Spotify',
        icon: '🎧',
        background: gradient('#15803d', '#22c55e'),
        actions: [{ type: 'url', url: 'https://open.spotify.com' }],
      }),
      starter('btn-ytmusic', {
        slot: 9,
        label: 'YT Music',
        icon: '🎶',
        background: gradient('#b91c1c', '#ef4444'),
        actions: [{ type: 'url', url: 'https://music.youtube.com' }],
      }),
    ],
  }
}

export function createDefaultConfig(now: Date = new Date()): DeckConfig {
  const profile: DeckProfile = {
    id: 'profile-desktop',
    name: 'My PC',
    grid: { ...DEFAULT_GRID },
    theme: structuredClone(DEFAULT_THEME),
    pages: [mainPage(), mediaPage()],
    defaultPageId: 'page-main',
  }

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    serverName: 'PhoneDeck',
    defaultProfileId: profile.id,
    profiles: [profile],
  }
}
