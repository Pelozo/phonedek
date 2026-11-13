import { describe, expect, it } from 'vitest'
import type { SliderOrDialControlSpec } from '@phonedek/shared'
import { controlBadge } from '../src/renderer/src/components/ControlPreview'

function control(binding: SliderOrDialControlSpec['binding']): SliderOrDialControlSpec {
  return { kind: 'slider', emit: 'value', binding }
}

describe('controlBadge', () => {
  it('labels absolute and relative volume', () => {
    expect(controlBadge(control({ type: 'volume', mode: 'absolute' }))).toBe('VOL · ABS')
    expect(controlBadge(control({ type: 'volume', mode: 'relative' }))).toBe('VOL · REL')
  })

  it('labels scroll', () => {
    expect(controlBadge(control({ type: 'scroll', axis: 'vertical' }))).toBe('SCROLL')
  })

  it('labels mic gain', () => {
    expect(controlBadge(control({ type: 'mic', mode: 'gain' }))).toBe('MIC · GAIN')
  })

  it('labels OBS input volume', () => {
    expect(controlBadge(control({ type: 'obs', target: 'inputVolume', input: 'Mic/Aux' }))).toBe(
      'OBS · VOL',
    )
  })

  it('labels shortcut chords', () => {
    expect(controlBadge(control({ type: 'shortcut', keys: ['CTRL', 'TAB'] }))).toBe('SHORTCUT')
  })
})
