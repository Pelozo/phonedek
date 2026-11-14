import { describe, expect, it } from 'vitest'
import type { AppVolumePlanStep, ControlSpec } from '@phonedek/shared'
import { MIXER_CAPABILITY } from '@phonedek/shared'
import { ActionExecutor } from '../src/main/executor'
import { ControlInputRouter } from '../src/main/control-input'
import { serverCapabilities } from '../src/main/server'
import type { HostActions } from '../src/main/host-actions'
import type { KeySender } from '../src/main/key-sender'

function fakeKeys(): KeySender {
  return {
    async send() {
      throw new Error('the keyboard queue must not run app volume values')
    },
  }
}

function fakeHost(log: string[], withAppVolume = true): HostActions {
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
    ...(withAppVolume
      ? {
          async runAppVolumeAction(step: AppVolumePlanStep) {
            log.push(
              step.action === 'setMute'
                ? `mute:${step.match.process}:${step.muted}`
                : `toggle:${step.match.process}`,
            )
          },
        }
      : {}),
  }
}

describe('ActionExecutor app volume actions', () => {
  it('routes setMute and toggleMute plan steps through the host hook', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(), fakeHost(log))
    await expect(
      executor.execute([
        { type: 'appVolume', action: 'setMute', match: { process: 'discord' }, muted: true },
        { type: 'appVolume', action: 'toggleMute', match: { process: 'spotify' } },
      ]),
    ).resolves.toEqual({ ok: true })
    expect(log).toEqual(['mute:discord:true', 'toggle:spotify'])
  })

  it('returns a clear error when no mixer is wired', async () => {
    const executor = new ActionExecutor(fakeKeys(), fakeHost([], false))
    await expect(
      executor.execute([
        { type: 'appVolume', action: 'toggleMute', match: { process: 'discord' } },
      ]),
    ).resolves.toEqual({
      ok: false,
      error: 'Per-app audio is not available on this desktop.',
    })
  })

  it('advertises mixer-v1 only when supported', () => {
    expect(
      serverCapabilities(true, true, false, false, false, false, true),
    ).toContain(MIXER_CAPABILITY)
    expect(
      serverCapabilities(true, true, false, false, false, false, false),
    ).not.toContain(MIXER_CAPABILITY)
    expect(
      serverCapabilities(false, false, false, false, false, false, true),
    ).toContain(MIXER_CAPABILITY)
  })
})

describe('ControlInputRouter app volume values', () => {
  const control: ControlSpec = {
    kind: 'slider',
    emit: 'value',
    binding: { type: 'appVolume', target: 'volume', match: { process: 'discord' } },
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  }

  it('writes the absolute value directly, never through the keyboard queue', async () => {
    const applied: Array<{ value: number; label: string }> = []
    const router = new ControlInputRouter({
      execute: async () => {
        throw new Error('execute must not be called')
      },
      applyAbsolute: async (_control, value, label) => {
        applied.push({ value, label })
        return { ok: true }
      },
      flushMs: 1,
    })

    await router.handle(
      {
        type: 'input',
        requestId: 'r1',
        profileId: 'p1',
        pageId: 'pg1',
        controlId: 'c1',
        phase: 'start',
      },
      { control, label: 'Discord' },
    )
    await router.handle(
      {
        type: 'input',
        requestId: 'r1',
        profileId: 'p1',
        pageId: 'pg1',
        controlId: 'c1',
        phase: 'move',
        value: 0.1,
      },
      { control, label: 'Discord' },
    )
    await router.handle(
      {
        type: 'input',
        requestId: 'r1',
        profileId: 'p1',
        pageId: 'pg1',
        controlId: 'c1',
        phase: 'move',
        value: 0.42,
      },
      { control, label: 'Discord' },
    )
    await expect(
      router.handle(
        {
          type: 'input',
          requestId: 'r1',
          profileId: 'p1',
          pageId: 'pg1',
          controlId: 'c1',
          phase: 'end',
          value: 0.42,
        },
        { control, label: 'Discord' },
      ),
    ).resolves.toEqual({ ok: true })

    expect(applied.at(-1)).toEqual({ value: 0.42, label: 'Discord' })
    await router.dispose()
  })

  it('rejects app volume when the desktop has no mixer', async () => {
    const router = new ControlInputRouter({
      execute: async () => ({ ok: true }),
      flushMs: 1,
    })
    await expect(
      router.handle(
        {
          type: 'input',
          requestId: 'r1',
          profileId: 'p1',
          pageId: 'pg1',
          controlId: 'c1',
          phase: 'start',
        },
        { control, label: 'Discord' },
      ),
    ).resolves.toEqual({
      ok: false,
      error: 'Per-app volume is not available on this desktop.',
    })
    await router.dispose()
  })
})
