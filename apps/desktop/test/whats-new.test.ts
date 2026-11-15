import { describe, expect, it } from 'vitest'
import {
  normalizeVersion,
  whatsNewDecision,
  whatsNewFor,
} from '../src/renderer/src/lib/whatsNew'

describe('whatsNewDecision', () => {
  it('treats an empty stored version as a first run', () => {
    expect(whatsNewDecision('', '0.13.1')).toBe('first-run')
    expect(whatsNewDecision(undefined, '0.13.1')).toBe('first-run')
    expect(whatsNewDecision('   ', '0.13.1')).toBe('first-run')
  })

  it('shows the dialog when the running version differs', () => {
    expect(whatsNewDecision('0.13.0', '0.13.1')).toBe('show')
    expect(whatsNewDecision('0.9.0', '0.13.1')).toBe('show')
    expect(whatsNewDecision('0.13.1', '0.14.0')).toBe('show')
  })

  it('stays quiet when the running version was already seen', () => {
    expect(whatsNewDecision('0.13.1', '0.13.1')).toBe('none')
    expect(whatsNewDecision('v0.13.1', '0.13.1')).toBe('none')
    expect(whatsNewDecision(' 0.13.1 ', 'v0.13.1')).toBe('none')
  })

  it('does nothing when the running version is missing', () => {
    expect(whatsNewDecision('', '')).toBe('none')
    expect(whatsNewDecision('0.13.1', '  ')).toBe('none')
  })
})

describe('whatsNewFor', () => {
  it('returns curated copy for the shipped releases', () => {
    for (const version of ['0.15.0', '0.14.0', '0.13.2', '0.13.1', '0.13.0', '0.12.0', '0.11.0', '0.10.0', '0.9.0']) {
      const entry = whatsNewFor(version)
      expect(entry.title.length).toBeGreaterThan(0)
      expect(entry.highlights.length).toBeGreaterThan(0)
    }
  })

  it('matches versions with a leading v', () => {
    expect(whatsNewFor('v0.13.1').title).toBe(whatsNewFor('0.13.1').title)
  })

  it('falls back to fixes and improvements for unknown or older versions', () => {
    for (const version of ['9.9.9', '0.8.0', 'v0.1.0', '']) {
      expect(whatsNewFor(version).title).toBe('Fixes and improvements')
    }
  })

  it('normalizes the shown version', () => {
    expect(normalizeVersion('  v0.13.1 ')).toBe('0.13.1')
    expect(normalizeVersion('0.13.1')).toBe('0.13.1')
  })
})
