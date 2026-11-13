import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretStore, type SafeStorageLike } from '../src/main/secret-store'
import { TwitchAuth, TWITCH_SECRET_KEY, type TwitchTokens } from '../src/main/twitch-auth'
import type { Logger } from '../src/main/logger'

interface Recorded {
  method: string
  path: string
  headers: IncomingMessage['headers']
  form: URLSearchParams
}

interface FakeServer {
  baseUrl: string
  requests: Recorded[]
  close: () => Promise<void>
}

type Handler = (request: Recorded, response: ServerResponse) => void

async function fakeServer(handler: Handler): Promise<FakeServer> {
  const requests: Recorded[] = []
  const server: Server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const recorded: Recorded = {
        method: request.method ?? 'GET',
        path: url.pathname,
        headers: request.headers,
        form: new URLSearchParams(body),
      }
      requests.push(recorded)
      handler(recorded, response)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/oauth2`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}

function fakeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer) => {
      const text = buffer.toString('utf8')
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext')
      return text.slice(4)
    },
  }
}

function logger(): Logger & { warnings: string[] } {
  const warnings: string[] = []
  return {
    logPath: null,
    warnings,
    info: () => undefined,
    warn: (message) => warnings.push(message),
    error: () => undefined,
  }
}

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

function secretStore(): SecretStore {
  const created = new SecretStore({
    dir: mkdtempSync(join(tmpdir(), 'phonedek-twitch-')),
    safeStorage: fakeSafeStorage(),
  })
  cleanups.push(() => undefined)
  return created
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for condition')
}

describe('TwitchAuth device flow', () => {
  it('starts DCF, polls authorization_pending, stores the rotated bundle and validates', async () => {
    let polls = 0
    const server = await fakeServer((request, response) => {
      if (request.path.endsWith('/device')) {
        json(response, 200, {
          device_code: 'device-1',
          user_code: 'ABCDEFGH',
          verification_uri: 'https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH',
          expires_in: 60,
          interval: 0,
        })
        return
      }
      if (request.path.endsWith('/token')) {
        if (request.form.get('grant_type') === 'refresh_token') {
          json(response, 200, {
            access_token: 'refreshed-access',
            refresh_token: 'refreshed-refresh',
            expires_in: 14400,
            scope: ['channel:manage:broadcast', 'user:write:chat'],
          })
          return
        }
        polls += 1
        if (polls === 1) {
          json(response, 400, { status: 400, message: 'authorization_pending' })
          return
        }
        json(response, 200, {
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 14400,
          scope: ['channel:manage:broadcast', 'user:write:chat'],
        })
        return
      }
      if (request.path.endsWith('/validate')) {
        json(response, 200, {
          client_id: 'clientid',
          login: 'streamer',
          scopes: ['channel:manage:broadcast', 'user:write:chat'],
          user_id: '42',
          expires_in: 14390,
        })
        return
      }
      json(response, 404, {})
    })
    cleanups.push(server.close)
    const store = secretStore()
    const log = logger()
    const auth = new TwitchAuth({
      clientId: 'clientid',
      enabled: true,
      store,
      authBaseUrl: server.baseUrl,
      pollIntervalMs: 5,
      logger: log,
    })
    cleanups.push(() => auth.dispose())

    const device = await auth.startDeviceFlow()
    expect(device).toMatchObject({
      userCode: 'ABCDEFGH',
      verificationUri: 'https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH',
    })
    expect(auth.status.state).toBe('authorizing')
    expect(auth.status.device?.userCode).toBe('ABCDEFGH')

    const deviceRequest = server.requests.find((request) => request.path.endsWith('/device'))!
    expect(deviceRequest.form.get('client_id')).toBe('clientid')
    expect(deviceRequest.form.get('scopes')).toBe('channel:manage:broadcast user:write:chat')

    await waitFor(() => auth.status.state === 'authorized' && auth.status.login === 'streamer')
    expect(auth.connected).toBe(true)
    expect(auth.status.login).toBe('streamer')
    expect(auth.status.userId).toBe('42')
    expect(store.get(TWITCH_SECRET_KEY)).toContain('access-1')
    expect(JSON.parse(store.get(TWITCH_SECRET_KEY)!)).toMatchObject({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    })

    const tokenRequests = server.requests.filter(
      (request) => request.path.endsWith('/token') && request.form.get('grant_type') !== 'refresh_token',
    )
    expect(tokenRequests.length).toBeGreaterThanOrEqual(2)
    expect(tokenRequests[0]!.form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code')
    expect(tokenRequests[0]!.form.get('device_code')).toBe('device-1')
    expect(log.warnings).toEqual([])
  })

  it('handles slow_down, expired codes and denied authorization', async () => {
    let mode: 'slow' | 'expired' | 'denied' = 'slow'
    let polls = 0
    const server = await fakeServer((request, response) => {
      if (request.path.endsWith('/device')) {
        json(response, 200, {
          device_code: 'device-2',
          user_code: 'CODE',
          verification_uri: 'https://twitch.tv/activate',
          expires_in: 60,
          interval: 0,
        })
        return
      }
      if (request.path.endsWith('/token')) {
        polls += 1
        if (mode === 'slow') {
          if (polls === 1) json(response, 400, { status: 400, message: 'slow_down' })
          else json(response, 400, { status: 400, message: 'authorization_pending' })
          return
        }
        if (mode === 'expired') {
          json(response, 400, { status: 400, message: 'expired_token' })
          return
        }
        json(response, 400, { status: 400, message: 'access_denied' })
        return
      }
      json(response, 200, { user_id: '42', login: 'streamer', scopes: [] })
    })
    cleanups.push(server.close)
    const auth = new TwitchAuth({
      clientId: 'clientid',
      enabled: true,
      store: secretStore(),
      authBaseUrl: server.baseUrl,
      pollIntervalMs: 5,
    })
    cleanups.push(() => auth.dispose())

    await auth.startDeviceFlow()
    await waitFor(() => auth.status.device?.intervalMs === 5005)
    expect(auth.status.state).toBe('authorizing')
    auth.cancelDeviceFlow()
    expect(auth.status.state).toBe('unauthorized')

    mode = 'expired'
    await auth.startDeviceFlow()
    await waitFor(() => auth.status.state === 'unauthorized')
    expect(auth.status.lastError).toMatch(/expired/i)

    mode = 'denied'
    await auth.startDeviceFlow()
    await waitFor(() => auth.status.state === 'unauthorized')
    expect(auth.status.lastError).toMatch(/denied/i)
  })

  it('reports missing client IDs and supports cancel/disconnect', async () => {
    const auth = new TwitchAuth({ clientId: '', enabled: true, store: secretStore() })
    cleanups.push(() => auth.dispose())
    await expect(auth.startDeviceFlow()).rejects.toThrow(/Client ID/)
    expect(auth.connected).toBe(false)

    const server = await fakeServer((request, response) => {
      json(response, 200, {
        device_code: 'device-3',
        user_code: 'CODE',
        verification_uri: 'https://twitch.tv/activate',
        expires_in: 60,
        interval: 0,
      })
    })
    cleanups.push(server.close)
    const configured = new TwitchAuth({
      clientId: 'clientid',
      enabled: true,
      store: secretStore(),
      authBaseUrl: server.baseUrl,
      pollIntervalMs: 5,
    })
    cleanups.push(() => configured.dispose())
    await configured.startDeviceFlow()
    configured.cancelDeviceFlow()
    expect(configured.status.state).toBe('unauthorized')
    expect(configured.status.device).toBeUndefined()
  })
})

describe('TwitchAuth tokens', () => {
  function expiredBundle(): TwitchTokens {
    return {
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() - 1000,
      scopes: ['channel:manage:broadcast', 'user:write:chat'],
    }
  }

  it('refreshes single-flight, persists the rotated refresh token and validates the account on start', async () => {
    let refreshCalls = 0
    const server = await fakeServer((request, response) => {
      if (request.path.endsWith('/token')) {
        refreshCalls += 1
        json(response, 200, {
          access_token: `new-access-${refreshCalls}`,
          refresh_token: `new-refresh-${refreshCalls}`,
          expires_in: 14400,
          scope: ['channel:manage:broadcast', 'user:write:chat'],
        })
        return
      }
      if (request.path.endsWith('/validate')) {
        if (request.headers.authorization !== 'OAuth new-access-1') {
          json(response, 401, { status: 401, message: 'invalid access token' })
          return
        }
        json(response, 200, {
          user_id: '42',
          login: 'streamer',
          scopes: ['channel:manage:broadcast', 'user:write:chat'],
          expires_in: 14390,
        })
        return
      }
      json(response, 404, {})
    })
    cleanups.push(server.close)
    const store = secretStore()
    store.set(TWITCH_SECRET_KEY, JSON.stringify(expiredBundle()))
    const auth = new TwitchAuth({
      clientId: 'clientid',
      enabled: true,
      store,
      authBaseUrl: server.baseUrl,
    })
    cleanups.push(() => auth.dispose())

    const [first, second] = await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
    ])
    expect(first).toBe('new-access-1')
    expect(second).toBe('new-access-1')
    expect(refreshCalls).toBe(1)
    expect(JSON.parse(store.get(TWITCH_SECRET_KEY)!)).toMatchObject({
      accessToken: 'new-access-1',
      refreshToken: 'new-refresh-1',
    })

    await auth.start()
    expect(auth.status.state).toBe('authorized')
    expect(auth.status.login).toBe('streamer')

    const refreshRequest = server.requests.find((request) => request.path.endsWith('/token'))!
    expect(refreshRequest.form.get('grant_type')).toBe('refresh_token')
    expect(refreshRequest.form.get('refresh_token')).toBe('old-refresh')
    expect(refreshRequest.form.get('client_id')).toBe('clientid')
  })

  it('clears the store and requires reconnection when refresh fails', async () => {
    const server = await fakeServer((request, response) => {
      json(response, 400, { status: 400, message: 'Invalid refresh token' })
    })
    cleanups.push(server.close)
    const store = secretStore()
    store.set(TWITCH_SECRET_KEY, JSON.stringify(expiredBundle()))
    const auth = new TwitchAuth({
      clientId: 'clientid',
      enabled: true,
      store,
      authBaseUrl: server.baseUrl,
    })
    cleanups.push(() => auth.dispose())

    await expect(auth.getAccessToken()).rejects.toThrow(/expired/i)
    expect(auth.status.state).toBe('unauthorized')
    expect(auth.status.lastError).toMatch(/expired/i)
    expect(store.get(TWITCH_SECRET_KEY)).toBeNull()
  })

  it('disconnect and client-ID changes drop stored tokens', () => {
    const store = secretStore()
    store.set(TWITCH_SECRET_KEY, JSON.stringify(expiredBundle()))
    const auth = new TwitchAuth({ clientId: 'clientid', enabled: true, store })
    cleanups.push(() => auth.dispose())
    auth.disconnect()
    expect(store.get(TWITCH_SECRET_KEY)).toBeNull()

    store.set(TWITCH_SECRET_KEY, JSON.stringify(expiredBundle()))
    auth.configure({ clientId: 'otherid' })
    expect(store.get(TWITCH_SECRET_KEY)).toBeNull()
    expect(auth.status.lastError).toMatch(/Client ID changed/)
  })
})
