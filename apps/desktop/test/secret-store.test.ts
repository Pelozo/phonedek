import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretStore, type SafeStorageLike } from '../src/main/secret-store'
import type { Logger } from '../src/main/logger'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'phonedek-secret-'))
}

function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer) => {
      const text = buffer.toString('utf8')
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext')
      return text.slice(4)
    },
  }
}

function fakeLogger(): Logger & { warnings: string[] } {
  const warnings: string[] = []
  return {
    logPath: null,
    warnings,
    info: () => undefined,
    warn: (message) => warnings.push(message),
    error: () => undefined,
  }
}

const stores: SecretStore[] = []

function store(dir: string, safeStorage: SafeStorageLike | null = fakeSafeStorage()): SecretStore {
  const created = new SecretStore({ dir, safeStorage })
  stores.push(created)
  return created
}

afterEach(() => {
  stores.splice(0)
})

describe('SecretStore', () => {
  it('stores encrypted values, reloads them and keeps plaintext out of the file', () => {
    const dir = tempDir()
    const secrets = store(dir)
    secrets.set('twitch.oauth', 'super-secret-token')
    expect(secrets.get('twitch.oauth')).toBe('super-secret-token')
    expect(secrets.has('twitch.oauth')).toBe(true)

    const raw = readFileSync(secrets.file, 'utf8')
    expect(raw).not.toContain('super-secret-token')
    expect(JSON.parse(raw)).toMatchObject({ version: 1, encrypted: true })

    const reloaded = store(dir)
    expect(reloaded.get('twitch.oauth')).toBe('super-secret-token')
    reloaded.delete('twitch.oauth')
    expect(reloaded.get('twitch.oauth')).toBeNull()
    expect(store(dir).has('twitch.oauth')).toBe(false)
  })

  it('falls back to a 0600 plaintext file with a warning when encryption is unavailable', () => {
    const dir = tempDir()
    const logger = fakeLogger()
    const created = new SecretStore({
      dir,
      safeStorage: fakeSafeStorage(false),
      logger,
    })
    created.set('lights.hue', 'local-token')
    expect(created.get('lights.hue')).toBe('local-token')
    expect(logger.warnings.join(' ')).toMatch(/without OS encryption/)
    expect(JSON.parse(readFileSync(created.file, 'utf8'))).toMatchObject({ encrypted: false })
    if (process.platform !== 'win32') {
      expect(statSync(created.file).mode & 0o777).toBe(0o600)
    }
  })

  it('re-encrypts existing plaintext values when safeStorage becomes available', () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'secrets.bin'),
      JSON.stringify({ version: 1, encrypted: false, secrets: { 'twitch.oauth': 'legacy' } }),
    )
    const secrets = store(dir)
    expect(secrets.get('twitch.oauth')).toBe('legacy')
    secrets.set('lights.hue', 'new-token')
    expect(secrets.get('twitch.oauth')).toBe('legacy')

    const raw = readFileSync(secrets.file, 'utf8')
    expect(JSON.parse(raw)).toMatchObject({ encrypted: true })
    expect(raw).not.toContain('legacy')
    expect(store(dir).get('twitch.oauth')).toBe('legacy')
    expect(store(dir).get('lights.hue')).toBe('new-token')
  })

  it('ignores encrypted files when safeStorage is unavailable and resets corrupt files', () => {
    const dir = tempDir()
    const logger = fakeLogger()
    const encrypted = store(dir)
    encrypted.set('twitch.oauth', 'token')
    const plain = new SecretStore({ dir, safeStorage: null, logger })
    expect(plain.get('twitch.oauth')).toBeNull()
    expect(logger.warnings.join(' ')).toMatch(/safeStorage is unavailable/)

    writeFileSync(join(dir, 'secrets.bin'), '{not json')
    const reset = new SecretStore({ dir, safeStorage: fakeSafeStorage(), logger })
    expect(reset.has('twitch.oauth')).toBe(false)
    expect(logger.warnings.join(' ')).toMatch(/reset/)
  })

  it('validates keys and values', () => {
    const secrets = store(tempDir())
    expect(() => secrets.set('bad key!', 'value')).toThrow(/namespaced/)
    expect(() => secrets.set('twitch.oauth', '')).toThrow(/empty/)
    expect(secrets.get('bad key!')).toBeNull()
  })
})
