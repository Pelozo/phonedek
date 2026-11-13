import { describe, expect, it } from 'vitest'
import type { KeyboardPlanStep, LightPlanStep, PlannableAction } from '@phonedek/shared'
import { LIGHT_CAPABILITY } from '@phonedek/shared'
import { ActionExecutor } from '../src/main/executor'
import type { HostActions } from '../src/main/host-actions'
import type { KeySender } from '../src/main/key-sender'
import { serverCapabilities } from '../src/main/server'

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

describe('ActionExecutor light routing', () => {
  it('executes setPower and togglePower through the host hook', async () => {
    const log: LightPlanStep[] = []
    const host: HostActions = {
      ...baseHost(),
      async runLightAction(step) {
        log.push(step)
      },
    }
    const executor = new ActionExecutor(fakeKeys(), host)
    const actions: PlannableAction[] = [
      { type: 'light', action: 'setPower', on: true },
      { type: 'delay', ms: 1 },
      { type: 'light', action: 'togglePower', light: 'key-1' },
    ]

    await expect(executor.execute(actions, 'Lights')).resolves.toEqual({ ok: true })
    expect(log).toEqual([
      { kind: 'light', action: 'setPower', on: true },
      { kind: 'light', action: 'togglePower', light: 'key-1' },
    ])
  })

  it('returns a clear error when lights are not wired', async () => {
    const executor = new ActionExecutor(fakeKeys(), baseHost())
    await expect(
      executor.execute([{ type: 'light', action: 'togglePower' }], 'Lights'),
    ).resolves.toEqual({ ok: false, error: 'Local lights are not available on this desktop.' })
  })

  it('propagates host errors to the press result and keeps the queue alive', async () => {
    const host: HostActions = {
      ...baseHost(),
      async runLightAction() {
        throw new Error('Elgato light at 10.0.0.9:9123 timed out after 3000 ms')
      },
    }
    const executor = new ActionExecutor(fakeKeys(), host)
    await expect(
      executor.execute([{ type: 'light', action: 'setPower', on: true }], 'Lights'),
    ).resolves.toMatchObject({ ok: false, error: /timed out/ })
    await expect(
      executor.execute([{ type: 'light', action: 'togglePower' }], 'Lights'),
    ).resolves.toMatchObject({ ok: false, error: /timed out/ })
  })
})

describe('light-v1 capability', () => {
  it('is advertised only when a light is configured', () => {
    expect(serverCapabilities(true, true, false, false, false)).not.toContain(LIGHT_CAPABILITY)
    expect(serverCapabilities(true, true, false, false, true)).toContain(LIGHT_CAPABILITY)
  })

  it('stays additive alongside existing capabilities', () => {
    const capabilities = serverCapabilities(true, true, true, true, true)
    expect(capabilities).toContain('obs-v1')
    expect(capabilities).toContain('twitch-v1')
    expect(capabilities).toContain('control-state-v1')
    expect(capabilities).toContain(LIGHT_CAPABILITY)
  })
})
