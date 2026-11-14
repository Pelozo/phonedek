import { describe, expect, it } from 'vitest'
import type { Action, ConfigAction } from '@phonedek/shared'
import {
  DEFAULT_MIXER_SPAN,
  MIXER_ACTION_BODY,
  MIXER_ACTION_SUMMARY,
  MIXER_ACTION_TITLE,
  MIXER_BADGE,
  MIXER_LAUNCHER_ICON,
  MIXER_LAUNCHER_LABEL,
  MIXER_LAUNCHER_SUBLABEL,
  MIXER_UNSUPPORTED_FALLBACK,
  createMixerLauncher,
  hasMixerAction,
  hasMixerLauncher,
  isMixerAction,
  mixerAction,
  mixerSpanCandidates,
  mixerSupportNote,
} from '../src/renderer/src/lib/mixer'

describe('mixer launcher', () => {
  it('creates a normal 3x2 button carrying only the phone-local action', () => {
    const button = createMixerLauncher(6)

    expect(button.slot).toBe(6)
    expect(button.label).toBe(MIXER_LAUNCHER_LABEL)
    expect(button.sublabel).toBe(MIXER_LAUNCHER_SUBLABEL)
    expect(button.icon).toBe(MIXER_LAUNCHER_ICON)
    expect(button.span).toEqual(DEFAULT_MIXER_SPAN)
    expect(button.control).toBeUndefined()
    expect(button.actions).toHaveLength(1)
    expect(button.actions[0]).toEqual({ type: 'mixer', action: 'open' })
  })

  it('accepts an explicit span for a 2x2 or 1x1 fallback', () => {
    expect(createMixerLauncher(0, { columns: 2, rows: 2 }).span).toEqual({
      columns: 2,
      rows: 2,
    })
    expect(createMixerLauncher(0, { columns: 1, rows: 1 }).span).toEqual({
      columns: 1,
      rows: 1,
    })
  })

  it('prefers 3x2, offers 2x2, then falls back to 1x1', () => {
    expect(mixerSpanCandidates()).toEqual([
      { columns: 3, rows: 2 },
      { columns: 2, rows: 2 },
      { columns: 1, rows: 1 },
    ])
  })

  it('describes the phone-only action without host execution', () => {
    expect(MIXER_ACTION_TITLE).toBe('Open mixer')
    expect(MIXER_ACTION_SUMMARY).toBe('Full-screen per-app mixer')
    expect(MIXER_ACTION_BODY).toContain('Opens the full-screen per-app mixer on the phone')
    expect(MIXER_ACTION_BODY).toContain('nothing runs on this PC')
    expect(MIXER_BADGE).toBe('MIXER')
    expect(mixerAction()).toEqual({ type: 'mixer', action: 'open' })
  })

  it('detects mixer actions in mixed action lists', () => {
    const hotkey: Action = { type: 'hotkey', keys: ['CTRL', 'C'] }
    const mixer: ConfigAction = { type: 'mixer', action: 'open' }

    expect(isMixerAction(mixer)).toBe(true)
    expect(isMixerAction(hotkey)).toBe(false)
    expect(hasMixerAction([hotkey, mixer])).toBe(true)
    expect(hasMixerAction([hotkey])).toBe(false)
  })

  it('only treats a control-free button with a single mixer action as a launcher', () => {
    const button = createMixerLauncher(0)
    expect(hasMixerLauncher(button)).toBe(true)
    expect(
      hasMixerLauncher({
        actions: [...button.actions, { type: 'hotkey', keys: ['CTRL', 'C'] }],
      }),
    ).toBe(false)
    expect(
      hasMixerLauncher({
        actions: button.actions,
        control: {
          kind: 'trackpad',
          emit: 'delta',
          binding: { type: 'pointer' },
        },
      }),
    ).toBe(false)
  })

  it('only hints when the desktop mixer is unavailable', () => {
    expect(mixerSupportNote(true)).toBeNull()
    expect(mixerSupportNote(true, 'ignored')).toBeNull()
    expect(mixerSupportNote(false, 'Per-app audio needs the Windows helper.')).toContain(
      'Per-app audio needs the Windows helper',
    )
    expect(mixerSupportNote(false)).toContain(MIXER_UNSUPPORTED_FALLBACK)
  })
})
