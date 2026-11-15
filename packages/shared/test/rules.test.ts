import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/defaults'
import {
  appendRuleHistory,
  describeRuleAction,
  describeTrigger,
  formatRuleDuration,
  hasRuleReference,
  normalizeRuleProcess,
  ruleById,
  ruleHasRoomForAction,
  ruleHasRoomForCondition,
  ruleMatchesTrigger,
  ruleTriggerKey,
  rulesOf,
  rulesUsingPage,
  rulesUsingProfile,
  rulesUsingRig,
} from '../src/rules'
import { parseConfig, validateConfig } from '../src/schema'
import {
  NOTICE_CAPABILITY,
  RULE_COOLDOWN_DEFAULT_MS,
  RULE_COOLDOWN_MAX_MS,
  RULE_DEBOUNCE_DEFAULT_MS,
  RULE_DEBOUNCE_MAX_MS,
  RULE_HISTORY_MAX,
  RULE_MAX_ACTIONS,
  RULE_MAX_CONDITIONS,
  RULE_MAX_FIRES_PER_MINUTE,
  RULE_MAX_NAME,
  RULE_MAX_NOTICE,
  RULE_MAX_PROCESS,
  RULE_MAX_SCENE,
  RULE_PROCESS_EXIT_TICKS,
  RULE_SETTLE_MS,
  RULE_TWITCH_POLL_MS,
  RULES_CAPABILITY,
  RULES_MAX_RULES,
  type DeckConfig,
  type DeckProfile,
  type EventRule,
  type EventTrigger,
  type RuleAction,
  type RuleHistoryEntry,
  type RuleReference,
} from '../src/types'

const PROFILE_ID = 'profile-desktop'
const PAGE_ID = 'page-main'

function makeRule(overrides: Partial<EventRule> = {}): EventRule {
  return {
    id: 'rule-1',
    name: 'Stream started',
    trigger: { kind: 'obs.streaming', active: true },
    actions: [{ kind: 'showProfile', profileId: PROFILE_ID }],
    ...overrides,
  }
}

function configWithRules(rules: EventRule[]): DeckConfig {
  const config = createDefaultConfig()
  config.rules = rules
  return config
}

function errorsOf(config: unknown): string {
  const result = validateConfig(config)
  expect(result.ok).toBe(false)
  return result.ok ? '' : result.errors.join(' ')
}

function expectValid(config: unknown): DeckConfig {
  const result = validateConfig(config)
  expect(result.ok, result.ok ? '' : result.errors.join(' ')).toBe(true)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.config
}

function historyEntry(overrides: Partial<RuleHistoryEntry> = {}): RuleHistoryEntry {
  return {
    seq: 1,
    ruleId: 'rule-1',
    ruleName: 'Stream started',
    at: 1_700_000_000_000,
    trigger: 'OBS stream started',
    status: 'ok',
    durationMs: 1_200,
    source: 'event',
    actions: [{ kind: 'showProfile', ok: true }],
    ...overrides,
  }
}

describe('event rule constants', () => {
  it('matches the automation contract', () => {
    expect(RULES_CAPABILITY).toBe('rules-v1')
    expect(NOTICE_CAPABILITY).toBe('notice-v1')
    expect(RULES_MAX_RULES).toBe(32)
    expect(RULE_MAX_ACTIONS).toBe(4)
    expect(RULE_MAX_CONDITIONS).toBe(4)
    expect(RULE_MAX_NAME).toBe(60)
    expect(RULE_MAX_NOTICE).toBe(80)
    expect(RULE_MAX_SCENE).toBe(120)
    expect(RULE_MAX_PROCESS).toBe(160)
    expect(RULE_DEBOUNCE_DEFAULT_MS).toBe(1_500)
    expect(RULE_DEBOUNCE_MAX_MS).toBe(30_000)
    expect(RULE_COOLDOWN_DEFAULT_MS).toBe(10_000)
    expect(RULE_COOLDOWN_MAX_MS).toBe(3_600_000)
    expect(RULE_SETTLE_MS).toBe(4_000)
    expect(RULE_MAX_FIRES_PER_MINUTE).toBe(12)
    expect(RULE_HISTORY_MAX).toBe(50)
    expect(RULE_TWITCH_POLL_MS).toBe(60_000)
    expect(RULE_PROCESS_EXIT_TICKS).toBe(2)
  })
})

describe('event rule schema', () => {
  it('accepts every trigger kind and reference-only action', () => {
    const config = createDefaultConfig()
    config.rigs = [{ id: 'go-live', name: 'Go live', steps: [{ action: { type: 'hotkey', keys: ['A'] } }] }]
    config.rules = [
      makeRule({ id: 'rule-1', trigger: { kind: 'obs.streaming', active: true } }),
      makeRule({ id: 'rule-2', trigger: { kind: 'obs.recording', active: false } }),
      makeRule({ id: 'rule-3', trigger: { kind: 'obs.replay', active: true } }),
      makeRule({ id: 'rule-4', trigger: { kind: 'twitch.live', active: true } }),
      makeRule({ id: 'rule-5', trigger: { kind: 'obs.scene', scene: 'Gameplay' } }),
      makeRule({ id: 'rule-6', trigger: { kind: 'process.started', process: 'game.exe' } }),
      makeRule({ id: 'rule-7', trigger: { kind: 'process.stopped', process: 'game' } }),
      makeRule({ id: 'rule-8', trigger: { kind: 'phone.connected' } }),
      makeRule({ id: 'rule-9', trigger: { kind: 'phone.disconnected' } }),
      makeRule({
        id: 'rule-10',
        trigger: { kind: 'obs.streaming', active: true },
        conditions: [{ probe: 'micMuted', expect: true }],
        actions: [
          { kind: 'showPage', profileId: PROFILE_ID, pageId: PAGE_ID },
          { kind: 'runRig', presetId: 'go-live' },
          { kind: 'showProfile', profileId: PROFILE_ID },
          { kind: 'notice', text: 'Stream started' },
        ],
        debounceMs: 1_500,
        cooldownMs: 120_000,
        onBusy: 'continue',
      }),
    ]
    expectValid(config)
  })

  it('keeps v1 configs without rules valid and byte-identical on round-trip', () => {
    const config = createDefaultConfig()
    const before = JSON.stringify(config)
    const parsed = parseConfig(config)
    expect(parsed).toEqual(config)
    expect(parsed.rules).toBeUndefined()
    expect(JSON.stringify(parsed)).toBe(before)
    expect(parsed.schemaVersion).toBe(1)
  })

  it('round-trips rules with conditions, timing and every action kind', () => {
    const config = createDefaultConfig()
    config.rigs = [{ id: 'go-live', name: 'Go live', steps: [{ action: { type: 'hotkey', keys: ['A'] } }] }]
    config.rules = [
      {
        id: 'rule-stream',
        name: 'Stream started',
        enabled: false,
        trigger: { kind: 'obs.streaming', active: true },
        conditions: [
          { probe: 'micMuted', expect: true },
          { probe: 'appRunning', arg: 'obs64.exe', label: 'OBS is up' },
        ],
        actions: [
          { kind: 'showProfile', profileId: PROFILE_ID },
          { kind: 'showPage', profileId: PROFILE_ID, pageId: PAGE_ID },
          { kind: 'runRig', presetId: 'go-live' },
          { kind: 'notice', text: 'Stream started' },
        ],
        debounceMs: 2_000,
        cooldownMs: 120_000,
        onBusy: 'continue',
      },
      {
        id: 'rule-scene',
        name: 'Scene changed',
        trigger: { kind: 'obs.scene', scene: 'Gameplay' },
        actions: [{ kind: 'showProfile', profileId: PROFILE_ID }],
      },
    ]
    const parsed = parseConfig(config)
    expect(parsed.rules).toEqual(config.rules)
    expect(parsed).toEqual(config)
  })

  it('enforces the rule count limit', () => {
    const rules = Array.from({ length: RULES_MAX_RULES }, (_, index) =>
      makeRule({ id: `rule-${index}`, name: `Rule ${index}` }),
    )
    expectValid(configWithRules(rules))
    const tooMany = [...rules, makeRule({ id: 'rule-extra', name: 'Extra' })]
    expect(errorsOf(configWithRules(tooMany))).toMatch(/at most 32 rules/i)
  })

  it('enforces the rule name bounds', () => {
    expectValid(configWithRules([makeRule({ name: 'N'.repeat(RULE_MAX_NAME) })]))
    expect(errorsOf(configWithRules([makeRule({ name: 'N'.repeat(RULE_MAX_NAME + 1) })]))).toMatch(/name/i)
    expect(errorsOf(configWithRules([makeRule({ name: '   ' })]))).toMatch(/name cannot be empty/i)
  })

  it('enforces action count and requires at least one action', () => {
    const showProfile: RuleAction = { kind: 'showProfile', profileId: PROFILE_ID }
    const four = Array.from({ length: RULE_MAX_ACTIONS }, () => showProfile)
    expectValid(configWithRules([makeRule({ actions: four })]))
    expect(errorsOf(configWithRules([makeRule({ actions: [...four, showProfile] })]))).toMatch(
      /at most 4 actions/i,
    )
    expect(errorsOf(configWithRules([makeRule({ actions: [] })]))).toMatch(/at least one action/i)
  })

  it('enforces condition count and reuses rig guard validation', () => {
    const condition = { probe: 'micMuted' as const }
    const four = Array.from({ length: RULE_MAX_CONDITIONS }, () => condition)
    expectValid(configWithRules([makeRule({ conditions: four })]))
    expect(errorsOf(configWithRules([makeRule({ conditions: [...four, condition] })]))).toMatch(
      /at most 4 conditions/i,
    )
    expect(errorsOf(configWithRules([makeRule({ conditions: [{ probe: 'appRunning' }] })]))).toMatch(
      /require an application name/i,
    )
  })

  it('enforces debounce and cooldown ranges', () => {
    expectValid(configWithRules([makeRule({ debounceMs: 0, cooldownMs: 0 })]))
    expectValid(
      configWithRules([makeRule({ debounceMs: RULE_DEBOUNCE_MAX_MS, cooldownMs: RULE_COOLDOWN_MAX_MS })]),
    )
    expect(errorsOf(configWithRules([makeRule({ debounceMs: -1 })]))).toMatch(/debounceMs/i)
    expect(errorsOf(configWithRules([makeRule({ debounceMs: RULE_DEBOUNCE_MAX_MS + 1 })]))).toMatch(/debounceMs/i)
    expect(errorsOf(configWithRules([makeRule({ cooldownMs: -1 })]))).toMatch(/cooldownMs/i)
    expect(errorsOf(configWithRules([makeRule({ cooldownMs: RULE_COOLDOWN_MAX_MS + 1 })]))).toMatch(/cooldownMs/i)
  })

  it('rejects fractional timing values', () => {
    expect(errorsOf(configWithRules([makeRule({ debounceMs: 1.5 })]))).toMatch(/debounceMs/i)
  })

  it('rejects duplicate rule ids', () => {
    const config = configWithRules([
      makeRule({ id: 'rule-same', name: 'One' }),
      makeRule({ id: 'rule-same', name: 'Two' }),
    ])
    expect(errorsOf(config)).toMatch(/duplicate rule id: rule-same/i)
  })

  it('rejects unknown rig references with a rule path', () => {
    const config = configWithRules([
      makeRule({ actions: [{ kind: 'runRig', presetId: 'missing-rig' }] }),
    ])
    const errors = errorsOf(config)
    expect(errors).toMatch(/unknown rig: missing-rig/i)
    expect(errors).toContain('rules.0.actions.0.presetId')
  })

  it('rejects unknown profile references', () => {
    const config = configWithRules([
      makeRule({ actions: [{ kind: 'showProfile', profileId: 'missing-profile' }] }),
    ])
    const errors = errorsOf(config)
    expect(errors).toMatch(/unknown profile: missing-profile/i)
    expect(errors).toContain('rules.0.actions.0.profileId')
  })

  it('rejects unknown page references and pages from the wrong profile', () => {
    const unknownPage = configWithRules([
      makeRule({ actions: [{ kind: 'showPage', profileId: PROFILE_ID, pageId: 'missing-page' }] }),
    ])
    expect(errorsOf(unknownPage)).toMatch(/unknown page in profile profile-desktop: missing-page/i)
    expect(errorsOf(unknownPage)).toContain('rules.0.actions.0.pageId')

    const config = createDefaultConfig()
    const base = config.profiles[0]!
    const other: DeckProfile = {
      ...structuredClone(base),
      id: 'profile-other',
      name: 'Other',
      pages: [{ id: 'page-other', name: 'Other page', buttons: [] }],
      defaultPageId: 'page-other',
    }
    config.profiles.push(other)
    config.rules = [
      makeRule({ actions: [{ kind: 'showPage', profileId: PROFILE_ID, pageId: 'page-other' }] }),
    ]
    expect(errorsOf(config)).toMatch(/unknown page in profile profile-desktop: page-other/i)

    config.rules = [
      makeRule({ actions: [{ kind: 'showPage', profileId: 'profile-other', pageId: 'page-other' }] }),
    ]
    expectValid(config)
  })

  it('accepts a valid rig reference', () => {
    const config = createDefaultConfig()
    config.rigs = [{ id: 'go-live', name: 'Go live', steps: [{ action: { type: 'hotkey', keys: ['A'] } }] }]
    config.rules = [makeRule({ actions: [{ kind: 'runRig', presetId: 'go-live' }] })]
    expectValid(config)
  })

  it('rejects unknown trigger kinds and fields from the wrong arm', () => {
    const unknownKind = makeRule({
      trigger: { kind: 'obs.virtualCam', active: true } as unknown as EventTrigger,
    })
    expect(errorsOf(configWithRules([unknownKind]))).toMatch(/trigger/i)

    const wrongArm = makeRule({
      trigger: { kind: 'obs.streaming', active: true, scene: 'Gameplay' } as unknown as EventTrigger,
    })
    expect(errorsOf(configWithRules([wrongArm]))).toMatch(/trigger/i)

    const missingActive = makeRule({
      trigger: { kind: 'obs.streaming' } as unknown as EventTrigger,
    })
    expect(errorsOf(configWithRules([missingActive]))).toMatch(/active/i)
  })

  it('validates scene triggers', () => {
    expectValid(configWithRules([makeRule({ trigger: { kind: 'obs.scene', scene: 'S'.repeat(RULE_MAX_SCENE) } })]))
    expect(errorsOf(configWithRules([makeRule({ trigger: { kind: 'obs.scene', scene: '   ' } })]))).toMatch(
      /scene cannot be empty/i,
    )
    expect(
      errorsOf(configWithRules([makeRule({ trigger: { kind: 'obs.scene', scene: 'S'.repeat(RULE_MAX_SCENE + 1) } })])),
    ).toMatch(/scene/i)
  })

  it('validates process triggers', () => {
    expectValid(
      configWithRules([
        makeRule({ trigger: { kind: 'process.started', process: 'P'.repeat(RULE_MAX_PROCESS) } }),
      ]),
    )
    expect(
      errorsOf(configWithRules([makeRule({ trigger: { kind: 'process.started', process: '  ' } })])),
    ).toMatch(/process name cannot be empty/i)
    expect(
      errorsOf(configWithRules([makeRule({ trigger: { kind: 'process.started', process: 'C:\\game.exe' } })])),
    ).toMatch(/slashes or control characters/i)
    expect(
      errorsOf(
        configWithRules([
          makeRule({ trigger: { kind: 'process.started', process: 'P'.repeat(RULE_MAX_PROCESS + 1) } }),
        ]),
      ),
    ).toMatch(/process names are limited/i)
  })

  it('validates notice actions', () => {
    expectValid(
      configWithRules([makeRule({ actions: [{ kind: 'notice', text: 'N'.repeat(RULE_MAX_NOTICE) }] })]),
    )
    expect(
      errorsOf(configWithRules([makeRule({ actions: [{ kind: 'notice', text: 'N'.repeat(RULE_MAX_NOTICE + 1) }] })])),
    ).toMatch(/notice/i)
    expect(errorsOf(configWithRules([makeRule({ actions: [{ kind: 'notice', text: ' ' }] })]))).toMatch(
      /notice text cannot be empty/i,
    )
  })

  it('rejects unknown and incomplete actions', () => {
    expect(
      errorsOf(
        configWithRules([
          makeRule({ actions: [{ kind: 'launch', app: 'obs' }] as unknown as RuleAction[] }),
        ]),
      ),
    ).toMatch(/actions/i)
    expect(
      errorsOf(
        configWithRules([
          makeRule({ actions: [{ kind: 'runRig' }] as unknown as RuleAction[] }),
        ]),
      ),
    ).toMatch(/presetId/i)
    expect(
      errorsOf(
        configWithRules([
          makeRule({ actions: [{ kind: 'showPage', profileId: PROFILE_ID }] as unknown as RuleAction[] }),
        ]),
      ),
    ).toMatch(/pageId/i)
  })

  it('rejects serialized rules above 64 KB', () => {
    const config = createDefaultConfig()
    const longProfileId = 'p'.repeat(64)
    const pageIds = Array.from({ length: 20 }, (_, index) => `page-${index}`.padEnd(64, 'x'))
    const base = config.profiles[0]!
    const profile: DeckProfile = {
      id: longProfileId,
      name: 'Long profile',
      grid: structuredClone(base.grid),
      theme: structuredClone(base.theme),
      pages: pageIds.map((pageId) => ({ id: pageId, name: pageId.slice(0, 60), buttons: [] })),
      defaultPageId: pageIds[0]!,
    }
    config.profiles = [profile]
    config.defaultProfileId = profile.id
    config.rules = Array.from({ length: RULES_MAX_RULES }, (_, index) => ({
      id: `rule-${index}`,
      name: 'N'.repeat(RULE_MAX_NAME),
      trigger: { kind: 'obs.scene', scene: 'S'.repeat(RULE_MAX_SCENE) },
      conditions: Array.from({ length: RULE_MAX_CONDITIONS }, () => ({
        probe: 'appRunning' as const,
        expect: true,
        arg: 'A'.repeat(260),
        label: 'L'.repeat(60),
      })),
      actions: Array.from({ length: RULE_MAX_ACTIONS }, (_, actionIndex) => ({
        kind: 'showPage' as const,
        profileId: longProfileId,
        pageId: pageIds[actionIndex]!,
      })),
    }))
    expect(errorsOf(config)).toMatch(/too large/i)
  })
})

describe('rule helpers', () => {
  it('builds stable trigger keys', () => {
    expect(ruleTriggerKey({ kind: 'obs.streaming', active: true })).toBe('obs.streaming')
    expect(ruleTriggerKey({ kind: 'obs.streaming', active: false })).toBe('obs.streaming')
    expect(ruleTriggerKey({ kind: 'twitch.live', active: false })).toBe('twitch.live')
    expect(ruleTriggerKey({ kind: 'obs.scene', scene: '  Gameplay  ' })).toBe('obs.scene:Gameplay')
    expect(ruleTriggerKey({ kind: 'process.started', process: 'C:\\Games\\Game.EXE' })).toBe(
      'process.started:game',
    )
    expect(ruleTriggerKey({ kind: 'phone.connected' })).toBe('phone.present')
    expect(ruleTriggerKey({ kind: 'phone.disconnected' })).toBe('phone.present')
  })

  it('normalizes process names', () => {
    expect(normalizeRuleProcess(' C:\\Games\\Game.EXE ')).toBe('game')
    expect(normalizeRuleProcess('discord')).toBe('discord')
  })

  it('matches level, scene, process and presence triggers', () => {
    expect(ruleMatchesTrigger({ kind: 'obs.streaming', active: true }, { kind: 'obs.streaming', active: true })).toBe(true)
    expect(ruleMatchesTrigger({ kind: 'obs.streaming', active: true }, { kind: 'obs.streaming', active: false })).toBe(
      false,
    )
    expect(ruleMatchesTrigger({ kind: 'twitch.live', active: false }, { kind: 'twitch.live', active: false })).toBe(true)
    expect(ruleMatchesTrigger({ kind: 'obs.scene', scene: 'Gameplay' }, { kind: 'obs.scene', scene: 'Gameplay' })).toBe(
      true,
    )
    expect(ruleMatchesTrigger({ kind: 'obs.scene', scene: 'Gameplay' }, { kind: 'obs.scene', scene: 'Live' })).toBe(false)
    expect(
      ruleMatchesTrigger(
        { kind: 'process.started', process: 'Game.exe' },
        { kind: 'process.started', process: 'game' },
      ),
    ).toBe(true)
    expect(
      ruleMatchesTrigger(
        { kind: 'process.started', process: 'game' },
        { kind: 'process.stopped', process: 'game' },
      ),
    ).toBe(false)
    expect(ruleMatchesTrigger({ kind: 'phone.connected' }, { kind: 'phone.connected' })).toBe(true)
    expect(ruleMatchesTrigger({ kind: 'phone.disconnected' }, { kind: 'phone.connected' })).toBe(false)
    expect(ruleMatchesTrigger({ kind: 'phone.connected' }, { kind: 'phone.connected', active: false })).toBe(false)
    expect(ruleMatchesTrigger({ kind: 'phone.disconnected' }, { kind: 'phone.disconnected', active: false })).toBe(true)
  })

  it('describes every trigger', () => {
    expect(describeTrigger({ kind: 'obs.streaming', active: true })).toBe('OBS stream started')
    expect(describeTrigger({ kind: 'obs.streaming', active: false })).toBe('OBS stream stopped')
    expect(describeTrigger({ kind: 'obs.recording', active: true })).toBe('OBS recording started')
    expect(describeTrigger({ kind: 'obs.recording', active: false })).toBe('OBS recording stopped')
    expect(describeTrigger({ kind: 'obs.replay', active: true })).toBe('OBS replay buffer started')
    expect(describeTrigger({ kind: 'obs.replay', active: false })).toBe('OBS replay buffer stopped')
    expect(describeTrigger({ kind: 'twitch.live', active: true })).toBe('Twitch went live')
    expect(describeTrigger({ kind: 'twitch.live', active: false })).toBe('Twitch went offline')
    expect(describeTrigger({ kind: 'obs.scene', scene: 'Gameplay' })).toBe('OBS scene "Gameplay"')
    expect(describeTrigger({ kind: 'process.started', process: 'game.exe' })).toBe('Process started (game.exe)')
    expect(describeTrigger({ kind: 'process.stopped', process: 'game' })).toBe('Process stopped (game)')
    expect(describeTrigger({ kind: 'phone.connected' })).toBe('Phone connected')
    expect(describeTrigger({ kind: 'phone.disconnected' })).toBe('Phone disconnected')
  })

  it('describes actions with config lookups and id fallbacks', () => {
    const config = createDefaultConfig()
    config.rigs = [{ id: 'go-live', name: 'Go live', steps: [{ action: { type: 'hotkey', keys: ['A'] } }] }]
    const lookup = { rigs: config.rigs, profiles: config.profiles }

    expect(describeRuleAction({ kind: 'runRig', presetId: 'go-live' }, lookup)).toBe('Run rig "Go live"')
    expect(describeRuleAction({ kind: 'runRig', presetId: 'missing' }, lookup)).toBe('Run rig "missing"')
    expect(describeRuleAction({ kind: 'showProfile', profileId: PROFILE_ID }, lookup)).toBe(
      'Show profile "My PC"',
    )
    expect(describeRuleAction({ kind: 'showProfile', profileId: 'missing' }, lookup)).toBe(
      'Show profile "missing"',
    )
    expect(describeRuleAction({ kind: 'showPage', profileId: PROFILE_ID, pageId: PAGE_ID }, lookup)).toBe(
      'Show page "Main" (My PC)',
    )
    expect(describeRuleAction({ kind: 'showPage', profileId: PROFILE_ID, pageId: 'missing' }, lookup)).toBe(
      'Show page "missing" (My PC)',
    )
    expect(describeRuleAction({ kind: 'showPage', profileId: 'missing', pageId: 'page' }, lookup)).toBe(
      'Show page "missing / page"',
    )
    expect(describeRuleAction({ kind: 'notice', text: 'Stream ended' })).toBe('Notify "Stream ended"')
  })

  it('formats run durations compactly', () => {
    expect(formatRuleDuration(0)).toBe('0ms')
    expect(formatRuleDuration(-5)).toBe('0ms')
    expect(formatRuleDuration(Number.NaN)).toBe('0ms')
    expect(formatRuleDuration(850)).toBe('850ms')
    expect(formatRuleDuration(1_500)).toBe('1.5s')
    expect(formatRuleDuration(2_000)).toBe('2s')
    expect(formatRuleDuration(59_400)).toBe('59.4s')
    expect(formatRuleDuration(60_000)).toBe('1m')
    expect(formatRuleDuration(125_000)).toBe('2m 05s')
    expect(formatRuleDuration(3_600_000)).toBe('1h')
    expect(formatRuleDuration(4_320_000)).toBe('1h 12m')
  })

  it('finds rules and references', () => {
    const goLive = makeRule({
      id: 'rule-golive',
      actions: [
        { kind: 'runRig', presetId: 'go-live' },
        { kind: 'showPage', profileId: PROFILE_ID, pageId: PAGE_ID },
      ],
    })
    const other = makeRule({
      id: 'rule-other',
      actions: [{ kind: 'showProfile', profileId: 'profile-other' }],
    })
    const rules = [goLive, other]

    expect(ruleById(rules, 'rule-golive')).toBe(goLive)
    expect(ruleById(rules, 'missing')).toBeUndefined()
    expect(ruleById(undefined, 'rule-golive')).toBeUndefined()
    expect(rulesOf({ rules })).toBe(rules)
    expect(rulesOf(undefined)).toEqual([])

    expect(rulesUsingRig(rules, 'go-live')).toEqual([goLive])
    expect(rulesUsingRig(rules, 'missing')).toEqual([])
    expect(rulesUsingProfile(rules, PROFILE_ID)).toEqual([goLive])
    expect(rulesUsingProfile(rules, 'profile-other')).toEqual([other])
    expect(rulesUsingPage(rules, PROFILE_ID, PAGE_ID)).toEqual([goLive])
    expect(rulesUsingPage(rules, PROFILE_ID, 'page-other')).toEqual([])

    const rigRef: RuleReference = { kind: 'rig', rigId: 'go-live' }
    const profileRef: RuleReference = { kind: 'profile', profileId: PROFILE_ID }
    const pageRef: RuleReference = { kind: 'page', profileId: PROFILE_ID, pageId: PAGE_ID }
    expect(hasRuleReference(goLive, rigRef)).toBe(true)
    expect(hasRuleReference(goLive, profileRef)).toBe(true)
    expect(hasRuleReference(goLive, pageRef)).toBe(true)
    expect(hasRuleReference(other, rigRef)).toBe(false)
    expect(hasRuleReference(other, pageRef)).toBe(false)
  })

  it('reports action and condition capacity', () => {
    const showProfile: RuleAction = { kind: 'showProfile', profileId: PROFILE_ID }
    const empty = makeRule({ actions: [showProfile], conditions: [] })
    expect(ruleHasRoomForAction(empty)).toBe(true)
    expect(ruleHasRoomForCondition(empty)).toBe(true)
    const full = makeRule({
      actions: [showProfile, showProfile, showProfile, showProfile],
      conditions: [{ probe: 'micMuted' }, { probe: 'obsStreaming' }, { probe: 'twitchLive' }, { probe: 'lightOn' }],
    })
    expect(ruleHasRoomForAction(full)).toBe(false)
    expect(ruleHasRoomForCondition(full)).toBe(false)
  })

  it('prepends history newest-first and caps it', () => {
    const first = historyEntry({ seq: 1, ruleName: 'First' })
    const second = historyEntry({ seq: 2, ruleName: 'Second' })
    expect(appendRuleHistory([], first)).toEqual([first])
    expect(appendRuleHistory([first], second)).toEqual([second, first])
    expect(appendRuleHistory([second, first], historyEntry({ seq: 3 }), 2)).toHaveLength(2)
    expect(appendRuleHistory([first], second, 0)).toEqual([])
  })
})
