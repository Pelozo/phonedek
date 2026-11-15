import { describe, expect, it } from 'vitest'
import type { ScrollBinding } from '@phonedek/shared'
import { controlBadge } from '../src/renderer/src/components/ControlPreview'
import {
  SCROLL_MODIFIERS,
  SCROLL_PRESETS,
  isScrollControlKind,
  scrollBadge,
  scrollControlKind,
  scrollPreset,
  scrollPresetControl,
  scrollPresetForKind,
  scrollSummary,
  toggleScrollModifier,
} from '../src/renderer/src/lib/scroll'

const vertical: ScrollBinding = { type: 'scroll', axis: 'vertical' }

describe('scroll badges and summaries', () => {
  it('labels zoom, horizontal and plain scroll', () => {
    expect(scrollBadge(vertical)).toBe('SCROLL')
    expect(scrollBadge({ type: 'scroll', axis: 'horizontal' })).toBe('SCROLL H')
    expect(scrollBadge({ ...vertical, modifiers: ['CTRL'] })).toBe('ZOOM')
    expect(scrollBadge({ ...vertical, modifiers: ['SHIFT'] })).toBe('SCROLL H · SHIFT')
    expect(scrollBadge({ type: 'scroll', axis: 'horizontal', modifiers: ['ALT'] })).toBe(
      'SCROLL H · ALT',
    )
  })

  it('feeds the shared control preview badge', () => {
    expect(controlBadge({ kind: 'dial', emit: 'delta', binding: vertical })).toBe('SCROLL')
    expect(
      controlBadge({
        kind: 'dial',
        emit: 'delta',
        binding: { type: 'scroll', axis: 'vertical', modifiers: ['CTRL'] },
      }),
    ).toBe('ZOOM')
    expect(
      controlBadge({ kind: 'dial', emit: 'delta', binding: { type: 'scroll', axis: 'horizontal' } }),
    ).toBe('SCROLL H')
  })

  it('summarizes held modifiers and direction', () => {
    expect(scrollSummary(vertical, 'win32')).toBe('Vertical wheel · natural')
    expect(scrollSummary({ ...vertical, modifiers: ['CTRL'] }, 'win32')).toBe(
      'Ctrl+wheel · Vertical · natural',
    )
    expect(
      scrollSummary({ ...vertical, modifiers: ['SHIFT'], invert: true }, 'darwin'),
    ).toBe('⇧+wheel · Horizontal · inverted')
  })
})

describe('scroll presets', () => {
  it('ships vertical, horizontal, zoom and shift presets', () => {
    expect(SCROLL_PRESETS.map((preset) => preset.id)).toEqual([
      'vertical',
      'horizontal',
      'zoom',
      'shift-horizontal',
    ])
    expect(
      SCROLL_PRESETS.filter((preset) => preset.section === 'View').map((preset) => preset.id),
    ).toEqual(['horizontal', 'zoom', 'shift-horizontal'])
  })

  it('maps bindings to the right axis and modifiers', () => {
    expect(scrollPreset('vertical').binding()).toEqual({ type: 'scroll', axis: 'vertical' })
    expect(scrollPreset('horizontal').binding()).toEqual({
      type: 'scroll',
      axis: 'horizontal',
    })
    expect(scrollPreset('zoom').binding()).toEqual({
      type: 'scroll',
      axis: 'vertical',
      modifiers: ['CTRL'],
    })
    expect(scrollPreset('shift-horizontal').binding()).toEqual({
      type: 'scroll',
      axis: 'vertical',
      modifiers: ['SHIFT'],
    })
  })

  it('builds silent 2×1 dial controls', () => {
    const control = scrollPresetControl(scrollPreset('zoom'))
    expect(control).toMatchObject({
      kind: 'dial',
      emit: 'delta',
      step: 1,
      haptics: true,
      binding: { type: 'scroll', axis: 'vertical', modifiers: ['CTRL'] },
    })
    expect(scrollPreset('zoom').description).toMatch(/Ctrl \+ wheel/)
  })

  it('maps menu kinds both ways', () => {
    expect(scrollControlKind('horizontal')).toBe('scroll-horizontal')
    expect(scrollControlKind('zoom')).toBe('scroll-zoom')
    expect(scrollControlKind('shift-horizontal')).toBe('scroll-shift')
    expect(scrollControlKind('vertical')).toBe('scroll')
    expect(scrollPresetForKind('scroll-horizontal').id).toBe('horizontal')
    expect(scrollPresetForKind('scroll-zoom').id).toBe('zoom')
    expect(scrollPresetForKind('scroll-shift').id).toBe('shift-horizontal')
    expect(isScrollControlKind('scroll-zoom')).toBe(true)
    expect(isScrollControlKind('volume')).toBe(false)
  })
})

describe('scroll modifier checkbox helper', () => {
  it('keeps canonical modifier order and removes empty lists', () => {
    expect(toggleScrollModifier(undefined, 'SHIFT')).toEqual(['SHIFT'])
    expect(toggleScrollModifier(['SHIFT'], 'CTRL')).toEqual(['CTRL', 'SHIFT'])
    expect(toggleScrollModifier(['CTRL', 'SHIFT'], 'CTRL')).toEqual(['SHIFT'])
    expect(toggleScrollModifier(['CTRL'], 'CTRL')).toBeUndefined()
    expect(SCROLL_MODIFIERS).toEqual(['CTRL', 'SHIFT', 'ALT', 'WIN'])
  })
})
