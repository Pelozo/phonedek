import { describe, expect, it } from 'vitest'
import type { KeyboardPlanStep, StreamerBotAction, StreamerBotPlanStep } from '@phonedek/shared'
import { ActionExecutor } from '../src/main/executor'
import type { HostActions } from '../src/main/host-actions'
import type { KeySender } from '../src/main/key-sender'

function fakeKeys(): KeySender {
  return {
    async send(_step: KeyboardPlanStep) {
      // not used
    },
  }
}

function baseHost(): HostActions {
  return {
    async launch() {},
    async openUrl() {},
    async runCommand() {},
    async screenshot() {
      return '/tmp/shot.png'
    },
    async setVolume() {},
    async setInputGain() {},
    async toggleInputMute() {},
  }
}

describe('ActionExecutor Streamer.bot routing', () => {
  it('executes Streamer.bot steps in order through the host hook', async () => {
    const log: StreamerBotPlanStep[] = []
    const host: HostActions = {
      ...baseHost(),
      async runStreamerBotAction(step) {
        log.push(step)
      },
    }
    const executor = new ActionExecutor(fakeKeys(), host)
    const actions: StreamerBotAction[] = [
      { type: 'streamerbot', action: 'doAction', actionName: 'Test Alert' },
      {
        type: 'streamerbot',
        action: 'doAction',
        actionName: 'Stream Starting',
        args: { duration: '60' },
      },
    ]

    await expect(executor.execute(actions, 'Streamer.bot')).resolves.toEqual({ ok: true })
    expect(log).toEqual([
      { kind: 'streamerbot', action: 'doAction', actionName: 'Test Alert' },
      {
        kind: 'streamerbot',
        action: 'doAction',
        actionName: 'Stream Starting',
        args: { duration: '60' },
      },
    ])
  })

  it('returns a clear error when Streamer.bot is not wired', async () => {
    const executor = new ActionExecutor(fakeKeys(), baseHost())
    await expect(
      executor.execute(
        [{ type: 'streamerbot', action: 'doAction', actionName: 'Test Alert' }],
        'Streamer.bot',
      ),
    ).resolves.toEqual({
      ok: false,
      error: 'Streamer.bot is not available on this desktop.',
    })
  })

  it('propagates connection and request errors to the press result', async () => {
    const host: HostActions = {
      ...baseHost(),
      async runStreamerBotAction() {
        throw new Error('Streamer.bot is not connected.')
      },
    }
    const executor = new ActionExecutor(fakeKeys(), host)
    await expect(
      executor.execute(
        [{ type: 'streamerbot', action: 'doAction', actionName: 'Test Alert' }],
        'Streamer.bot',
      ),
    ).resolves.toEqual({ ok: false, error: 'Streamer.bot is not connected.' })
  })
})
