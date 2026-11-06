import QRCode from 'qrcode'
import type { PairPayload } from '@phonedek/shared'
import { buildPairUri } from '@phonedek/shared'
import { pairPayload, primaryLanAddress } from './lan'

export interface PairInfo {
  host: string
  port: number
  token: string
  name: string
  uri: string
  qrDataUrl: string
  urls: string[]
}

export async function createPairInfo(
  token: string,
  port: number,
  name: string,
  hostOverride?: string,
): Promise<PairInfo> {
  const host = hostOverride ?? primaryLanAddress() ?? '127.0.0.1'
  const payload: PairPayload = pairPayload(host, port, token, name)
  const uri = buildPairUri(payload)
  const qrDataUrl = await QRCode.toDataURL(uri, {
    width: 360,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#0b1220', light: '#ffffff' },
  })
  return { host, port, token, name, uri, qrDataUrl, urls: [] }
}
