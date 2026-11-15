import { describe, expect, it } from 'vitest'
import type { AutoProfileRuleView } from '../src/shared/api'
import {
  AUTO_PROFILE_REVERT_DELAY_SECONDS,
  MAX_AUTO_PROFILE_RULES,
  autoProfileDraftsDirty,
  autoProfileProcessError,
  autoProfileProfileError,
  autoProfileProfileName,
  autoProfileRevertHint,
  autoProfileRevertProfileError,
  autoProfileRuleErrors,
  autoProfileRulesFromDrafts,
  nextAutoProfileRuleId,
  normalizeAutoProfileProcess,
  toAutoProfileDrafts,
  type AutoProfileDraft,
} from '../src/renderer/src/lib/autoProfile'

const rules: AutoProfileRuleView[] = [
  { id: 'rule-1', process: 'game', profileId: 'profile-a' },
  { id: 'rule-2', process: 'chrome', profileId: 'profile-b' },
]

const profiles = [
  { id: 'profile-a', name: 'Gaming' },
  { id: 'profile-b', name: 'Browsing' },
]

describe('auto-profile process matching', () => {
  it('reduces Windows paths, .exe and case to the process basename', () => {
    expect(normalizeAutoProfileProcess('C:\\Games\\Game\\Game.EXE')).toBe('game')
    expect(normalizeAutoProfileProcess('  GAME.exe  ')).toBe('game')
    expect(normalizeAutoProfileProcess('C:/Program Files/Chrome/chrome.exe')).toBe('chrome')
    expect(normalizeAutoProfileProcess('/usr/bin/obs')).toBe('obs')
    expect(normalizeAutoProfileProcess('chrome')).toBe('chrome')
  })

  it('rejects empty, folder-only, oversized and control-character values', () => {
    expect(normalizeAutoProfileProcess('')).toBeNull()
    expect(normalizeAutoProfileProcess('   ')).toBeNull()
    expect(normalizeAutoProfileProcess('C:\\Games\\')).toBeNull()
    expect(normalizeAutoProfileProcess('bad\u0000name')).toBeNull()
    expect(normalizeAutoProfileProcess('a'.repeat(161))).toBeNull()
  })

  it('explains how to fix an invalid process field', () => {
    expect(autoProfileProcessError('')).toContain('Enter a process')
    expect(autoProfileProcessError('C:\\Games\\')).toContain('file name or path')
    expect(autoProfileProcessError('bad\u0000name')).toContain('control characters')
    expect(autoProfileProcessError('C:\\Games\\Game.exe')).toBeNull()
  })
})

describe('auto-profile rule drafts', () => {
  it('validates the chosen profile against the current deck', () => {
    expect(autoProfileProfileError('', profiles)).toBe('Choose a profile.')
    expect(autoProfileProfileError('profile-gone', profiles)).toContain('no longer exists')
    expect(autoProfileProfileError('profile-a', profiles)).toBeNull()
  })

  it('returns both field errors for one row', () => {
    const draft: AutoProfileDraft = { id: 'rule-1', process: '', profileId: 'missing' }
    expect(autoProfileRuleErrors(draft, profiles)).toEqual({
      process: 'Enter a process or executable name.',
      profile: 'This profile no longer exists. Choose another.',
    })
    expect(
      autoProfileRuleErrors({ id: 'rule-1', process: 'game.exe', profileId: 'profile-a' }, profiles),
    ).toEqual({ process: null, profile: null })
  })

  it('tracks dirty drafts without treating whitespace as a change', () => {
    const drafts = toAutoProfileDrafts(rules)
    expect(autoProfileDraftsDirty(drafts, rules)).toBe(false)
    expect(
      autoProfileDraftsDirty(
        drafts.map((draft) => ({ ...draft, process: `  ${draft.process} ` })),
        rules,
      ),
    ).toBe(false)
    expect(
      autoProfileDraftsDirty(
        drafts.map((draft, index) =>
          index === 0 ? { ...draft, process: 'C:\\Games\\Game.exe' } : draft,
        ),
        rules,
      ),
    ).toBe(true)
    expect(
      autoProfileDraftsDirty(
        drafts.map((draft, index) =>
          index === 0 ? { ...draft, profileId: 'profile-b' } : draft,
        ),
        rules,
      ),
    ).toBe(true)
    expect(autoProfileDraftsDirty([...drafts, { id: 'rule-3', process: '', profileId: 'profile-a' }], rules)).toBe(true)
  })

  it('assigns a fresh rule id and copies rules into drafts', () => {
    expect(nextAutoProfileRuleId([])).toBe('rule-1')
    expect(nextAutoProfileRuleId(rules)).toBe('rule-3')
    expect(nextAutoProfileRuleId([{ id: 'rule-2' }])).toBe('rule-1')

    const drafts = toAutoProfileDrafts(rules)
    drafts[0]!.process = 'changed'
    expect(rules[0]!.process).toBe('game')
  })

  it('trims raw draft fields for the API and keeps the 16-rule limit visible', () => {
    expect(
      autoProfileRulesFromDrafts([
        { id: 'rule-1', process: ' Game.exe ', profileId: ' profile-a ' },
      ]),
    ).toEqual([{ id: 'rule-1', process: 'Game.exe', profileId: 'profile-a' }])
    expect(MAX_AUTO_PROFILE_RULES).toBe(16)
  })

  it('names a profile and falls back to the id for a stale rule', () => {
    expect(autoProfileProfileName('profile-a', profiles)).toBe('Gaming')
    expect(autoProfileProfileName('profile-gone', profiles)).toBe('profile-gone')
    expect(autoProfileProfileName('', profiles)).toBe('No profile selected')
  })
})

describe('auto-profile return profile', () => {
  it('validates the return target against the current deck', () => {
    expect(autoProfileRevertProfileError('', profiles)).toContain('Choose a profile')
    expect(autoProfileRevertProfileError('profile-gone', profiles)).toContain('no longer exists')
    expect(autoProfileRevertProfileError('profile-a', profiles)).toBeNull()
  })

  it('summarizes the off, unset and configured states', () => {
    expect(autoProfileRevertHint(false, 'profile-a', profiles)).toContain('Off.')
    expect(autoProfileRevertHint(true, '', profiles)).toContain('Choose the profile')
    const hint = autoProfileRevertHint(true, 'profile-a', profiles)
    expect(hint).toContain('Gaming')
    expect(hint).toContain(`${AUTO_PROFILE_REVERT_DELAY_SECONDS} seconds`)
    expect(hint).toContain('another mapped game')
    expect(AUTO_PROFILE_REVERT_DELAY_SECONDS).toBe(5)
  })
})
