import { describe, expect, it } from 'vitest'
import { buildPairUri, parsePairUri } from '../src/pairing'
import { encodeBeacon, encodeProbe, isProbe, parseBeacon } from '../src/discovery'

describe('pairing URI', () => {
  it('round-trips a payload', () => {
    const payload = {
      host: '192.168.1.25',
      port: 47654,
      token: 'abc123',
      name: 'Gaming PC',
      version: 1 as const,
    }
    expect(parsePairUri(buildPairUri(payload))).toEqual(payload)
  })

  it('rejects other schemes and invalid ports', () => {
    expect(parsePairUri('https://example.com')).toBeNull()
    expect(parsePairUri('phonedek://pair?host=x&port=0&token=a&v=1')).toBeNull()
    expect(parsePairUri('not a url')).toBeNull()
  })
})

describe('discovery', () => {
  it('round-trips beacons', () => {
    const raw = encodeBeacon({ name: 'Desk', port: 47654, version: '0.1.0' })
    expect(parseBeacon(raw)).toMatchObject({ name: 'Desk', port: 47654, type: 'beacon' })
  })

  it('ignores foreign or malformed datagrams', () => {
    expect(parseBeacon('hello')).toBeNull()
    expect(parseBeacon(JSON.stringify({ magic: 'OTHER' }))).toBeNull()
    expect(parseBeacon(JSON.stringify({ magic: 'PHONEDECK', type: 'beacon', protocol: 1, name: '', port: 1, version: 'x' }))).toBeNull()
  })

  it('recognizes probes', () => {
    expect(isProbe(encodeProbe())).toBe(true)
    expect(isProbe('{}')).toBe(false)
  })
})
