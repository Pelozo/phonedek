import { describe, expect, it } from 'vitest'
import {
  createDefaultConfig,
  DeckConfigSchema,
  rigPresetSchema,
  RIG_DEFAULT_DEADLINE_MS,
  RIG_MAX_GUARDS,
  RIG_MAX_STEPS,
} from '@phonedek/shared'
import type {
  Action,
  DeckConfig,
  RigGuard,
  RigPreset,
  RigStep,
  RigStepAction,
  StateBinding,
} from '@phonedek/shared'
import type { RigStatusView } from '../src/shared/api'
import {
  findRig,
  formatRigDuration,
  hasRigAction,
  isRigStateBinding,
  nextRigId,
  nextRigStepId,
  removeRigFromConfig,
  rigActionOf,
  rigDraftErrors,
  rigGuardLabel,
  rigHasDestructiveSteps,
  rigReferences,
  rigRunTone,
  rigsOf,
  rigStateOf,
  rigStatusText,
  rigStepDefaults,
  rigStepSummary,
  rigTemplate,
} from '../src/renderer/src/lib/rigs'

function rig(patch: Partial<RigPreset> = {}): RigPreset {
  return {
    id: 'rig-1',
    name: 'Studio',
    steps: [
      { id: 'step-1', action: { type: 'obs', action: 'startRecord' } },
      { id: 'step-2', action: { type: 'delay', ms: 250 } },
    ],
    ...patch,
  }
}

function status(patch: Partial<RigStatusView> = {}): RigStatusView {
  return {
    presetId: 'rig-1',
    name: 'Studio',
    detail: 'READY',
    active: false,
    available: true,
    ...patch,
  }
}

describe('rigsOf / findRig / rig actions', () => {
  it('tolerates configs and ids that predate rigs', () => {
    expect(rigsOf({})).toEqual([])
    expect(rigsOf(undefined)).toEqual([])
    expect(findRig(undefined, 'rig-1')).toBeUndefined()
    expect(findRig([rig()], 'missing')).toBeUndefined()
    expect(findRig([rig()], 'rig-1')?.name).toBe('Studio')
  })

  it('finds a staged rig action without widening the action union', () => {
    const action = { type: 'rig', action: 'run', presetId: 'rig-1' }
    expect(rigActionOf([{ type: 'delay', ms: 1 }, action])).toEqual(action)
    expect(rigActionOf([{ type: 'delay', ms: 1 }])).toBeUndefined()
    expect(hasRigAction([action])).toBe(true)
    expect(hasRigAction([])).toBe(false)
    expect(hasRigAction(undefined)).toBe(false)
  })

  it('recognises a staged rig status binding', () => {
    expect(isRigStateBinding({ type: 'rig', presetId: 'rig-1' })).toBe(true)
    expect(rigStateOf({ type: 'rig', presetId: 'rig-1' })).toEqual({
      type: 'rig',
      presetId: 'rig-1',
    })
    expect(rigStateOf({ type: 'obs', target: 'streaming' })).toBeNull()
    expect(rigStateOf(null)).toBeNull()
  })
})

describe('step and guard summaries', () => {
  it('falls back to the action description and appends delay/continue flags', () => {
    expect(rigStepSummary({ action: { type: 'delay', ms: 250 } })).toEqual({
      label: 'Wait 250 ms',
      detail: 'Wait 250 ms',
    })
    expect(
      rigStepSummary({
        label: 'Warm up',
        action: { type: 'delay', ms: 250 },
        delayMs: 500,
        continueOnError: true,
      }),
    ).toEqual({
      label: 'Warm up',
      detail: 'Wait 250 ms · +500ms · continue',
    })
  })

  it('labels guard expectations and arguments', () => {
    expect(rigGuardLabel({ probe: 'obsStreaming', expect: false })).toBe('Not OBS streaming')
    expect(rigGuardLabel({ probe: 'appRunning', arg: 'discord.exe' })).toBe(
      'App running (discord.exe)',
    )
    expect(rigGuardLabel({ probe: 'lightOn', arg: 'key-left' })).toBe('Light on (key-left)')
    expect(rigGuardLabel({ probe: 'micMuted' })).toBe('Microphone muted')
  })
})

describe('rig status text and tone', () => {
  it('reads a never-run rig as READY', () => {
    expect(rigStatusText(null)).toMatchObject({ label: 'READY', tone: 'muted', age: 'NEVER' })
  })

  it('keeps the runner tile token and shows the last-run age', () => {
    const now = 1_700_000_000_000
    const reading = rigStatusText(
      status({ detail: 'RUN 2m', status: 'ok', at: now - 120_000, message: '9/9 steps in 1.2s' }),
      now,
    )
    expect(reading).toMatchObject({
      label: 'RUN 2m',
      age: '2m',
      tone: 'ok',
      detail: '9/9 steps in 1.2s',
    })
  })

  it('marks an active run live and keeps progress in the label', () => {
    const reading = rigStatusText(status({ detail: '3/9', active: true }))
    expect(reading.label).toBe('3/9')
    expect(reading.tone).toBe('live')
    expect(reading.detail).toBe('Running · step 3/9')
  })

  it('maps failed, blocked, stopped and timeout outcomes', () => {
    expect(rigStatusText(status({ detail: 'PARTIAL', status: 'partial' })).tone).toBe('warn')
    expect(rigStatusText(status({ detail: 'BLOCKED', status: 'blocked' })).tone).toBe('warn')
    expect(rigStatusText(status({ detail: 'FAILED', status: 'failed' })).tone).toBe('error')
    expect(rigStatusText(status({ detail: 'STOPPED', status: 'cancelled' })).tone).toBe('muted')
    expect(rigStatusText(status({ detail: 'TIMEOUT', status: 'timeout' })).tone).toBe('error')
  })

  it('reads a deleted rig as NO RIG and never throws', () => {
    expect(
      rigStatusText(status({ detail: 'NO RIG', available: false, error: 'Missing' })),
    ).toMatchObject({ label: 'NO RIG', tone: 'muted', detail: 'Missing' })
    expect(rigRunTone('ok')).toBe('ok')
    expect(rigRunTone('ok', true)).toBe('live')
    expect(rigRunTone('failed')).toBe('error')
    expect(rigRunTone(undefined)).toBe('muted')
  })
})

describe('rigDraftErrors', () => {
  it('accepts every template', () => {
    for (const kind of ['go-live', 'brb', 'wrap'] as const) {
      expect(rigDraftErrors(rigTemplate(kind))).toEqual([])
    }
    expect(rigDraftErrors(rig())).toEqual([])
  })

  it('reports identity and size limits', () => {
    expect(rigDraftErrors(rig({ name: '   ' }))).toContain('Name is required.')
    expect(rigDraftErrors(rig({ steps: [] }))).toContain('A rig needs at least one step.')
    expect(
      rigDraftErrors(
        rig({
          steps: Array.from({ length: RIG_MAX_STEPS + 1 }, (_, index): RigStep => ({
            id: `step-${index}`,
            action: { type: 'delay', ms: 1 },
          })),
        }),
      ),
    ).toContain(`A rig accepts at most ${RIG_MAX_STEPS} steps.`)
    expect(
      rigDraftErrors(
        rig({
          guards: Array.from(
            { length: RIG_MAX_GUARDS + 1 },
            (): RigGuard => ({ probe: 'obsStreaming' }),
          ),
        }),
      ),
    ).toContain(`A rig accepts at most ${RIG_MAX_GUARDS} guards.`)
    expect(rigDraftErrors(rig({ deadlineMs: 500 }))).toContain(
      'Deadline must be between 1 and 600 seconds.',
    )
  })

  it('validates guard arguments per probe', () => {
    expect(
      rigDraftErrors(rig({ guards: [{ probe: 'appRunning' }] })),
    ).toContain('Guard 1 needs an application name.')
    expect(
      rigDraftErrors(rig({ guards: [{ probe: 'obsStreaming', arg: 'x' }] })),
    ).toContain('Guard 1 cannot take an argument.')
    expect(
      rigDraftErrors(rig({ guards: [{ probe: 'lightOn', arg: 'bad id!' }] })),
    ).toContain('Guard 1 light id may only use letters, digits, “-” and “_”.')
    expect(rigDraftErrors(rig({ guards: [{ probe: 'appRunning', arg: 'discord.exe' }] }))).toEqual(
      [],
    )
  })

  it('validates step delay, duplicates and forbidden actions', () => {
    expect(
      rigDraftErrors(rig({ steps: [{ id: 'step-1', action: { type: 'delay', ms: 1 }, delayMs: 10_001 }] })),
    ).toContain('Step 1 delay must be 0–10000 ms.')
    expect(
      rigDraftErrors(
        rig({
          steps: [
            { id: 'step-1', action: { type: 'delay', ms: 1 } },
            { id: 'step-1', action: { type: 'delay', ms: 1 } },
          ],
        }),
      ),
    ).toContain('Step 2 reuses step id “step-1”.')
    expect(
      rigDraftErrors(
        rig({
          steps: [
            {
              id: 'step-1',
              action: { type: 'page', direction: 'next' } as unknown as RigStepAction,
            },
          ],
        }),
      ),
    ).toContain('Step 1 uses an action type that rigs cannot run.')
    expect(
      rigDraftErrors(
        rig({ steps: [{ id: 'step-1', action: { type: 'command', command: '' } }] }),
      ).some((error) => error.startsWith('Step 1 action')),
    ).toBe(true)
    expect(
      rigDraftErrors(
        rig({
          steps: [
            {
              id: 'step-1',
              action: { type: 'streamerbot', action: 'doAction', actionName: '' },
            },
          ],
        }),
      ).some((error) => error.startsWith('Step 1 action')),
    ).toBe(true)
  })

  it('reports a duplicate rig id when the full list is supplied', () => {
    const first = rig()
    const second = rig({ name: 'Duplicate' })
    expect(rigDraftErrors(second, [first, second])).toContain('Another rig already uses this id.')
  })
})

describe('ids, defaults and duration formatting', () => {
  it('reuses free rig/step ids', () => {
    expect(nextRigId([])).toBe('rig-1')
    expect(nextRigId([rig({ id: 'rig-1' }), rig({ id: 'rig-3' })])).toBe('rig-2')
    expect(nextRigStepId(undefined)).toBe('step-1')
    expect(
      nextRigStepId(
        rig({
          steps: [
            { id: 'step-1', action: { type: 'delay', ms: 1 } },
            { id: 'step-3', action: { type: 'delay', ms: 1 } },
          ],
        }),
      ),
    ).toBe('step-2')
  })

  it('creates a fresh step with the requested action', () => {
    expect(rigStepDefaults(undefined, { type: 'media', key: 'playpause' })).toEqual({
      id: 'step-1',
      action: { type: 'media', key: 'playpause' },
    })
    expect(
      rigStepDefaults(rig({ steps: [{ id: 'step-1', action: { type: 'delay', ms: 1 } }] })),
    ).toMatchObject({ id: 'step-2', action: { type: 'delay', ms: 250 } })
  })

  it('formats estimates and run durations compactly', () => {
    expect(formatRigDuration(0)).toBe('0s')
    expect(formatRigDuration(-20)).toBe('0s')
    expect(formatRigDuration(450)).toBe('450ms')
    expect(formatRigDuration(1200)).toBe('1.2s')
    expect(formatRigDuration(12_300)).toBe('12s')
    expect(formatRigDuration(65_000)).toBe('1m 5s')
    expect(formatRigDuration(120_000)).toBe('2m')
  })
})

describe('templates', () => {
  it('ships schema-valid generic templates with no user scene names', () => {
    const expectations = {
      'go-live': 'Go live',
      brb: 'BRB',
      wrap: 'Wrap',
    } as const
    for (const kind of ['go-live', 'brb', 'wrap'] as const) {
      const template = rigTemplate(kind, `rig-${kind}`)
      expect(template.name).toBe(expectations[kind])
      expect(rigPresetSchema.safeParse(template).success).toBe(true)
      expect(template.steps.length).toBeGreaterThan(0)
      for (const step of template.steps) {
        expect(['hotkey', 'text', 'macro', 'launch', 'url', 'command', 'media', 'delay', 'mic', 'obs', 'twitch', 'light', 'appVolume', 'streamerbot']).toContain(
          step.action.type,
        )
        expect(step.action.type).not.toBe('page')
        if (step.action.type === 'obs' && step.action.action === 'setScene') {
          expect('scene' in step.action).toBe(false)
        }
      }
    }
  })

  it('uses a default deadline and marks wrap as destructive', () => {
    const goLive = rigTemplate('go-live')
    expect(goLive.deadlineMs).toBe(RIG_DEFAULT_DEADLINE_MS)
    expect(rigHasDestructiveSteps(goLive)).toBe(false)
    expect(rigHasDestructiveSteps(rigTemplate('wrap'))).toBe(true)
    expect(rigTemplate('brb', 'custom-id').id).toBe('custom-id')
  })
})

describe('references and destructive detection', () => {
  function fixture(): { config: DeckConfig; presetId: string } {
    const config = createDefaultConfig()
    const presetId = 'rig-1'
    config.rigs = [rig({ id: presetId })]
    const button = config.profiles[0]!.pages[0]!.buttons[0]!
    button.actions = [{ type: 'rig', action: 'run', presetId } as unknown as Action]
    return { config, presetId }
  }

  it('counts run actions and status tiles that point at one rig', () => {
    const { config, presetId } = fixture()
    expect(rigReferences(config, presetId)).toHaveLength(1)
    const button = config.profiles[0]!.pages[0]!.buttons[0]!
    button.state = { type: 'rig', presetId } as unknown as StateBinding
    const references = rigReferences(config, presetId)
    expect(references).toHaveLength(2)
    expect(new Set(references.map((item) => item.buttonId)).size).toBe(1)
    expect(references.map((item) => item.via).sort()).toEqual(['action', 'state'])
    expect(rigReferences(config, 'other')).toEqual([])
  })

  it('flags stopStream, stopRecord, command and launch steps only', () => {
    expect(rigHasDestructiveSteps(rig())).toBe(false)
    expect(
      rigHasDestructiveSteps(
        rig({ steps: [{ action: { type: 'command', command: 'echo hi' } }] }),
      ),
    ).toBe(true)
    expect(
      rigHasDestructiveSteps(
        rig({ steps: [{ action: { type: 'launch', path: 'notepad.exe', args: [] } }] }),
      ),
    ).toBe(true)
    expect(
      rigHasDestructiveSteps(
        rig({ steps: [{ action: { type: 'obs', action: 'stopStream' } }] }),
      ),
    ).toBe(true)
    expect(
      rigHasDestructiveSteps(
        rig({ steps: [{ action: { type: 'obs', action: 'startStream' } }] }),
      ),
    ).toBe(false)
  })

  it('unlinks rig references without breaking the saved config', () => {
    const { config, presetId } = fixture()
    const page = config.profiles[0]!.pages[0]!
    const button = page.buttons[0]!
    button.state = { type: 'rig', presetId } as unknown as StateBinding
    const untouched = page.buttons[1]!
    const untouchedActions = JSON.stringify(untouched.actions)

    const kept = removeRigFromConfig(config, presetId, undefined, false)
    expect(kept.rigs).toEqual([])
    expect(kept.profiles[0]!.pages[0]!.buttons[0]!.actions).toEqual([])
    expect(kept.profiles[0]!.pages[0]!.buttons[0]!.state).toBeUndefined()
    expect(kept.profiles[0]!.pages[0]!.buttons).toHaveLength(page.buttons.length)
    expect(JSON.stringify(kept.profiles[0]!.pages[0]!.buttons[1]!.actions)).toBe(untouchedActions)
    expect(DeckConfigSchema.safeParse(kept).success).toBe(true)

    const dropped = removeRigFromConfig(config, presetId, undefined, true)
    expect(dropped.profiles[0]!.pages[0]!.buttons).toHaveLength(page.buttons.length - 1)
    expect(DeckConfigSchema.safeParse(dropped).success).toBe(true)
  })
})
