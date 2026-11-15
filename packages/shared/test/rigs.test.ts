import { describe, expect, it } from 'vitest'
import { actionsToPlan, describeAction } from '../src/actions'
import { createDefaultConfig } from '../src/defaults'
import {
  RIG_GUARD_LABELS,
  describeRigAction,
  describeRigGuard,
  estimateRigMs,
  formatRigRunAge,
  hasRigAction,
  isRigRunAction,
  rigActionOf,
  rigById,
  rigToPlan,
} from '../src/rigs'
import { parseConfig, validateConfig } from '../src/schema'
import {
  RIG_CAPABILITY,
  type DeckConfig,
  type PlanGroup,
  type RigGuard,
  type RigPreset,
  type RigProgressMessage,
  type RigRunAction,
  type RigStep,
  type ServerMessage,
} from '../src/types'

function makeRig(overrides: Partial<RigPreset> = {}): RigPreset {
  return {
    id: 'rig-one',
    name: 'Rig one',
    steps: [{ id: 'step-1', action: { type: 'hotkey', keys: ['A'] } }],
    ...overrides,
  }
}

function configWith(rigs: RigPreset[]): DeckConfig {
  const config = createDefaultConfig()
  config.rigs = rigs
  return config
}

function buttonOf(config: DeckConfig) {
  return config.profiles[0]!.pages[0]!.buttons[0]!
}

function patchButton(config: DeckConfig, patch: Record<string, unknown>): void {
  Object.assign(buttonOf(config) as unknown as Record<string, unknown>, patch)
}

function guardConfig(guards: unknown[]): DeckConfig {
  const rig = makeRig()
  ;(rig as unknown as { guards: unknown[] }).guards = guards
  return configWith([rig])
}

function rigError(config: unknown): string {
  const result = validateConfig(config)
  expect(result.ok).toBe(false)
  return result.ok ? '' : result.errors.join(' ')
}

const rigAction: RigRunAction = { type: 'rig', action: 'run', presetId: 'rig-one' }

describe('rig config schema', () => {
  it('accepts a config with a valid rig and references', () => {
    const config = configWith([makeRig()])
    patchButton(config, {
      actions: [rigAction],
      state: { type: 'rig', presetId: 'rig-one' },
    })
    const result = validateConfig(config)
    expect(result.ok, result.ok ? '' : result.errors.join(' ')).toBe(true)
    expect(RIG_CAPABILITY).toBe('rig-v1')
  })

  it('keeps v1 configs without rigs valid and unchanged on round-trip', () => {
    const config = createDefaultConfig()
    const before = JSON.stringify(config)
    const parsed = parseConfig(config)
    expect(parsed).toEqual(config)
    expect(parsed.rigs).toBeUndefined()
    expect(JSON.stringify(parsed)).toBe(before)
    expect(parsed.schemaVersion).toBe(1)
  })

  it('round-trips a fully populated rig', () => {
    const config = configWith([
      {
        id: 'rig-live',
        name: 'Go live',
        icon: '▶',
        description: 'Scene, mic and overlay',
        steps: [
          {
            id: 's1',
            label: 'Live scene',
            action: { type: 'obs', action: 'setScene', scene: 'Live' },
            delayMs: 500,
          },
          {
            id: 's2',
            action: { type: 'appVolume', action: 'toggleMute', match: { process: 'discord' } },
            continueOnError: true,
          },
          { id: 's3', action: { type: 'streamerbot', action: 'doAction', actionName: 'Overlay on' } },
        ],
        guards: [
          { probe: 'appRunning', arg: 'obs64.exe' },
          { probe: 'micMuted', expect: false, label: 'Mic is live' },
        ],
        onError: 'continue',
        deadlineMs: 90_000,
      },
    ])
    const parsed = parseConfig(config)
    expect(parsed.rigs).toEqual(config.rigs)
    expect(parsed).toEqual(config)
  })

  it('enforces preset and step limits', () => {
    const tooMany = Array.from({ length: 17 }, (_, index) =>
      makeRig({ id: `rig-${index}`, name: `Rig ${index}` }),
    )
    expect(rigError(configWith(tooMany))).toMatch(/at most 16 rigs/)
    expect(validateConfig(configWith(tooMany.slice(0, 16))).ok).toBe(true)

    expect(rigError(configWith([makeRig({ steps: [] })]))).toMatch(/at least one step/)

    const tooManySteps = Array.from({ length: 33 }, () => ({
      action: { type: 'delay', ms: 1 } as const,
    }))
    expect(rigError(configWith([makeRig({ steps: tooManySteps })]))).toMatch(/at most 32 steps/)

    expect(validateConfig(configWith([makeRig({ steps: tooManySteps.slice(0, 32) })])).ok).toBe(true)
  })

  it('bounds step delay and rig deadline', () => {
    const step = (delayMs: number): RigStep => ({ action: { type: 'delay', ms: 1 }, delayMs })
    expect(validateConfig(configWith([makeRig({ steps: [step(10_000)] })])).ok).toBe(true)
    expect(rigError(configWith([makeRig({ steps: [step(10_001)] })]))).toMatch(/steps/)

    const rig = (deadlineMs: number) => makeRig({ deadlineMs })
    expect(validateConfig(configWith([rig(1000)])).ok).toBe(true)
    expect(validateConfig(configWith([rig(600_000)])).ok).toBe(true)
    expect(validateConfig(configWith([rig(999)])).ok).toBe(false)
    expect(validateConfig(configWith([rig(600_001)])).ok).toBe(false)
  })

  it('rejects duplicate rig ids and duplicate step ids per rig', () => {
    expect(rigError(configWith([makeRig(), makeRig()]))).toMatch(/Duplicate rig id: rig-one/)

    const duplicateSteps: RigStep[] = [
      { id: 'same', action: { type: 'delay', ms: 1 } },
      { id: 'same', action: { type: 'delay', ms: 2 } },
    ]
    expect(rigError(configWith([makeRig({ steps: duplicateSteps })]))).toMatch(
      /Duplicate step id in rig Rig one: same/,
    )

    const unnamed: RigStep[] = [
      { action: { type: 'delay', ms: 1 } },
      { action: { type: 'delay', ms: 2 } },
    ]
    expect(validateConfig(configWith([makeRig({ steps: unnamed })])).ok).toBe(true)
  })

  it('checks rig run and rig state references exist', () => {
    const config = configWith([makeRig()])
    patchButton(config, {
      actions: [{ type: 'rig', action: 'run', presetId: 'missing' }],
    })
    expect(rigError(config)).toMatch(/references an unknown rig: missing/)

    const stateConfig = configWith([makeRig()])
    patchButton(stateConfig, { state: { type: 'rig', presetId: 'missing' } })
    expect(rigError(stateConfig)).toMatch(/has an unknown rig state: missing/)

    const noRigs = createDefaultConfig()
    patchButton(noRigs, { actions: [rigAction] })
    expect(rigError(noRigs)).toMatch(/references an unknown rig: rig-one/)
  })

  it('requires a rig button to have exactly one action and no control', () => {
    const extraAction = configWith([makeRig()])
    patchButton(extraAction, {
      actions: [rigAction, { type: 'hotkey', keys: ['B'] }],
    })
    expect(rigError(extraAction)).toMatch(/must use a rig action on its own/)

    const twoRigs = configWith([makeRig()])
    patchButton(twoRigs, { actions: [rigAction, { ...rigAction }] })
    expect(rigError(twoRigs)).toMatch(/must use a rig action on its own/)

    const withControl = configWith([makeRig()])
    patchButton(withControl, {
      actions: [rigAction],
      control: {
        kind: 'slider',
        emit: 'value',
        binding: { type: 'volume', mode: 'absolute' },
      },
    })
    expect(rigError(withControl)).toMatch(/cannot combine a rig action with a control/)
  })

  it('excludes page, keyboard, mixer and nested rig steps', () => {
    for (const action of [
      { type: 'page', direction: 'next' },
      { type: 'keyboard', action: 'open' },
      { type: 'mixer', action: 'open' },
      { type: 'rig', action: 'run', presetId: 'rig-one' },
    ]) {
      const rig = makeRig({ steps: [{ action: action as RigStep['action'] }] })
      expect(validateConfig(configWith([rig])).ok, JSON.stringify(action)).toBe(false)
    }

    for (const action of [
      { type: 'hotkey', keys: ['CTRL', 'S'] },
      { type: 'text', text: 'hello' },
      { type: 'macro', steps: [{ type: 'delay', ms: 10 }] },
      { type: 'launch', path: 'notepad.exe' },
      { type: 'url', url: 'https://example.com' },
      { type: 'command', command: 'echo hi' },
      { type: 'media', key: 'playpause' },
      { type: 'delay', ms: 10 },
      { type: 'mic', action: 'toggleMute' },
      { type: 'obs', action: 'toggleStream' },
      { type: 'twitch', action: 'createMarker' },
      { type: 'light', action: 'togglePower', light: 'desk' },
      { type: 'appVolume', action: 'toggleMute', match: { process: 'discord' } },
      { type: 'streamerbot', action: 'doAction', actionName: 'Go' },
    ]) {
      const rig = makeRig({ steps: [{ action: action as RigStep['action'] }] })
      const result = validateConfig(configWith([rig]))
      expect(result.ok, `${JSON.stringify(action)} ${result.ok ? '' : result.errors.join(' ')}`).toBe(true)
    }
  })

  it('validates guard arguments per probe and supports expect:false', () => {
    expect(validateConfig(configWith([makeRig({ guards: [{ probe: 'obsStreaming' }] })])).ok).toBe(true)
    expect(validateConfig(configWith([makeRig({ guards: [{ probe: 'micMuted', expect: false }] })])).ok).toBe(
      true,
    )
    expect(rigError(guardConfig([{ probe: 'appRunning' }]))).toMatch(
      /require an application name/,
    )
    expect(rigError(guardConfig([{ probe: 'appRunning', arg: '   ' }]))).toMatch(
      /non-blank application name/,
    )
    expect(validateConfig(guardConfig([{ probe: 'appRunning', arg: 'discord' }])).ok).toBe(true)
    expect(rigError(guardConfig([{ probe: 'obsRecording', arg: 'x' }]))).toMatch(
      /do not accept an argument/,
    )
    expect(validateConfig(guardConfig([{ probe: 'lightOn', arg: 'desk-light' }])).ok).toBe(true)
    expect(rigError(guardConfig([{ probe: 'lightOn', arg: 'not a light id' }]))).toMatch(
      /Light ids may only contain/,
    )
    expect(rigError(guardConfig([{ probe: 'twitchLive', arg: 'x' }]))).toMatch(
      /do not accept an argument/,
    )
  })

  it('limits guards and rejects unknown probes', () => {
    const guards = Array.from({ length: 9 }, () => ({ probe: 'micMuted' }))
    expect(rigError(guardConfig(guards))).toMatch(/at most 8 guards/)
    expect(validateConfig(guardConfig(guards.slice(0, 8))).ok).toBe(true)
    expect(validateConfig(guardConfig([{ probe: 'cpuLoad' }])).ok).toBe(false)
  })

  it('rejects rigs whose serialized payload exceeds 128 KB', () => {
    const bigStep = (): RigStep => ({ action: { type: 'text', text: 'x'.repeat(10_000) } })
    const big = makeRig({ steps: Array.from({ length: 32 }, bigStep) })
    expect(rigError(configWith([big]))).toMatch(/too large to sync/)

    const small = makeRig({ steps: [{ action: { type: 'text', text: 'ok' } }] })
    expect(validateConfig(configWith([small])).ok).toBe(true)
  })
})

describe('rig planning helpers', () => {
  const rig: RigPreset = {
    id: 'rig-plan',
    name: 'Plan rig',
    steps: [
      {
        id: 's1',
        label: 'First',
        action: { type: 'hotkey', keys: ['CTRL', 'A'] },
        delayMs: 250,
        continueOnError: true,
      },
      {
        id: 's2',
        action: {
          type: 'macro',
          steps: [
            { type: 'text', text: 'hi' },
            { type: 'delay', ms: 120 },
          ],
        },
      },
      {
        id: 's3',
        action: { type: 'appVolume', action: 'toggleMute', match: { process: 'discord' } },
      },
    ],
    onError: 'continue',
  }

  it('preserves step order, labels, delays and continue behavior', () => {
    const groups = rigToPlan(rig)
    expect(groups).toHaveLength(3)
    expect(groups.map((group) => group.label)).toEqual(['First', 'Macro · 2 steps', 'Toggle mute for "discord"'])
    expect(groups[0]).toEqual({
      label: 'First',
      steps: [{ kind: 'keys', keys: ['CTRL', 'A'], holdMs: 35, action: 'press' }],
      delayMs: 250,
      continueOnError: true,
    })
    expect(groups[1]!.steps.map((step) => step.kind)).toEqual(['text', 'delay'])
    expect(groups[2]!.steps).toEqual([
      { kind: 'appVolume', action: 'toggleMute', match: { process: 'discord' } },
    ])
    expect(groups[1]!.continueOnError).toBe(true)
    expect(groups[0]!.delayMs).toBe(250)
    expect(groups[1]!.delayMs).toBeUndefined()
  })

  it('expands a macro into one group and resolves per-step overrides', () => {
    const macroRig: RigPreset = {
      id: 'rig-macro',
      name: 'Macro rig',
      onError: 'failFast',
      steps: [
        {
          action: {
            type: 'macro',
            steps: [
              { type: 'hotkey', keys: ['A'] },
              { type: 'hotkey', keys: ['B'] },
              { type: 'delay', ms: 10 },
            ],
          },
        },
        { continueOnError: true, action: { type: 'delay', ms: 1 } },
        { continueOnError: false, action: { type: 'delay', ms: 2 } },
      ],
    }
    const groups = rigToPlan(macroRig)
    expect(groups).toHaveLength(3)
    expect(groups[0]!.steps.map((step) => step.kind)).toEqual(['keys', 'keys', 'delay'])
    expect(groups[0]!.continueOnError).toBe(false)
    expect(groups[1]!.continueOnError).toBe(true)
    expect(groups[2]!.continueOnError).toBe(false)

    const group: PlanGroup = groups[0]!
    expect(group.steps).toHaveLength(3)
  })

  it('estimates durations monotonically', () => {
    const base: RigPreset = { id: 'a', name: 'A', steps: [{ action: { type: 'delay', ms: 1000 } }] }
    const longer: RigPreset = {
      ...base,
      steps: [...base.steps, { action: { type: 'hotkey', keys: ['A'] } }],
    }
    const delayed: RigPreset = {
      ...base,
      steps: [{ action: { type: 'delay', ms: 1000 }, delayMs: 500 }],
    }
    expect(estimateRigMs(base)).toBe(1000)
    expect(estimateRigMs(longer)).toBeGreaterThan(estimateRigMs(base))
    expect(estimateRigMs(delayed)).toBeGreaterThan(estimateRigMs(base))
    expect(estimateRigMs({ id: 'e', name: 'E', steps: [{ action: { type: 'delay', ms: 0 } }] })).toBe(0)
  })

  it('describes guards with negation, arguments and overrides', () => {
    expect(describeRigGuard({ probe: 'obsStreaming' })).toBe('OBS streaming')
    expect(describeRigGuard({ probe: 'obsStreaming', expect: false })).toBe('Not OBS streaming')
    expect(describeRigGuard({ probe: 'appRunning', arg: 'discord' })).toBe('App running (discord)')
    expect(describeRigGuard({ probe: 'lightOn', arg: 'desk', expect: false })).toBe('Not Light on (desk)')
    expect(describeRigGuard({ probe: 'micMuted', label: 'Mic live', expect: false })).toBe('Not Mic live')
    const guard: RigGuard = { probe: 'twitchLive' }
    expect(describeRigGuard(guard)).toBe(RIG_GUARD_LABELS.twitchLive)
  })

  it('formats run ages at the boundaries', () => {
    const now = 1_700_000_000_000
    expect(formatRigRunAge(now, now)).toBe('NOW')
    expect(formatRigRunAge(now - 59_999, now)).toBe('NOW')
    expect(formatRigRunAge(now - 60_000, now)).toBe('1m')
    expect(formatRigRunAge(now - 59 * 60_000, now)).toBe('59m')
    expect(formatRigRunAge(now - 3_600_000, now)).toBe('1h')
    expect(formatRigRunAge(now - 23 * 3_600_000, now)).toBe('23h')
    expect(formatRigRunAge(now - 86_400_000, now)).toBe('1d')
    expect(formatRigRunAge(now - 3 * 86_400_000, now)).toBe('3d')
    expect(formatRigRunAge(now + 5_000, now)).toBe('NOW')
    expect(formatRigRunAge(undefined, now)).toBe('NEVER')
    expect(formatRigRunAge(null, now)).toBe('NEVER')
  })

  it('finds rigs and structural rig actions', () => {
    const rigs = [makeRig(), makeRig({ id: 'rig-two', name: 'Two' })]
    expect(rigById(rigs, 'rig-two')?.name).toBe('Two')
    expect(rigById(undefined, 'rig-two')).toBeUndefined()
    expect(rigById(rigs, 'missing')).toBeUndefined()

    expect(isRigRunAction(rigAction)).toBe(true)
    expect(isRigRunAction({ type: 'rig', presetId: 'x' })).toBe(false)
    expect(isRigRunAction({ type: 'hotkey', keys: ['A'] })).toBe(false)
    expect(hasRigAction([{ type: 'hotkey', keys: ['A'] }])).toBe(false)
    expect(hasRigAction([{ type: 'hotkey', keys: ['A'] }, rigAction])).toBe(true)
    expect(hasRigAction(undefined)).toBe(false)
    expect(rigActionOf([{ type: 'hotkey', keys: ['A'] }, rigAction])).toEqual(rigAction)

    expect(describeRigAction(rigAction, makeRig())).toBe('Run rig "Rig one"')
    expect(describeRigAction(rigAction)).toBe('Run rig "rig-one"')
  })

  it('leaves a plain rig action out of ordinary plans but describes it', () => {
    expect(actionsToPlan([rigAction])).toEqual([])
    expect(actionsToPlan([rigAction, { type: 'delay', ms: 5 }])).toEqual([{ kind: 'delay', ms: 5 }])
    expect(describeAction(rigAction)).toBe('Run rig "rig-one"')
  })

  it('defines rigProgress as a server-only message', () => {
    const progress: RigProgressMessage = {
      type: 'rigProgress',
      phase: 'done',
      presetId: 'rig-one',
      buttonId: 'btn-1',
      index: 3,
      total: 3,
      label: 'Live scene',
      status: 'ok',
      ok: true,
      durationMs: 1234,
    }
    const messages: ServerMessage[] = [progress]
    expect(messages[0]).toEqual(progress)
  })
})
