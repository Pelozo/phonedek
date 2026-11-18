import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/defaults'
import { repairDanglingReferences } from '../src/repair'
import { validateConfig } from '../src/schema'
import type { DeckButton, DeckConfig, EventRule, RigPreset } from '../src/types'

const liveRig: RigPreset = {
  id: 'rig-live',
  name: 'Go live',
  steps: [{ id: 'step-1', action: { type: 'hotkey', keys: ['F1'] } }],
}

const validRigAction = { type: 'rig', action: 'run', presetId: 'rig-live' }
const missingRigAction = { type: 'rig', action: 'run', presetId: 'rig-missing' }

function patchButton(button: DeckButton, patch: Record<string, unknown>): void {
  Object.assign(button as unknown as Record<string, unknown>, patch)
}

/** A valid config except for dangling rig/rule references. */
function configWithDanglingReferences(): DeckConfig {
  const config = createDefaultConfig()
  config.serverName = 'Studio'
  config.updatedAt = '2026-02-02T02:02:02.000Z'
  config.rigs = [liveRig]

  const page = config.profiles[0]!.pages[0]!
  patchButton(page.buttons[0]!, {
    actions: [validRigAction],
    state: { type: 'rig', presetId: 'rig-live' },
  })
  patchButton(page.buttons[1]!, {
    actions: [missingRigAction],
    state: { type: 'rig', presetId: 'rig-missing' },
  })
  // Valid rig action but a dangling status binding.
  patchButton(page.buttons[2]!, { state: { type: 'rig', presetId: 'rig-gone' } })

  const rules: EventRule[] = [
    {
      id: 'rule-keep',
      name: 'Keep me',
      enabled: true,
      trigger: { kind: 'obs.streaming', active: true },
      conditions: [{ probe: 'micMuted', expect: false, label: 'Mic open' }],
      debounceMs: 1200,
      actions: [
        { kind: 'runRig', presetId: 'rig-live' },
        { kind: 'runRig', presetId: 'rig-missing' },
        { kind: 'showProfile', profileId: 'profile-desktop' },
        { kind: 'showProfile', profileId: 'profile-gone' },
        { kind: 'showPage', profileId: 'profile-desktop', pageId: 'page-main' },
        { kind: 'showPage', profileId: 'profile-desktop', pageId: 'page-gone' },
        { kind: 'showPage', profileId: 'profile-gone', pageId: 'page-main' },
        { kind: 'notice', text: 'Live' },
      ],
    },
    {
      id: 'rule-empty',
      name: 'Only dangling',
      trigger: { kind: 'phone.connected' },
      actions: [{ kind: 'showProfile', profileId: 'profile-gone' }],
    },
  ]
  config.rules = rules
  return config
}

describe('repairDanglingReferences', () => {
  it('removes unknown rig actions and states while keeping valid ones', () => {
    const input = configWithDanglingReferences()
    expect(validateConfig(input).ok).toBe(false)

    const result = repairDanglingReferences(input)

    expect(result.repaired).toBe(true)
    expect(result.removed.rigActions).toBe(1)
    expect(result.removed.rigStates).toBe(2)

    const buttons = result.config.profiles[0]!.pages[0]!.buttons
    expect(buttons[0]!.actions).toEqual([validRigAction])
    expect(buttons[0]!.state).toEqual({ type: 'rig', presetId: 'rig-live' })
    expect(buttons[1]!.actions).toEqual([])
    expect(buttons[1]!.state).toBeUndefined()
    expect(buttons[2]!.state).toBeUndefined()
    // Unrelated buttons keep their actions.
    expect(buttons[3]!.actions).toEqual(input.profiles[0]!.pages[0]!.buttons[3]!.actions)
  })

  it('removes dangling rule targets, keeps valid actions and drops empty rules', () => {
    const result = repairDanglingReferences(configWithDanglingReferences())

    expect(result.removed.ruleActions).toBe(5)
    expect(result.removed.rules).toBe(1)
    expect(result.config.rules).toHaveLength(1)

    const rule = result.config.rules![0]!
    expect(rule.id).toBe('rule-keep')
    expect(rule.name).toBe('Keep me')
    expect(rule.enabled).toBe(true)
    expect(rule.trigger).toEqual({ kind: 'obs.streaming', active: true })
    expect(rule.conditions).toEqual([{ probe: 'micMuted', expect: false, label: 'Mic open' }])
    expect(rule.debounceMs).toBe(1200)
    expect(rule.actions).toEqual([
      { kind: 'runRig', presetId: 'rig-live' },
      { kind: 'showProfile', profileId: 'profile-desktop' },
      { kind: 'showPage', profileId: 'profile-desktop', pageId: 'page-main' },
      { kind: 'notice', text: 'Live' },
    ])
  })

  it('preserves unrelated config fields and the validation result', () => {
    const input = configWithDanglingReferences()
    const result = repairDanglingReferences(input)

    expect(result.config.schemaVersion).toBe(input.schemaVersion)
    expect(result.config.updatedAt).toBe(input.updatedAt)
    expect(result.config.serverName).toBe('Studio')
    expect(result.config.defaultProfileId).toBe(input.defaultProfileId)
    expect(result.config.profiles).toHaveLength(input.profiles.length)
    expect(result.config.profiles[0]!.pages.map((page) => page.id)).toEqual(
      input.profiles[0]!.pages.map((page) => page.id),
    )
    expect(result.config.profiles[0]!.theme).toEqual(input.profiles[0]!.theme)
    expect(result.config.rigs).toEqual([liveRig])

    const validated = validateConfig(result.config)
    expect(validated.ok, validated.ok ? '' : validated.errors.join(' ')).toBe(true)
  })

  it('is a no-op for a valid config, including valid rig/rule references', () => {
    const config = createDefaultConfig()
    config.rigs = [liveRig]
    patchButton(config.profiles[0]!.pages[0]!.buttons[0]!, {
      actions: [validRigAction],
      state: { type: 'rig', presetId: 'rig-live' },
    })
    config.rules = [
      {
        id: 'rule-valid',
        name: 'Valid',
        trigger: { kind: 'obs.streaming', active: true },
        actions: [{ kind: 'runRig', presetId: 'rig-live' }],
      },
    ]
    expect(validateConfig(config).ok).toBe(true)

    const result = repairDanglingReferences(config)
    expect(result.repaired).toBe(false)
    expect(result.removed).toEqual({ rigActions: 0, rigStates: 0, ruleActions: 0, rules: 0 })
    expect(result.config).toEqual(config)
    expect(result.config).not.toBe(config)
  })

  it('omits empty rigs/rules keys after a repair', () => {
    const config = createDefaultConfig()
    config.rigs = []
    config.rules = []
    patchButton(config.profiles[0]!.pages[0]!.buttons[0]!, { actions: [missingRigAction] })

    const result = repairDanglingReferences(config)
    expect(result.repaired).toBe(true)
    expect(result.config).not.toHaveProperty('rigs')
    expect(result.config).not.toHaveProperty('rules')
    expect(validateConfig(result.config).ok).toBe(true)
  })

  it('returns repaired:false for malformed input', () => {
    const inputs: unknown[] = [
      null,
      undefined,
      42,
      'config',
      [],
      {},
      { profiles: 'nope' },
      { profiles: [] },
      { profiles: [{}] },
    ]
    for (const input of inputs) {
      const result = repairDanglingReferences(input)
      expect(result.repaired, JSON.stringify(input)).toBe(false)
      expect(result.removed).toEqual({ rigActions: 0, rigStates: 0, ruleActions: 0, rules: 0 })
      expect(result.config).toBe(input)
    }
  })
})
