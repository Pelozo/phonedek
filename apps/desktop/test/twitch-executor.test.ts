import { describe, expect, it } from 'vitest'
import type { ExecutableAction, KeyboardPlanStep, TwitchPlanStep } from '@phonedek/shared'
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

describe('ActionExecutor Twitch routing', () => {
  it('executes Twitch plan steps in order through the host hook', async () => {
    const log: TwitchPlanStep[] = []
    const host: HostActions = {
      ...baseHost(),
      async runTwitchAction(step) {
        log.push(step)
      },
    }
    const executor = new ActionExecutor(fakeKeys(), host)
    const actions: ExecutableAction[] = [
      { type: 'twitch', action: 'sendChat', message: 'gg' },
      { type: 'delay', ms: 1 },
      { type: 'twitch', action: 'createMarker', description: 'clutch' },
      { type: 'twitch', action: 'setTitle', title: 'New title' },
      { type: 'twitch', action: 'setGame', game: 'Fortnite' },
    ]

    await expect(executor.execute(actions, 'Twitch')).resolves.toEqual({ ok: true })
    expect(log).toEqual([
      { kind: 'twitch', action: 'sendChat', message: 'gg' },
      { kind: 'twitch', action: 'createMarker', description: 'clutch' },
      { kind: 'twitch', action: 'setTitle', title: 'New title' },
      { kind: 'twitch', action: 'setGame', game: 'Fortnite' },
    ])
  })

  it('returns a clear error when Twitch is not wired and keeps the queue alive', async () => {
    const executor = new ActionExecutor(fakeKeys(), baseHost())
    await expect(
      executor.execute([{ type: 'twitch', action: 'sendChat', message: 'gg' }], 'Twitch'),
    ).resolves.toEqual({ ok: false, error: 'Twitch is not available on this desktop.' })
    await expect(
      executor.execute([{ type: 'twitch', action: 'createMarker' }], 'Twitch'),
    ).resolves.toMatchObject({ ok: false, error: /not available/ })
  })

  it('propagates host errors to the press result', async () => {
    const host: HostActions = {
      ...baseHost(),
      async runTwitchAction() {
        throw new Error('Twitch is not connected.')
      },
    }
    const executor = new ActionExecutor(fakeKeys(), host)
    await expect(
      executor.execute([{ type: 'twitch', action: 'sendChat', message: 'gg' }], 'Twitch'),
    ).resolves.toEqual({ ok: false, error: 'Twitch is not connected.' })
  })
})
