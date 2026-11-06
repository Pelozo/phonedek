import { networkInterfaces } from 'node:os'
import type { PairPayload } from '@phonedek/shared'
import { PROTOCOL_VERSION } from '@phonedek/shared'

export interface LanAddress {
  name: string
  address: string
  netmask: string
  broadcast: string | null
}

function ipv4ToNumber(ip: string): number {
  return ip.split('.').reduce((value, part) => ((value << 8) | (Number(part) & 255)) >>> 0, 0)
}

function numberToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.')
}

export function broadcastFor(address: string, netmask: string): string | null {
  try {
    const ip = ipv4ToNumber(address)
    const mask = ipv4ToNumber(netmask)
    if (!mask) return null
    return numberToIpv4((ip & mask) | (~mask >>> 0))
  } catch {
    return null
  }
}

export function lanAddresses(): LanAddress[] {
  const result: LanAddress[] = []
  for (const [name, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      // Ignore link-local addresses.
      if (info.address.startsWith('169.254.')) continue
      result.push({
        name,
        address: info.address,
        netmask: info.netmask,
        broadcast: broadcastFor(info.address, info.netmask),
      })
    }
  }
  return result
}

/** Prefer a normal private LAN address, then anything non-loopback. */
export function primaryLanAddress(): string | null {
  const addresses = lanAddresses()
  const preferred =
    addresses.find((item) => item.address.startsWith('192.168.')) ??
    addresses.find((item) => item.address.startsWith('10.')) ??
    addresses.find((item) => /^172\.(1[6-9]|2[0-9]|3[01])\./.test(item.address)) ??
    addresses.find((item) => !item.address.startsWith('127.'))
  return preferred?.address ?? addresses[0]?.address ?? null
}

export function urlsForPort(port: number): string[] {
  const lan = lanAddresses().map((item) => `http://${item.address}:${port}`)
  return [`http://127.0.0.1:${port}`, ...lan]
}

export function pairPayload(host: string, port: number, token: string, name: string): PairPayload {
  return {
    host,
    port,
    token,
    name,
    version: PROTOCOL_VERSION,
  }
}
