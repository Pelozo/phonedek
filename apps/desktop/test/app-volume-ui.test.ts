import { describe, expect, it } from 'vitest'
import type { MixerSession, MixerSnapshot } from '@phonedek/shared'
import {
  APP_MUTE_BADGE,
  APP_VOLUME_BADGE,
  APP_VOLUME_STATUS_TILES,
  appProcessKey,
  appVolumeActionSummary,
  appVolumeActionWithMode,
  appVolumeActionWithProcess,
  appVolumeControlSpec,
  appVolumeStateBadge,
  appVolumeStateBindingSummary,
  createAppVolumeButton,
  createAppVolumeStatusButton,
  findMixerSession,
  mixerAvailability,
  mixerProcessOptions,
  mixerSessionDetail,
} from '../src/renderer/src/lib/appVolume'

const chrome: MixerSession = {
  id: 's1',
  process: 'chrome',
  name: 'Google Chrome',
  volume: 42,
  muted: false,
  available: true,
}

function snapshot(patch: Partial<MixerSnapshot> = {}): MixerSnapshot {
  return {
    available: true,
    sessions: [chrome],
    updatedAt: 1,
    ...patch,
  }
}

describe('app volume badges and summaries', () => {
  it('uses the short APP · VOL / APP · MUTE badges required by the deck preview', () => {
    expect(APP_VOLUME_BADGE).toBe('APP · VOL')
    expect(APP_MUTE_BADGE).toBe('APP · MUTE')
    expect(appVolumeStateBadge('volume')).toBe('APP · VOL')
    expect(appVolumeStateBadge('mute')).toBe('APP · MUTE')
  })

  it('summarizes a status binding with the matched process', () => {
    expect(
      appVolumeStateBindingSummary({
        type: 'appVolume',
        target: 'volume',
        match: { process: 'discord' },
      }),
    ).toBe('Volume · discord')
    expect(
      appVolumeStateBindingSummary({ type: 'appVolume', target: 'mute', match: {} }),
    ).toBe('Mute · No app selected')
    expect(appVolumeStateBindingSummary(null)).toBeNull()
  })
})

describe('mixer snapshot helpers', () => {
  it('normalizes process keys like the desktop matcher', () => {
    expect(appProcessKey('C:\\Games\\Discord.exe')).toBe('discord')
    expect(appProcessKey('/usr/lib/firefox/firefox')).toBe('firefox')
    expect(appProcessKey(' Google Chrome ')).toBe('google chrome')
    expect(appProcessKey(undefined)).toBe('')
  })

  it('dedupes sessions by process and flags ambiguity', () => {
    const options = mixerProcessOptions(
      snapshot({
        sessions: [
          chrome,
          { ...chrome, id: 's2', name: 'Chrome (media)', volume: 80, muted: true },
          { id: 's3', process: 'Discord', name: 'Discord', volume: 30, muted: false },
        ],
        ambiguous: ['chrome'],
      }),
    )
    expect(options).toHaveLength(2)
    expect(options[0]).toMatchObject({
      process: 'chrome',
      name: 'Google Chrome',
      count: 2,
      ambiguous: true,
    })
    expect(options[1]).toMatchObject({ process: 'Discord', count: 1, ambiguous: false })
  })

  it('finds sessions by process or display name', () => {
    expect(findMixerSession(snapshot(), 'chrome')?.id).toBe('s1')
    expect(findMixerSession(snapshot(), 'Google Chrome')?.id).toBe('s1')
    expect(findMixerSession(snapshot(), 'missing')).toBeNull()
    expect(findMixerSession(null, 'chrome')).toBeNull()
    expect(mixerSessionDetail(chrome)).toBe('42%')
    expect(mixerSessionDetail({ ...chrome, muted: true })).toBe('MUTED')
    expect(mixerSessionDetail({ ...chrome, available: false })).toBe('OFFLINE')
  })

  it('describes unsupported, empty, unselected, missing and ready states', () => {
    expect(mixerAvailability(null).label).toBe('CHECKING')
    expect(mixerAvailability(null, undefined, 'IPC down')).toMatchObject({
      label: 'MIXER ERROR',
      tone: 'error',
    })
    expect(
      mixerAvailability(
        snapshot({ available: false, sessions: [], reason: 'macOS has no per-app API' }),
      ),
    ).toMatchObject({ label: 'NO MIXER', tone: 'warn' })
    expect(mixerAvailability(snapshot({ sessions: [] })).label).toBe('NO SESSION')
    expect(mixerAvailability(snapshot()).label).toBe('PICK APP')
    expect(mixerAvailability(snapshot(), 'missing')).toMatchObject({
      label: 'NO SESSION',
      tone: 'warn',
    })
    expect(mixerAvailability(snapshot(), 'chrome')).toMatchObject({
      label: 'READY',
      tone: 'ok',
    })
    expect(mixerAvailability(snapshot(), 'chrome').detail).toContain('42%')
  })
})

describe('app volume control creation', () => {
  it('seeds the slider from the live session volume', () => {
    expect(appVolumeControlSpec(chrome)).toMatchObject({
      kind: 'slider',
      axis: 'horizontal',
      emit: 'value',
      binding: { type: 'appVolume', target: 'volume', match: { process: 'chrome' } },
      min: 0,
      max: 100,
      step: 1,
      initial: 42,
      unit: '%',
    })
    expect(appVolumeControlSpec({ ...chrome, volume: 140 }).initial).toBe(100)
    expect(appVolumeControlSpec({ ...chrome, volume: -4 }).initial).toBe(0)
  })

  it('creates a control button with a toggle-mute tap action', () => {
    const button = createAppVolumeButton(chrome, 5, { columns: 3, rows: 1 })
    expect(button).toMatchObject({
      slot: 5,
      label: 'Google Chrome',
      icon: '🎚️',
      span: { columns: 3, rows: 1 },
      control: { binding: { type: 'appVolume', match: { process: 'chrome' } } },
    })
    expect(button.actions).toEqual([
      { type: 'appVolume', action: 'toggleMute', match: { process: 'chrome' } },
    ])
  })
})

describe('app status tiles', () => {
  it('creates volume and mute presets with static badges', () => {
    expect(APP_VOLUME_STATUS_TILES.map((preset) => preset.target)).toEqual(['volume', 'mute'])
    for (const preset of APP_VOLUME_STATUS_TILES) {
      const button = createAppVolumeStatusButton(preset, 4, chrome)
      expect(button.slot).toBe(4)
      expect(button.label).toBe(preset.label)
      expect(button.state).toEqual({
        type: 'appVolume',
        target: preset.target,
        match: { process: 'chrome' },
      })
      expect(button.span).toBeUndefined()
      if (preset.target === 'mute') {
        expect(button.actions).toEqual([
          { type: 'appVolume', action: 'toggleMute', match: { process: 'chrome' } },
        ])
      } else {
        expect(button.actions).toEqual([])
      }
    }
  })
})

describe('app volume actions', () => {
  it('switches between toggle, mute and unmute without losing the process', () => {
    const toggle = {
      type: 'appVolume',
      action: 'toggleMute',
      match: { process: 'chrome' },
    } as const
    expect(appVolumeActionWithMode(toggle, 'mute')).toEqual({
      type: 'appVolume',
      action: 'setMute',
      match: { process: 'chrome' },
      muted: true,
    })
    expect(appVolumeActionWithMode(toggle, 'unmute')).toMatchObject({ muted: false })
    expect(appVolumeActionWithMode(toggle, 'toggle')).toEqual(toggle)
    expect(appVolumeActionWithProcess(toggle, 'discord')).toMatchObject({
      match: { process: 'discord' },
    })
    expect(appVolumeActionSummary(toggle)).toBe('Toggle mute · chrome')
    expect(appVolumeActionSummary(appVolumeActionWithMode(toggle, 'mute'))).toBe('Mute · chrome')
  })
})
