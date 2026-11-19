import { describe, expect, it } from 'vitest'
import type {
  AudioDeviceAction,
  AudioDevicePlanStep,
  AudioDeviceRef,
} from '@phonedek/shared'
import { ActionExecutor } from '../src/main/executor'
import { createHostActions } from '../src/main/host-actions'
import type { HostActions } from '../src/main/host-actions'
import type { KeySender } from '../src/main/key-sender'

const headphones: AudioDeviceRef = {
  id: 'a1b2c3d4e5f6',
  name: 'Headphones (HyperX Cloud II)',
}
const speakers: AudioDeviceRef = {
  id: '0a1b2c3d4e5f',
  name: 'Speakers (Realtek(R) Audio)',
}
const usbMic: AudioDeviceRef = {
  id: '9f8e7d6c5b4a',
  name: 'Shure MV7',
}

function fakeKeys(): KeySender {
  return {
    async send() {
      throw new Error('the keyboard queue must not run audio device actions')
    },
  }
}

function fakeHost(log: string[], withAudioDevice = true): HostActions {
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
    ...(withAudioDevice
      ? {
          async runAudioDeviceAction(step: AudioDevicePlanStep) {
            if (step.action === 'cycle') {
              log.push(`cycle:${step.deviceKind}:${step.devices.length}:${step.allRoles}`)
              return
            }
            log.push(
              `set:${step.deviceKind}:${step.device.name ?? step.device.id}:${step.allRoles}`,
            )
          },
        }
      : {}),
  }
}

describe('ActionExecutor audio device actions', () => {
  it('routes set and cycle steps through the host hook in order', async () => {
    const log: string[] = []
    const executor = new ActionExecutor(fakeKeys(), fakeHost(log))
    const actions: AudioDeviceAction[] = [
      { type: 'audioDevice', action: 'set', kind: 'output', device: headphones },
      { type: 'audioDevice', action: 'set', kind: 'input', device: usbMic, allRoles: true },
      {
        type: 'audioDevice',
        action: 'cycle',
        kind: 'output',
        devices: [headphones, speakers],
        allRoles: false,
      },
    ]

    await expect(executor.execute(actions, 'headset')).resolves.toEqual({ ok: true })
    expect(log).toEqual([
      'set:output:Headphones (HyperX Cloud II):undefined',
      'set:input:Shure MV7:true',
      'cycle:output:2:false',
    ])
  })

  it('returns a clear error when no audio controller is wired', async () => {
    const executor = new ActionExecutor(fakeKeys(), fakeHost([], false))
    await expect(
      executor.execute([
        { type: 'audioDevice', action: 'set', kind: 'output', device: headphones },
      ]),
    ).resolves.toEqual({
      ok: false,
      error: 'Audio device switching is not available on this desktop.',
    })
  })

  it('turns a host failure into a user-facing press error and keeps the queue alive', async () => {
    const log: string[] = []
    const host = fakeHost(log)
    host.runAudioDeviceAction = async () => {
      throw new Error('Device not found: Speakers')
    }
    const executor = new ActionExecutor(fakeKeys(), host)

    const failed = await executor.execute(
      [{ type: 'audioDevice', action: 'set', kind: 'output', device: speakers }],
      'speakers',
    )
    expect(failed).toEqual({ ok: false, error: 'Device not found: Speakers' })

    host.runAudioDeviceAction = async (step) => {
      log.push(`ok:${step.action}`)
    }
    await expect(
      executor.execute([
        { type: 'audioDevice', action: 'set', kind: 'output', device: headphones },
      ]),
    ).resolves.toEqual({ ok: true })
    expect(log).toEqual(['ok:set'])
  })

  it('wires the host-action test seam only when a callback is provided', async () => {
    const steps: AudioDevicePlanStep[] = []
    const host = createHostActions({
      platform: 'linux',
      runAudioDeviceAction: async (step) => {
        steps.push(step)
      },
    })
    await host.runAudioDeviceAction?.({
      kind: 'audioDevice',
      action: 'set',
      deviceKind: 'output',
      device: headphones,
    })
    expect(steps).toHaveLength(1)

    const bare = createHostActions({ platform: 'linux' })
    expect(bare.runAudioDeviceAction).toBeUndefined()
  })
})
