import { describe, expect, it } from 'vitest'
import { ControlSpecSchema } from '@phonedek/shared'
import {
  MEDIA_PREVIEW_DURATION_MS,
  MEDIA_SCRUB_SPANS,
  formatMediaTime,
  mediaScrubControl,
} from '../src/renderer/src/lib/media'

describe('media scrub editor model', () => {
  it('uses the committed media position shape', () => {
    expect(mediaScrubControl()).toEqual({
      kind: 'slider',
      axis: 'horizontal',
      emit: 'value',
      binding: { type: 'media', target: 'position' },
      min: 0,
      max: 1,
      step: 0.001,
      initial: 0,
      commit: 'end',
      display: 'time',
      haptics: true,
    })
  })

  it('passes the shared control schema', () => {
    expect(ControlSpecSchema.safeParse(mediaScrubControl()).success).toBe(true)
  })

  it('prefers 4x1, then 3x1, then 1x1', () => {
    expect(MEDIA_SCRUB_SPANS).toEqual([
      { columns: 4, rows: 1 },
      { columns: 3, rows: 1 },
      { columns: 1, rows: 1 },
    ])
  })
})

describe('formatMediaTime', () => {
  it('formats the editor placeholders', () => {
    expect(formatMediaTime(0)).toBe('0:00')
    expect(formatMediaTime(MEDIA_PREVIEW_DURATION_MS)).toBe('3:45')
  })

  it('pads seconds and adds hours for long media', () => {
    expect(formatMediaTime(83_000)).toBe('1:23')
    expect(formatMediaTime(3_723_000)).toBe('1:02:03')
  })

  it('clamps nonsense to zero', () => {
    expect(formatMediaTime(-500)).toBe('0:00')
    expect(formatMediaTime(Number.NaN)).toBe('0:00')
  })
})
