import { PROTOCOL_VERSION, type PairPayload } from './types'

/**
 * Pairing URI embedded in the desktop's QR code:
 *   phonedek://pair?host=192.168.1.20&port=47654&token=4821&name=My%20PC&v=1
 *
 * Android registers an intent filter for the `phonedek` scheme so scanning the
 * QR code with the normal camera app opens PhoneDeck and pairs immediately.
 */
export function buildPairUri(payload: PairPayload): string {
  const host = payload.host.trim()
  if (!host || /\s/.test(host)) throw new Error('Pairing host is required')
  if (!Number.isInteger(payload.port) || payload.port < 1 || payload.port > 65535) {
    throw new Error('Pairing port is invalid')
  }
  if (!/^\d{4}$/.test(payload.token)) throw new Error('Pairing PIN must be exactly 4 digits')

  const url = new URL('phonedek://pair')
  url.searchParams.set('host', host)
  url.searchParams.set('port', String(payload.port))
  url.searchParams.set('token', payload.token)
  if (payload.name) url.searchParams.set('name', payload.name)
  url.searchParams.set('v', String(PROTOCOL_VERSION))
  return url.toString()
}

export function parsePairUri(uri: string): PairPayload | null {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  if (url.protocol !== 'phonedek:' || url.hostname !== 'pair') return null

  const host = url.searchParams.get('host')?.trim() ?? ''
  const port = Number(url.searchParams.get('port'))
  const token = url.searchParams.get('token') ?? ''
  const name = url.searchParams.get('name') ?? undefined
  const version = Number(url.searchParams.get('v') ?? PROTOCOL_VERSION)

  if (!host || /\s/.test(host)) return null
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!/^\d{4}$/.test(token)) return null
  if (version !== PROTOCOL_VERSION) return null

  return {
    host,
    port,
    token,
    ...(name ? { name } : {}),
    version: PROTOCOL_VERSION,
  }
}
