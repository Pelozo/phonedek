import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LightCredentialStore,
  isValidLightCredential,
  lightCredentialKey,
  type LightSecretStoreLike,
} from '../src/main/light-credentials'
import { SecretStore, type SafeStorageLike } from '../src/main/secret-store'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'phonedek-light-credentials-'))
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

function memoryStore(): LightSecretStoreLike & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value)
    },
    delete: (key) => {
      values.delete(key)
    },
  }
}

const secretStores: SecretStore[] = []

afterEach(() => {
  secretStores.splice(0)
})

describe('light credential keys', () => {
  it('is stable, namespaced and within the SecretStore key limit', () => {
    const key = lightCredentialKey('hue-1')
    expect(key).toBe('light.hue-1')
    expect(lightCredentialKey('hue-1')).toBe(key)
    expect(lightCredentialKey('a'.repeat(64))).toMatch(/^light\.[a-f0-9]{40}$/)
    expect(lightCredentialKey('a'.repeat(64)).length).toBeLessThanOrEqual(64)
    expect(lightCredentialKey('device with spaces')).toMatch(/^light\.[a-f0-9]{40}$/)
  })

  it('accepts only path-safe credential strings', () => {
    expect(isValidLightCredential('abc-123_X.Y')).toBe(true)
    expect(isValidLightCredential('abc/def')).toBe(false)
    expect(isValidLightCredential('abc def')).toBe(false)
    expect(isValidLightCredential('')).toBe(false)
    expect(isValidLightCredential(42)).toBe(false)
  })
})

describe('LightCredentialStore', () => {
  it('merges, reads and clears provider credentials per device', () => {
    const secrets = memoryStore()
    const credentials = new LightCredentialStore(secrets)

    expect(credentials.get('hue-1')).toBeNull()
    expect(credentials.has('hue-1')).toBe(false)

    credentials.set('hue-1', { username: 'hue-user' })
    expect(credentials.get('hue-1')).toEqual({ username: 'hue-user' })
    expect(credentials.has('hue-1')).toBe(true)

    credentials.set('hue-1', { token: 'nanoleaf-token' })
    expect(credentials.get('hue-1')).toEqual({
      username: 'hue-user',
      token: 'nanoleaf-token',
    })

    credentials.set('hue-1', { username: '' })
    expect(credentials.get('hue-1')).toEqual({ token: 'nanoleaf-token' })

    credentials.set('hue-1', { token: '' })
    expect(credentials.get('hue-1')).toBeNull()
    expect(secrets.values.size).toBe(0)
  })

  it('rejects unsafe values without writing them', () => {
    const secrets = memoryStore()
    const credentials = new LightCredentialStore(secrets)
    credentials.set('light-1', { token: 'bad/token' })
    expect(credentials.get('light-1')).toBeNull()
    expect(secrets.values.size).toBe(0)
  })

  it('treats corrupt stored JSON as absent', () => {
    const secrets = memoryStore()
    secrets.set(lightCredentialKey('light-1'), '{not json')
    const credentials = new LightCredentialStore(secrets)
    expect(credentials.get('light-1')).toBeNull()
  })

  it('keeps plaintext out of the SecretStore file', () => {
    const dir = tempDir()
    const secrets = new SecretStore({ dir, safeStorage: fakeSafeStorage() })
    secretStores.push(secrets)
    const credentials = new LightCredentialStore(secrets)

    credentials.set('hue-1', { username: 'hue-application-key' })
    credentials.set('nl-1', { token: 'nanoleaf-token' })

    expect(credentials.get('hue-1')).toEqual({ username: 'hue-application-key' })
    expect(credentials.get('nl-1')).toEqual({ token: 'nanoleaf-token' })
    const raw = readFileSync(secrets.file, 'utf8')
    expect(raw).not.toContain('hue-application-key')
    expect(raw).not.toContain('nanoleaf-token')
    expect(JSON.parse(raw)).toMatchObject({ encrypted: true })

    const reloaded = new LightCredentialStore(new SecretStore({ dir, safeStorage: fakeSafeStorage() }))
    expect(reloaded.get('hue-1')).toEqual({ username: 'hue-application-key' })
  })
})
