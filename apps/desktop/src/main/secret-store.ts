import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Logger } from './logger'

/**
 * Minimal Electron `safeStorage` surface. Kept structural so tests can inject a
 * fake and this module never imports Electron directly.
 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(buffer: Buffer): string
}

export interface SecretStoreOptions {
  /** Electron userData directory. */
  dir: string
  /** Omitted/empty = encryption unavailable; values are stored 0600 in clear. */
  safeStorage?: SafeStorageLike | null
  logger?: Logger
  /** File name inside `dir`; defaults to `secrets.bin`. */
  fileName?: string
}

interface SecretFile {
  version: 1
  /** True when every value was encrypted with safeStorage. */
  encrypted: boolean
  secrets: Record<string, string>
}

const FILE_VERSION = 1

/**
 * Tiny namespaced secret store backed by one file in userData.
 *
 * With Electron `safeStorage` values are encrypted before they touch disk
 * (DPAPI on Windows, Keychain on macOS, libsecret on Linux). When encryption is
 * unavailable the file is still written, but as plaintext with `0600`
 * permissions and a one-time warning. Secrets never go into settings.json,
 * DeckConfig, backups, logs, the renderer or the phone.
 */
export class SecretStore {
  readonly file: string
  private readonly safeStorage: SafeStorageLike | null
  private readonly logger?: Logger
  private secrets: Record<string, string> = {}
  private encrypted = false
  private warned = false

  constructor(options: SecretStoreOptions) {
    this.file = join(options.dir, options.fileName ?? 'secrets.bin')
    this.safeStorage =
      options.safeStorage && options.safeStorage.isEncryptionAvailable() ? options.safeStorage : null
    this.logger = options.logger
    mkdirSync(dirname(this.file), { recursive: true })
    this.load()
  }

  get(key: string): string | null {
    if (!isKey(key)) return null
    const stored = this.secrets[key]
    if (stored === undefined) return null
    if (!this.encrypted) return stored
    try {
      return this.safeStorage?.decryptString(Buffer.from(stored, 'base64')) ?? null
    } catch (error) {
      this.logger?.warn(`Could not decrypt secret "${key}": ${message(error)}`)
      return null
    }
  }

  set(key: string, value: string): void {
    if (!isKey(key)) throw new Error('Secret key must be a short namespaced identifier')
    if (typeof value !== 'string' || value.length === 0 || value.length > 32_768) {
      throw new Error('Secret value is empty or too large')
    }
    if (this.safeStorage) {
      if (!this.encrypted) {
        // Re-encrypt any values loaded from a legacy plaintext file before
        // flipping the file flag, otherwise old entries become unreadable.
        const migrated: Record<string, string> = {}
        for (const [existingKey, existingValue] of Object.entries(this.secrets)) {
          migrated[existingKey] = this.safeStorage.encryptString(existingValue).toString('base64')
        }
        this.secrets = migrated
        this.encrypted = true
      }
      this.secrets[key] = this.safeStorage.encryptString(value).toString('base64')
    } else {
      this.encrypted = false
      this.warnPlaintext()
      this.secrets[key] = value
    }
    this.write()
  }

  delete(key: string): void {
    if (!(key in this.secrets)) return
    delete this.secrets[key]
    this.write()
  }

  has(key: string): boolean {
    return key in this.secrets
  }

  private load(): void {
    if (!existsSync(this.file)) {
      this.secrets = {}
      this.encrypted = this.safeStorage !== null
      return
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<SecretFile>
      const source = isRecord(parsed.secrets) ? parsed.secrets : {}
      const secrets: Record<string, string> = {}
      for (const [key, value] of Object.entries(source)) {
        if (isKey(key) && typeof value === 'string' && value.length <= 65_536) secrets[key] = value
      }
      this.secrets = secrets
      this.encrypted = parsed.encrypted === true && this.safeStorage !== null
      if (parsed.encrypted === true && !this.safeStorage) {
        this.logger?.warn('secrets.bin is encrypted but safeStorage is unavailable; secrets are ignored')
        this.secrets = {}
        this.encrypted = false
      }
    } catch (error) {
      this.logger?.warn(`secrets.bin was invalid and has been reset: ${message(error)}`)
      this.secrets = {}
      this.encrypted = this.safeStorage !== null
    }
  }

  private write(): void {
    const payload: SecretFile = {
      version: FILE_VERSION,
      encrypted: this.encrypted,
      secrets: this.secrets,
    }
    const temp = `${this.file}.${process.pid}.tmp`
    writeFileSync(temp, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 })
    try {
      chmodSync(temp, 0o600)
    } catch {
      // NTFS / restricted filesystems may ignore POSIX modes.
    }
    renameSync(temp, this.file)
  }

  private warnPlaintext(): void {
    if (this.warned) return
    this.warned = true
    this.logger?.warn(
      'safeStorage encryption is unavailable; Twitch tokens are stored in a 0600 file without OS encryption.',
    )
  }
}

function isKey(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
