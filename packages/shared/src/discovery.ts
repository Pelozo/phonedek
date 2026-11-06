import {
  DISCOVERY_MAGIC,
  DISCOVERY_PORT,
  PROTOCOL_VERSION,
  type DiscoverProbe,
  type DiscoveryBeacon,
} from './types'

export function encodeBeacon(beacon: Omit<DiscoveryBeacon, 'magic' | 'protocol' | 'type'>): string {
  const payload: DiscoveryBeacon = {
    magic: DISCOVERY_MAGIC,
    protocol: PROTOCOL_VERSION,
    type: 'beacon',
    name: beacon.name,
    port: beacon.port,
    version: beacon.version,
  }
  return JSON.stringify(payload)
}

export function parseBeacon(input: string): DiscoveryBeacon | null {
  try {
    const value = JSON.parse(input) as Partial<DiscoveryBeacon>
    if (value.magic !== DISCOVERY_MAGIC || value.type !== 'beacon') return null
    if (value.protocol !== PROTOCOL_VERSION) return null
    if (typeof value.name !== 'string' || !value.name) return null
    if (typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) return null
    if (typeof value.version !== 'string') return null
    return {
      magic: DISCOVERY_MAGIC,
      protocol: PROTOCOL_VERSION,
      type: 'beacon',
      name: value.name,
      port: value.port,
      version: value.version,
    }
  } catch {
    return null
  }
}

export function encodeProbe(): string {
  const probe: DiscoverProbe = {
    magic: DISCOVERY_MAGIC,
    protocol: PROTOCOL_VERSION,
    type: 'discover',
  }
  return JSON.stringify(probe)
}

export function isProbe(input: string): boolean {
  try {
    const value = JSON.parse(input) as Partial<DiscoverProbe>
    return (
      value.magic === DISCOVERY_MAGIC &&
      value.type === 'discover' &&
      value.protocol === PROTOCOL_VERSION
    )
  } catch {
    return false
  }
}

export { DISCOVERY_PORT }
