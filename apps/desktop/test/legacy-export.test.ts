import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultConfig, validateConfig } from '@phonedek/shared'
import type { DeckConfig, RigPreset } from '@phonedek/shared'
import { describeLegacyRemoval, legacyConfigJson } from '../src/main/legacy-export'

const rig: RigPreset = {
  id: 'rig-one',
  name: 'Go live',
  steps: [{ id: 'step-1', action: { type: 'hotkey', keys: ['A'] } }],
}

function configWithRigButton(): DeckConfig {
  const config = createDefaultConfig()
  config.rigs = [rig]
  config.rules = [
    {
      id: 'rule-one',
      name: 'Stream started',
      trigger: { kind: 'obs.streaming', active: true },
      actions: [{ kind: 'runRig', presetId: rig.id }],
    },
  ]
  const page = config.profiles[0]!.pages[0]!
  page.buttons = [
    {
      id: 'btn-rig',
      slot: 0,
      label: 'Go live',
      actions: [{ type: 'rig', action: 'run', presetId: rig.id }],
      state: { type: 'rig', presetId: rig.id },
    } as unknown as (typeof page.buttons)[number],
  ]
  return config
}

describe('legacy export JSON', () => {
  it('writes a schema-valid config with rigs, rules and dead rig tiles removed', () => {
    const exported = legacyConfigJson(configWithRigButton())

    expect(exported.removed).toEqual({
      rigs: 1,
      rules: 1,
      rigActions: 1,
      rigStates: 1,
      buttons: 1,
    })
    expect(exported.summary).toBe(
      'Removed 1 rig, 1 rule, 1 rig action, 1 rig state, 1 button',
    )
    expect(exported.json.endsWith('\n')).toBe(true)
    expect(exported.json).toContain('\n  "schemaVersion": 1')

    const parsed = JSON.parse(exported.json) as DeckConfig
    expect(parsed.rigs).toBeUndefined()
    expect(parsed.rules).toBeUndefined()
    expect(parsed.profiles[0]!.pages[0]!.buttons).toEqual([])
    const valid = validateConfig(parsed)
    expect(valid.ok, valid.ok ? '' : valid.errors.join(' ')).toBe(true)
  })

  it('keeps a pre-rig deck unchanged and summarizes the no-op', () => {
    const config = createDefaultConfig()
    const exported = legacyConfigJson(config)
    expect(exported.removed).toEqual({
      rigs: 0,
      rules: 0,
      rigActions: 0,
      rigStates: 0,
      buttons: 0,
    })
    expect(exported.summary).toBe('No rigs, rules or rig tiles to remove')
    expect(JSON.parse(exported.json)).toEqual(config)
  })

  it('writes the exact JSON body to disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phonedek-legacy-'))
    const file = join(dir, 'phonedek-compatible.json')
    const exported = legacyConfigJson(configWithRigButton())
    writeFileSync(file, exported.json, 'utf8')
    expect(readFileSync(file, 'utf8')).toBe(exported.json)
  })
})

describe('describeLegacyRemoval', () => {
  it('uses singular and plural nouns and omits zero counts', () => {
    expect(
      describeLegacyRemoval({
        rigs: 2,
        rules: 0,
        rigActions: 3,
        rigStates: 0,
        buttons: 1,
      }),
    ).toBe('Removed 2 rigs, 3 rig actions, 1 button')
  })
})
