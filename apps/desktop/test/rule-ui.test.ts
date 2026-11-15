import { describe, expect, it } from 'vitest'
import {
  createDefaultConfig,
  DeckConfigSchema,
  eventRuleSchema,
  RULE_COOLDOWN_DEFAULT_MS,
  RULE_DEBOUNCE_DEFAULT_MS,
  RULE_MAX_ACTIONS,
  RULE_MAX_CONDITIONS,
  ruleTriggerKey,
} from '@phonedek/shared'
import type { DeckConfig, EventRule, RigPreset, RuleAction, RuleHistoryEntry } from '@phonedek/shared'
import type { RulePreviewView, RuleSourceView, RuleStatusView } from '../src/shared/api'
import {
  defaultRule,
  enabledRuleCount,
  isBooleanTrigger,
  liveSourceCount,
  moveRuleAction,
  nextRuleId,
  processMatchHint,
  removeRuleFromConfig,
  removeRuleReferences,
  ruleActionFromKind,
  ruleActionLabel,
  ruleActionTarget,
  RULE_TRIGGER_OPTIONS,
  ruleDraftErrors,
  ruleEdgeKey,
  ruleHistoryDetail,
  ruleHistorySummary,
  ruleOutcomeLabel,
  rulePreviewText,
  ruleReferenceIssues,
  RULE_TEMPLATE_ORDER,
  ruleTemplate,
  ruleRunStatusLabel,
  ruleRunStatusTone,
  rulesOf,
  ruleSidebarSummary,
  ruleSourceTone,
  ruleStatusText,
  ruleTriggerLabel,
  ruleTriggerOptionsFor,
  triggerFromOption,
  triggerOptionId,
  triggerSourceName,
  upsertRule,
} from '../src/renderer/src/lib/rules'

function rig(id: string, patch: Partial<RigPreset> = {}): RigPreset {
  return {
    id,
    name: id === 'go-live' ? 'Go live' : `Rig ${id}`,
    steps: [{ label: 'Go live', action: { type: 'obs', action: 'startStream' } }],
    ...patch,
  }
}

function config(patch: Partial<DeckConfig> = {}): DeckConfig {
  return { ...createDefaultConfig(), rigs: [rig('go-live')], ...patch }
}

function rule(patch: Partial<EventRule> = {}): EventRule {
  return {
    id: 'rule-1',
    name: 'Stream started',
    enabled: true,
    trigger: { kind: 'obs.streaming', active: true },
    actions: [{ kind: 'showProfile', profileId: createDefaultConfig().defaultProfileId }],
    ...patch,
  }
}

function status(patch: Partial<RuleStatusView> = {}): RuleStatusView {
  return { ruleId: 'rule-1', enabled: true, detail: 'ARMED', ...patch }
}

function preview(patch: Partial<RulePreviewView> = {}): RulePreviewView {
  return { ruleId: 'rule-1', ok: true, wouldRun: true, blocked: [], missing: [], ...patch }
}

function history(patch: Partial<RuleHistoryEntry> = {}): RuleHistoryEntry {
  return {
    seq: 1,
    ruleId: 'rule-1',
    ruleName: 'Stream started',
    at: 1_700_000_000_000,
    trigger: 'OBS stream started',
    status: 'ok',
    durationMs: 3_200,
    source: 'event',
    actions: [],
    ...patch,
  }
}

describe('rule config helpers', () => {
  it('tolerates configurations that predate rules', () => {
    expect(rulesOf({})).toEqual([])
    expect(rulesOf(undefined)).toEqual([])
    expect(rulesOf({ rules: [rule()] })).toHaveLength(1)
  })

  it('reuses free rule ids and never duplicates an existing one', () => {
    expect(nextRuleId([])).toBe('rule-1')
    expect(nextRuleId([rule({ id: 'rule-1' }), rule({ id: 'rule-3' })])).toBe('rule-2')
    expect(nextRuleId([rule({ id: 'rule-2' })])).toBe('rule-1')
  })

  it('upserts and removes rules without touching the rest of the deck', () => {
    const base = config()
    const first = rule()
    const added = upsertRule(base, first)
    expect(added.rules).toEqual([first])

    const renamed = { ...first, name: 'Renamed' }
    const updated = upsertRule(added, renamed)
    expect(updated.rules).toHaveLength(1)
    expect(updated.rules?.[0]?.name).toBe('Renamed')

    const removed = removeRuleFromConfig(updated, first.id)
    expect(removed.rules).toEqual([])
    expect(removed.profiles).toEqual(base.profiles)
    expect(removed.rigs).toEqual(base.rigs)
  })

  it('counts enabled rules and summarizes the sidebar row', () => {
    const rules = [rule(), rule({ id: 'rule-2', enabled: false }), rule({ id: 'rule-3' })]
    const sources: RuleSourceView[] = [
      { name: 'obs', label: 'OBS', available: true, detail: 'CONNECTED' },
      { name: 'twitch', label: 'Twitch', available: false, detail: 'OFFLINE' },
      { name: 'phone', label: 'Phone', available: true, detail: '2 PHONES' },
    ]
    expect(enabledRuleCount(rules)).toBe(2)
    expect(liveSourceCount(sources)).toBe(2)
    expect(
      liveSourceCount([
        { name: 'phone', label: 'Phone', available: true, detail: '0 PHONES' },
      ]),
    ).toBe(0)
    expect(ruleSidebarSummary(rules, sources)).toBe('3 rules · 2 live')
    expect(ruleSidebarSummary([rule()], [])).toBe('1 rule · 0 live')
  })

  it('removes deleted rig/profile/page references and drops empty rules', () => {
    const base = config()
    const profileId = base.defaultProfileId
    const pageId = base.profiles[0]!.pages[0]!.id
    const withRules: DeckConfig = {
      ...base,
      rules: [
        rule({ id: 'a', actions: [{ kind: 'runRig', presetId: 'go-live' }] }),
        rule({
          id: 'b',
          actions: [
            { kind: 'runRig', presetId: 'go-live' },
            { kind: 'showProfile', profileId },
          ],
        }),
        rule({ id: 'c', actions: [{ kind: 'showPage', profileId, pageId }] }),
        rule({ id: 'd', actions: [{ kind: 'showProfile', profileId }] }),
      ],
    }

    const noRig = removeRuleReferences(withRules, { kind: 'rig', rigId: 'go-live' })
    expect(noRig.rules?.map((entry) => entry.id)).toEqual(['b', 'c', 'd'])
    expect(noRig.rules?.find((entry) => entry.id === 'b')?.actions).toEqual([
      { kind: 'showProfile', profileId },
    ])
    expect(DeckConfigSchema.safeParse(noRig).success).toBe(true)

    const noPage = removeRuleReferences(noRig, { kind: 'page', profileId, pageId })
    expect(noPage.rules?.map((entry) => entry.id)).toEqual(['b', 'd'])
    expect(DeckConfigSchema.safeParse(noPage).success).toBe(true)

    const noProfile = removeRuleReferences(noPage, { kind: 'profile', profileId })
    expect(noProfile.rules).toBeUndefined()
    expect(DeckConfigSchema.safeParse(noProfile).success).toBe(true)
  })
})

describe('trigger picker', () => {
  it('round-trips every trigger option through a complete trigger', () => {
    for (const option of RULE_TRIGGER_OPTIONS) {
      const trigger = triggerFromOption(option.id)
      expect(trigger.kind).toBe(option.kind)
      expect(triggerOptionId(trigger)).toBe(option.id)
    }
    expect(ruleTriggerOptionsFor().map((option) => option.id)).toContain('process.started')
  })

  it('keeps scene and process names when switching between their arms', () => {
    const scene = triggerFromOption('obs.scene', { kind: 'obs.scene', scene: 'Gameplay' })
    expect(scene).toEqual({ kind: 'obs.scene', scene: 'Gameplay' })

    const switched = triggerFromOption('process.stopped', {
      kind: 'process.started',
      process: 'game.exe',
    })
    expect(switched).toEqual({ kind: 'process.stopped', process: 'game.exe' })

    const fresh = triggerFromOption('process.started', { kind: 'obs.streaming', active: true })
    expect(fresh).toEqual({ kind: 'process.started', process: 'game' })
  })

  it('labels sources, edges and boolean/name arms', () => {
    expect(ruleTriggerLabel({ kind: 'obs.streaming', active: true })).toBe('OBS stream started')
    expect(ruleTriggerLabel({ kind: 'process.started', process: 'game' })).toBe(
      'Process started (game)',
    )
    expect(triggerSourceName({ kind: 'twitch.live', active: false })).toBe('TWITCH')
    expect(triggerSourceName({ kind: 'phone.connected' })).toBe('PHONE')
    expect(isBooleanTrigger({ kind: 'obs.scene', scene: 'Gameplay' })).toBe(false)
    expect(isBooleanTrigger({ kind: 'obs.recording', active: false })).toBe(true)
    expect(ruleEdgeKey({ kind: 'phone.connected' })).toBe('phone.present')
    expect(ruleEdgeKey({ kind: 'obs.streaming', active: true })).toBe(ruleTriggerKey({ kind: 'obs.streaming', active: true }))
  })

  it('normalizes process names and explains the saved match', () => {
    expect(processMatchHint('C:\\Games\\Game.EXE')).toBe(
      'Saved as “game” · .exe and case are ignored.',
    )
    expect(processMatchHint('game')).toBe('Matches “game” (case-insensitive).')
    expect(processMatchHint('   ')).toContain('Enter an executable')
  })
})

describe('rule validation and templates', () => {
  it('accepts the blank rule and every template as schema-valid', () => {
    const cfg = config()
    expect(ruleDraftErrors(defaultRule('rule-1', cfg))).toEqual([])
    expect(eventRuleSchema.safeParse(defaultRule('rule-1', cfg)).success).toBe(true)
    for (const kind of RULE_TEMPLATE_ORDER) {
      const template = ruleTemplate(kind, 'rule-1', cfg)
      expect(ruleDraftErrors(template)).toEqual([])
      expect(eventRuleSchema.safeParse(template).success).toBe(true)
      expect(template.actions).toHaveLength(1)
    }
    expect(ruleTemplate('game-launched', 'rule-9', cfg).trigger).toEqual({
      kind: 'process.started',
      process: 'game',
    })
  })

  it('reports identity, action and condition limits', () => {
    expect(ruleDraftErrors(rule({ name: '   ' }))).toContain('Name is required.')
    expect(ruleDraftErrors(rule({ actions: [] }))).toContain('A rule needs at least one action.')
    expect(
      ruleDraftErrors(
        rule({
          actions: Array.from(
            { length: RULE_MAX_ACTIONS + 1 },
            (): RuleAction => ({ kind: 'showProfile', profileId: 'home' }),
          ),
        }),
      ),
    ).toContain(`A rule accepts at most ${RULE_MAX_ACTIONS} actions.`)
    expect(
      ruleDraftErrors(
        rule({
          conditions: Array.from({ length: RULE_MAX_CONDITIONS + 1 }, () => ({
            probe: 'obsStreaming' as const,
          })),
        }),
      ),
    ).toContain(`A rule accepts at most ${RULE_MAX_CONDITIONS} conditions.`)
    expect(ruleDraftErrors(rule({ debounceMs: -1 }))).toContain('Debounce must be 0–30000 ms.')
    expect(ruleDraftErrors(rule({ cooldownMs: 3_600_001 }))).toContain(
      'Cooldown must be 0–3600000 ms.',
    )
    expect(ruleDraftErrors(rule(), [rule()])).toContain('Another rule already uses this id.')
  })

  it('validates scene and process trigger text', () => {
    expect(ruleDraftErrors(rule({ trigger: { kind: 'obs.scene', scene: '  ' } }))).toContain(
      'Scene name is required.',
    )
    expect(
      ruleDraftErrors(rule({ trigger: { kind: 'process.started', process: '' } })),
    ).toContain('Process name is required.')
    expect(
      ruleDraftErrors(rule({ trigger: { kind: 'process.started', process: 'C:\\game.exe' } })),
    ).toContain('Process names cannot contain slashes or control characters.')
    expect(
      ruleDraftErrors(rule({ trigger: { kind: 'process.started', process: 'Game.EXE' } })),
    ).toEqual([])
  })

  it('creates complete, valid actions when switching row kind', () => {
    const cfg = config()
    const profile = cfg.defaultProfileId
    expect(ruleActionFromKind('runRig', { kind: 'showProfile', profileId: profile }, cfg)).toEqual({
      kind: 'runRig',
      presetId: 'go-live',
    })
    const page = ruleActionFromKind(
      'showPage',
      { kind: 'showProfile', profileId: profile },
      cfg,
    )
    expect(page.kind).toBe('showPage')
    if (page.kind === 'showPage') {
      expect(page.profileId).toBe(profile)
      expect(page.pageId).toBe(cfg.profiles[0]!.pages[0]!.id)
    }
    expect(
      ruleActionFromKind('showProfile', { kind: 'showPage', profileId: profile, pageId: 'x' }, cfg),
    ).toEqual({ kind: 'showProfile', profileId: profile })
  })

  it('moves actions in order and clamps at the edges', () => {
    const actions: RuleAction[] = [
      { kind: 'showProfile', profileId: 'a' },
      { kind: 'showProfile', profileId: 'b' },
      { kind: 'showProfile', profileId: 'c' },
    ]
    expect(moveRuleAction(actions, 0, 1).map((action) => (action as { profileId: string }).profileId)).toEqual(['b', 'a', 'c'])
    expect(moveRuleAction(actions, 2, 1)).toEqual(actions)
    expect(moveRuleAction(actions, 0, -1)).toEqual(actions)
  })
})

describe('action labels and references', () => {
  it('resolves action targets and labels against the config', () => {
    const cfg = config()
    const profileId = cfg.defaultProfileId
    expect(ruleActionLabel({ kind: 'runRig', presetId: 'go-live' }, cfg)).toBe(
      'Run rig "Go live"',
    )
    expect(ruleActionTarget({ kind: 'runRig', presetId: 'go-live' }, cfg)).toEqual({
      text: 'Go live',
      missing: false,
    })
    expect(ruleActionTarget({ kind: 'showProfile', profileId }, cfg)).toEqual({
      text: cfg.profiles[0]!.name,
      missing: false,
    })
    expect(
      ruleActionTarget({ kind: 'showProfile', profileId: 'deleted' }, cfg),
    ).toEqual({ text: 'Missing profile “deleted”', missing: true })
  })

  it('flags dangling rig, profile and page references', () => {
    const cfg = config()
    const missing = rule({
      actions: [
        { kind: 'runRig', presetId: 'deleted-rig' },
        { kind: 'showProfile', profileId: 'deleted-profile' },
        { kind: 'showPage', profileId: cfg.defaultProfileId, pageId: 'deleted-page' },
      ],
    })
    const issues = ruleReferenceIssues(missing, cfg)
    expect(issues.map((issue) => issue.kind)).toEqual(['rig', 'profile', 'page'])
    expect(issues.map((issue) => issue.actionIndex)).toEqual([0, 1, 2])
    expect(issues[0]?.message).toContain('deleted-rig')
  })

  it('returns no issue for every resolved reference', () => {
    const cfg = config()
    const profile = cfg.profiles[0]!
    const page = profile.pages[0]!
    expect(
      ruleReferenceIssues(
        rule({
          actions: [
            { kind: 'runRig', presetId: 'go-live' },
            { kind: 'showProfile', profileId: profile.id },
            { kind: 'showPage', profileId: profile.id, pageId: page.id },
          ],
        }),
        cfg,
      ),
    ).toEqual([])
  })
})

describe('live status, preview and history', () => {
  it('maps the service status token and last-run age to a tone', () => {
    const now = 1_700_000_000_000
    expect(ruleStatusText(null, true)).toMatchObject({
      label: 'READY',
      tone: 'muted',
      age: 'NEVER',
    })
    expect(ruleStatusText(null, false).label).toBe('DISARMED')
    expect(ruleStatusText(status({ detail: 'ARMED' }), true)).toMatchObject({
      label: 'ARMED',
      tone: 'ok',
    })
    expect(ruleStatusText(status({ detail: 'PAUSED' })).tone).toBe('muted')
    expect(ruleStatusText(status({ detail: 'RUNNING' })).tone).toBe('live')
    expect(ruleStatusText(status({ detail: 'COOLDOWN' })).tone).toBe('warn')
    expect(ruleStatusText(status({ detail: 'ERROR' })).tone).toBe('error')
    expect(
      ruleStatusText(status({ detail: 'ERROR', lastAt: now - 120_000 }), true, now).age,
    ).toBe('2m')
    expect(ruleStatusText(status({ detail: 'DISARMED' }), false).label).toBe('DISARMED')
  })

  it('describes every dry-run verdict without executing anything', () => {
    expect(rulePreviewText(preview())).toMatchObject({ label: 'WOULD RUN', tone: 'ok' })
    expect(
      rulePreviewText(
        preview({
          ok: false,
          wouldRun: false,
          blocked: [
            {
              probe: 'obsStreaming',
              label: 'OBS streaming',
              expect: true,
              actual: false,
              ok: false,
              available: true,
            },
          ],
        }),
      ).label,
    ).toBe('BLOCKED')
    expect(
      rulePreviewText(preview({ ok: false, wouldRun: false, missing: ['Rig go-live'] })).label,
    ).toBe('MISSING')
    expect(
      rulePreviewText(preview({ ok: false, wouldRun: false, reason: 'cooldown' })),
    ).toMatchObject({ label: 'WOULD SKIP', tone: 'warn' })
    expect(
      rulePreviewText(preview({ ok: false, wouldRun: false, reason: 'disabled' })).label,
    ).toBe('DISABLED')
    expect(
      rulePreviewText(preview({ ok: false, wouldRun: false, error: 'engine disposed' })).label,
    ).toBe('ERROR')
  })

  it('formats history status, detail, duration and outcomes', () => {
    expect(ruleRunStatusTone('ok')).toBe('ok')
    expect(ruleRunStatusTone('blocked')).toBe('warn')
    expect(ruleRunStatusTone('missing')).toBe('error')
    expect(ruleRunStatusTone('busy')).toBe('live')
    expect(ruleRunStatusLabel('partial')).toBe('PARTIAL')
    expect(ruleHistoryDetail(history())).toBe('0 actions completed.')
    expect(
      ruleHistoryDetail(
        history({
          status: 'partial',
          actions: [{ kind: 'runRig', ok: false, target: 'Go live', message: 'Busy' }],
        }),
      ),
    ).toBe('Busy')
    expect(ruleHistorySummary(history({ actions: [{ kind: 'runRig', ok: true }] }))).toBe(
      '1 action',
    )
    expect(
      ruleHistorySummary(
        history({
          actions: [
            { kind: 'runRig', ok: false },
            { kind: 'showProfile', ok: true },
          ],
        }),
      ),
    ).toBe('2 actions · 1 failed')
    expect(ruleOutcomeLabel({ kind: 'showProfile', ok: true, target: 'Streaming' })).toBe(
      'OK · Streaming',
    )
  })

  it('tones source rows and emits a compact source summary', () => {
    expect(
      ruleSourceTone({ name: 'obs', label: 'OBS', available: true, detail: 'CONNECTED' }),
    ).toBe('ok')
    expect(
      ruleSourceTone({ name: 'obs', label: 'OBS', available: false, detail: 'OFFLINE' }),
    ).toBe('muted')
    expect(
      ruleSourceTone({ name: 'phone', label: 'Phone', available: true, detail: '0 PHONES' }),
    ).toBe('muted')
    expect(
      ruleSourceTone({ name: 'phone', label: 'Phone', available: true, detail: '1 PHONE' }),
    ).toBe('ok')
    expect(RULE_COOLDOWN_DEFAULT_MS).toBe(10_000)
    expect(RULE_DEBOUNCE_DEFAULT_MS).toBe(1_500)
  })
})
