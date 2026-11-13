import {
  denormalizeLightValue,
  normalizeLightValue,
  type LightPlanStep,
  type LightTarget,
} from '@phonedek/shared'
import { ElgatoClient, type ElgatoLightState } from './light-client'
import type { Logger } from './logger'
import type { LightDeviceSettings } from './settings-store'

/** Read-only light status for a value control or a state tile. */
export interface LightStatusReading {
  active?: boolean
  /** Normalized 0..1; brightness/temperature/power all map onto it. */
  value?: number
  /** Defaults to true when omitted. */
  available?: boolean
  detail: string
}

export interface LightDeviceStatus {
  id: string
  name: string
  host: string
  port: number
  available: boolean
  state?: ElgatoLightState
  error?: string
}

export interface LightStateReader {
  readonly configured: boolean
  readStatus(lightId: string | undefined, target: LightTarget): Promise<LightStatusReading>
  /** Drop cached reads for one device, or every device when omitted. */
  invalidateStatus(lightId?: string): void
  /** Set a raw device value (brightness 0..100, temperature mired, power 0/100). */
  setLevel(lightId: string | undefined, target: LightTarget, rawValue: number): Promise<void>
  execute(step: LightPlanStep): Promise<void>
  listStatuses(): Promise<LightDeviceStatus[]>
}

export interface LightStateSourceOptions {
  /** Read cache TTL; matches the OBS source's ~900 ms single-flight window. */
  ttlMs?: number
  now?: () => number
  logger?: Logger
  /** Test seam / custom client factory. */
  createClient?: (device: LightDeviceSettings) => ElgatoClient
}

const DEFAULT_TTL_MS = 900

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface CacheEntry {
  state: ElgatoLightState
  at: number
}

/**
 * Cached Elgato reads plus action/level writes for the first local-light
 * provider. It never polls on its own: control-state drives reads only while a
 * light control/tile is watched, and the TTL collapses a page of tiles into a
 * single GET per device.
 */
export class LightStateSource implements LightStateReader {
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly logger?: Logger
  private readonly createClient: (device: LightDeviceSettings) => ElgatoClient
  private devices: LightDeviceSettings[] = []
  private clients = new Map<string, ElgatoClient>()
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, Promise<ElgatoLightState>>()
  private readonly listeners = new Set<(lightId?: string) => void>()

  constructor(options: LightStateSourceOptions = {}) {
    this.ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_TTL_MS)
    this.now = options.now ?? Date.now
    this.logger = options.logger
    this.createClient =
      options.createClient ?? ((device) => new ElgatoClient(device, { timeoutMs: 3000 }))
  }

  get configured(): boolean {
    return this.devices.length > 0
  }

  get deviceCount(): number {
    return this.devices.length
  }

  configure(devices: readonly LightDeviceSettings[]): void {
    this.devices = devices.map((device) => ({ ...device }))
    this.clients = new Map(
      this.devices.map((device) => [device.id, this.createClient(device)]),
    )
    this.cache.clear()
    this.inFlight.clear()
  }

  devicesList(): LightDeviceSettings[] {
    return this.devices.map((device) => ({ ...device }))
  }

  onChange(listener: (lightId?: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async readStatus(lightId: string | undefined, target: LightTarget): Promise<LightStatusReading> {
    const device = this.resolveDevice(lightId)
    const state = await this.readState(device)
    if (target === 'power') {
      return {
        active: state.on,
        value: state.on ? 1 : 0,
        available: true,
        detail: state.on ? 'ON' : 'OFF',
      }
    }
    if (target === 'brightness') {
      return {
        active: state.on,
        value: Math.max(0, Math.min(1, state.brightness / 100)),
        available: true,
        detail: state.on ? `${state.brightness}%` : 'OFF',
      }
    }
    return {
      active: state.on,
      value: normalizeLightValue('temperature', state.temperature),
      available: true,
      detail: state.on ? String(state.temperature) : 'OFF',
    }
  }

  invalidateStatus(lightId?: string): void {
    if (lightId === undefined) this.cache.clear()
    else this.cache.delete(lightId)
  }

  /**
   * Set a raw value from a value control. The router maps the normalized wire
   * value through the control's own min/max first.
   */
  async setLevel(
    lightId: string | undefined,
    target: LightTarget,
    rawValue: number,
  ): Promise<void> {
    const device = this.resolveDevice(lightId)
    const client = this.requireClient(device.id)
    const state = await client.setTarget(target, rawValue)
    this.remember(device.id, state)
    this.notify(device.id)
  }

  /** Apply a normalized 0..1 value using the shared light defaults. */
  async setNormalizedLevel(
    lightId: string | undefined,
    target: LightTarget,
    value: number,
  ): Promise<void> {
    await this.setLevel(lightId, target, denormalizeLightValue(target, value))
  }

  async setPower(lightId: string | undefined, on: boolean): Promise<void> {
    await this.setLevel(lightId, 'power', on ? 100 : 0)
  }

  async togglePower(lightId: string | undefined): Promise<boolean> {
    const device = this.resolveDevice(lightId)
    // Re-read (or reuse a <900 ms cache entry) so a toggle never acts on a
    // value invented by the phone.
    this.invalidateStatus(device.id)
    const state = await this.readState(device)
    await this.setPower(device.id, !state.on)
    return !state.on
  }

  async execute(step: LightPlanStep): Promise<void> {
    switch (step.action) {
      case 'setPower':
        await this.setPower(step.light, step.on)
        break
      case 'togglePower':
        await this.togglePower(step.light)
        break
    }
  }

  async listStatuses(): Promise<LightDeviceStatus[]> {
    return Promise.all(
      this.devices.map(async (device) => {
        try {
          const state = await this.readState(device)
          return {
            id: device.id,
            name: device.name,
            host: device.host,
            port: device.port,
            available: true,
            state,
          }
        } catch (error) {
          return {
            id: device.id,
            name: device.name,
            host: device.host,
            port: device.port,
            available: false,
            error: message(error).slice(0, 200),
          }
        }
      }),
    )
  }

  dispose(): void {
    this.listeners.clear()
    this.cache.clear()
    this.inFlight.clear()
    this.clients.clear()
    this.devices = []
  }

  private resolveDevice(lightId: string | undefined): LightDeviceSettings {
    if (this.devices.length === 0) throw new Error('No lights are configured.')
    if (!lightId) return this.devices[0]!
    const device = this.devices.find((item) => item.id === lightId)
    if (!device) throw new Error(`Light "${lightId}" is not configured.`)
    return device
  }

  private requireClient(id: string): ElgatoClient {
    const client = this.clients.get(id)
    if (!client) throw new Error(`Light "${id}" is not configured.`)
    return client
  }

  private remember(id: string, state: ElgatoLightState): void {
    this.cache.set(id, { state, at: this.now() })
  }

  private async readState(device: LightDeviceSettings): Promise<ElgatoLightState> {
    const cached = this.cache.get(device.id)
    if (cached && this.now() - cached.at < this.ttlMs) return cached.state
    const pending = this.inFlight.get(device.id)
    if (pending) return pending

    const run = (async (): Promise<ElgatoLightState> => {
      try {
        const state = await this.requireClient(device.id).getState()
        this.remember(device.id, state)
        return state
      } catch (error) {
        this.logger?.warn(`Elgato read failed for ${device.name}: ${message(error)}`)
        throw error
      } finally {
        this.inFlight.delete(device.id)
      }
    })()
    this.inFlight.set(device.id, run)
    return run
  }

  private notify(lightId?: string): void {
    for (const listener of this.listeners) {
      try {
        listener(lightId)
      } catch (error) {
        this.logger?.warn(`Light change listener failed: ${message(error)}`)
      }
    }
  }
}
