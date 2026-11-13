import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultConfig, type Action, type ControlStateMessage } from '@phonedek/shared'
import {
  ControlStateService,
  isLightControl,
  isLightStateButton,
  resolveStateControls,
} from '../src/main/control-state'
import type {
  LightDeviceStatus,
  LightStateReader,
  LightStatusReading,
} from '../src/main/light-source'
import type { LightTarget } from '@phonedek/shared'
import type { ElgatoLightState } from '../src/main/light-client'

class FakeLightReader implements LightStateReader {
  readonly configured = true
  state: ElgatoLightState = { on: true, brightness: 42, temperature: 250 }
  failure: Error | null = null
  reads: Array<{ lightId: string | undefined; target: LightTarget }> = []
  invalidations: Array<string | undefined> = []
  levels: Array<{ lightId: string | undefined; target: LightTarget; value: number }> = []

  async readStatus(lightId: string | undefined, target: LightTarget): Promise<LightStatusReading> {
    this.reads.push({ lightId, target })
    if (this.failure) throw this.failure
    const { on, brightness, temperature } = this.state
    if (target === 'power') {
      return { active: on, value: on ? 1 : 0, available: true, detail: on ? 'ON' : 'OFF' }
    }
    if (target === 'brightness') {
      return {
        active: on,
        value: brightness / 100,
        available: true,
        detail: on ? `${brightness}%` : 'OFF',
      }
    }
    return {
      active: on,
      value: (temperature - 143) / (344 - 143),
      available: true,
      detail: on ? String(temperature) : 'OFF',
    }
  }

  invalidateStatus(lightId?: string): void {
    this.invalidations.push(lightId)
  }

  async setLevel(lightId: string | undefined, target: LightTarget, value: number): Promise<void> {
    this.levels.push({ lightId, target, value })
  }

  async execute(): Promise<void> {}

  async listStatuses(): Promise<LightDeviceStatus[]> {
    return []
  }
}

interface Fixture {
  config: ReturnType<typeof createDefaultConfig>
  profileId: string
  pageId: string
  brightnessId: string
  powerId: string
}

function fixture(): Fixture {
  const config = createDefaultConfig()
  const profile = config.profiles[0]!
  const page = profile.pages[0]!
  const brightness = page.buttons[0]!
  const power = page.buttons[1]!
  delete brightness.state
  brightness.actions = []
  brightness.control = {
    kind: 'slider',
    emit: 'value',
    min: 0,
    max: 100,
    step: 1,
    initial: 50,
    unit: '%',
    binding: { type: 'light', target: 'brightness', light: 'key-1' },
  }
  delete power.control
  power.actions = [
    { type: 'light', action: 'togglePower', light: 'key-1' } as unknown as Action,
  ]
  power.state = { type: 'light', target: 'power', light: 'key-1' }
  return {
    config,
    profileId: profile.id,
    pageId: page.id,
    brightnessId: brightness.id,
    powerId: power.id,
  }
}

const services: ControlStateService[] = []

function createService(reader: LightStateReader): ControlStateService {
  const service = new ControlStateService({ lightReader: reader })
  services.push(service)
  return service
}

afterEach(() => {
  for (const service of services.splice(0)) service.dispose()
})

describe('light control resolution', () => {
  it('recognizes value controls and state tiles', () => {
    const { config } = fixture()
    const page = config.profiles[0]!.pages[0]!
    expect(isLightControl(page.buttons[0]!)).toBe(true)
    expect(isLightStateButton(page.buttons[1]!)).toBe(true)
  })

  it('resolves both the slider and the power tile as light sources', () => {
    const { config, profileId, pageId, brightnessId, powerId } = fixture()
    const controls = resolveStateControls(config, profileId, pageId, [brightnessId, powerId])
    expect(controls).toEqual([
      {
        id: brightnessId,
        label: expect.any(String),
        source: 'light',
        lightId: 'key-1',
        lightTarget: 'brightness',
      },
      {
        id: powerId,
        label: expect.any(String),
        source: 'light',
        lightId: 'key-1',
        lightTarget: 'power',
      },
    ])
  })

  it('honors requested ids and ignores non-light buttons', () => {
    const { config, profileId, pageId, powerId } = fixture()
    const controls = resolveStateControls(config, profileId, pageId, [powerId])
    expect(controls?.map((control) => control.id)).toEqual([powerId])
  })
})

describe('light control state service', () => {
  it('sends active/value/detail for power and brightness with revisions', async () => {
    const { config, profileId, pageId, brightnessId, powerId } = fixture()
    const reader = new FakeLightReader()
    const service = createService(reader)
    const messages: ControlStateMessage[] = []
    const controls = resolveStateControls(
      config,
      profileId,
      pageId,
      [brightnessId, powerId],
    )!

    await service.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [brightnessId, powerId],
      controls,
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(messages).toHaveLength(1)
    const states = messages[0]!.states
    expect(states).toHaveLength(2)
    const brightness = states.find((state) => state.controlId === brightnessId)!
    expect(brightness).toMatchObject({
      available: true,
      active: true,
      value: 0.42,
      detail: '42%',
      revision: 1,
    })
    const power = states.find((state) => state.controlId === powerId)!
    expect(power).toMatchObject({
      available: true,
      active: true,
      value: 1,
      detail: 'ON',
      revision: 1,
    })
  })

  it('groups tiles for the same light and target into one read', async () => {
    const { config, profileId, pageId, brightnessId } = fixture()
    const page = config.profiles[0]!.pages[0]!
    const duplicate = page.buttons[2]!
    duplicate.actions = []
    duplicate.state = { type: 'light', target: 'brightness', light: 'key-1' }
    const reader = new FakeLightReader()
    const service = createService(reader)
    const controls = resolveStateControls(config, profileId, pageId, [brightnessId, duplicate.id])!

    await service.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [brightnessId, duplicate.id],
      controls,
      intervalMs: 1000,
      send: () => undefined,
    })

    expect(reader.reads).toHaveLength(1)
    expect(reader.reads[0]).toEqual({ lightId: 'key-1', target: 'brightness' })
  })

  it('pushes a changed value after a write and bumps the revision', async () => {
    const { config, profileId, pageId, brightnessId } = fixture()
    const reader = new FakeLightReader()
    const service = createService(reader)
    const messages: ControlStateMessage[] = []
    const controls = resolveStateControls(config, profileId, pageId, [brightnessId])!

    await service.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [brightnessId],
      controls,
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    reader.state = { on: true, brightness: 77, temperature: 250 }
    await service.noteLightWritten('key-1')

    const latest = messages.at(-1)!.states[0]!
    expect(latest).toMatchObject({ controlId: brightnessId, value: 0.77, detail: '77%', revision: 2 })
  })

  it('reports an unreachable light as unavailable without throwing', async () => {
    const { config, profileId, pageId, powerId } = fixture()
    const reader = new FakeLightReader()
    reader.failure = new Error(
      'Elgato light at 10.0.0.9:9123 timed out after 3000 ms',
    )
    const service = createService(reader)
    const messages: ControlStateMessage[] = []
    const controls = resolveStateControls(config, profileId, pageId, [powerId])!

    await service.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [powerId],
      controls,
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(messages.at(-1)!.states[0]).toMatchObject({
      controlId: powerId,
      available: false,
      detail: 'OFFLINE',
    })
    expect(messages.at(-1)!.states[0]!.error).toMatch(/timed out/)
  })

  it('reports a missing device as NO LIGHT', async () => {
    const { config, profileId, pageId, powerId } = fixture()
    const reader = new FakeLightReader()
    reader.failure = new Error('Light "key-1" is not configured.')
    const service = createService(reader)
    const messages: ControlStateMessage[] = []
    const controls = resolveStateControls(config, profileId, pageId, [powerId])!

    await service.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [powerId],
      controls,
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })

    expect(messages.at(-1)!.states[0]).toMatchObject({
      available: false,
      detail: 'NO LIGHT',
    })
  })

  it('does not advance revisions when the state is unchanged', async () => {
    const { config, profileId, pageId, brightnessId } = fixture()
    const reader = new FakeLightReader()
    const service = createService(reader)
    const messages: ControlStateMessage[] = []
    const controls = resolveStateControls(config, profileId, pageId, [brightnessId])!

    await service.subscribe('client-1', {
      profileId,
      pageId,
      controlIds: [brightnessId],
      controls,
      intervalMs: 1000,
      send: (message) => messages.push(message),
    })
    await service.noteLightChanged('key-1')
    const changed = messages.filter((message) =>
      message.states.some((state) => state.controlId === brightnessId),
    )
    expect(changed).toHaveLength(1)
  })
})
