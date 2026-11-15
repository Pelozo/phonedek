import { describe, expect, it } from 'vitest'
import { actionsToPlan, describeAction } from '../src/actions'
import { createDefaultConfig } from '../src/defaults'
import { validateConfig } from '../src/schema'
import {
  CONFIG_SCHEMA_VERSION,
  STREAMERBOT_CAPABILITY,
  STREAMERBOT_DEFAULT_PORT,
  STREAMERBOT_MAX_ARGS,
} from '../src/types'
import type { ConfigAction, StreamerBotAction } from '../src/types'

function buttonConfig(actions: StreamerBotAction[]) {
  const config = createDefaultConfig()
  const button = config.profiles[0]!.pages[0]!.buttons[0]!
  button.actions = actions as ConfigAction[] as typeof button.actions
  return config
}

describe('Streamer.bot contract', () => {
  it('exports streamerbot-v1, the default port and keeps the config schema at v1', () => {
    expect(STREAMERBOT_CAPABILITY).toBe('streamerbot-v1')
    expect(STREAMERBOT_DEFAULT_PORT).toBe(8080)
    expect(CONFIG_SCHEMA_VERSION).toBe(1)
  })

  it('accepts an action name with and without arguments', () => {
    const actions: StreamerBotAction[] = [
      { type: 'streamerbot', action: 'doAction', actionName: 'Test Alert' },
      {
        type: 'streamerbot',
        action: 'doAction',
        actionName: 'Stream Starting',
        args: { duration: '60', message: 'Hello viewers' },
      },
    ]
    const result = validateConfig(buttonConfig(actions))
    expect(result.ok, result.ok ? '' : result.errors.join(' ')).toBe(true)
  })

  it('rejects blank and overlong action names', () => {
    for (const actionName of ['', '   ', 'x'.repeat(129)]) {
      const config = createDefaultConfig()
      config.profiles[0]!.pages[0]!.buttons[0]!.actions = [
        { type: 'streamerbot', action: 'doAction', actionName },
      ] as ConfigAction[] as typeof config.profiles[0]['pages'][0]['buttons'][0]['actions']
      const result = validateConfig(config)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors.join(' ')).toMatch(/cannot be empty|128 characters/)
      }
    }
  })

  it('caps arguments at 16 entries and limits key/value length', () => {
    const many: Record<string, string> = {}
    for (let index = 0; index < STREAMERBOT_MAX_ARGS + 1; index += 1) {
      many[`arg${index}`] = 'value'
    }
    const tooMany = validateConfig(
      buttonConfig([{ type: 'streamerbot', action: 'doAction', actionName: 'Too many', args: many }]),
    )
    expect(tooMany.ok).toBe(false)
    if (!tooMany.ok) expect(tooMany.errors.join(' ')).toMatch(/at most 16 arguments/)

    const tooLong = validateConfig(
      buttonConfig([
        {
          type: 'streamerbot',
          action: 'doAction',
          actionName: 'Long value',
          args: { value: 'x'.repeat(513) },
        },
      ]),
    )
    expect(tooLong.ok).toBe(false)

    const numeric = validateConfig(
      buttonConfig([
        {
          type: 'streamerbot',
          action: 'doAction',
          actionName: 'Number',
          args: { count: 3 },
        } as unknown as StreamerBotAction,
      ]),
    )
    expect(numeric.ok).toBe(false)
  })

  it('rejects unknown streamerbot operations', () => {
    expect(
      validateConfig(
        buttonConfig([
          { type: 'streamerbot', action: 'doActionById', actionName: 'Nope' },
        ] as unknown as StreamerBotAction[]),
      ).ok,
    ).toBe(false)
  })

  it('maps actions to ordered plan steps and clones the argument map', () => {
    const args = { message: 'gg', count: '2' }
    const action: StreamerBotAction = {
      type: 'streamerbot',
      action: 'doAction',
      actionName: 'Countdown',
      args,
    }
    const plan = actionsToPlan([action])
    expect(plan).toEqual([
      { kind: 'streamerbot', action: 'doAction', actionName: 'Countdown', args },
    ])
    const step = plan[0]
    expect(step?.kind).toBe('streamerbot')
    if (step?.kind === 'streamerbot') {
      expect(step.args).not.toBe(args)
    }
  })

  it('describes actions for the editor and logs', () => {
    expect(describeAction({ type: 'streamerbot', action: 'doAction', actionName: 'Test Alert' })).toBe(
      'Streamer.bot "Test Alert"',
    )
    expect(
      describeAction({
        type: 'streamerbot',
        action: 'doAction',
        actionName: 'Stream Starting',
        args: { duration: '60' },
      }),
    ).toBe('Streamer.bot "Stream Starting" (1 arg)')
    const longName = 'A'.repeat(60)
    expect(describeAction({ type: 'streamerbot', action: 'doAction', actionName: longName })).toBe(
      `Streamer.bot "${'A'.repeat(37)}…"`,
    )
  })
})
