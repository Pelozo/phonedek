import { createHash } from 'node:crypto'

/**
 * Non-secret store surface used by the credential wrapper. Electron's
 * `SecretStore` satisfies it; tests can pass an in-memory fake.
 */
export interface LightSecretStoreLike {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

/** Provider credentials. Never serialized to settings, logs or the phone. */
export interface LightCredentials {
  /** Philips Hue application key / CLIP v1 username. */
  username?: string
  /** Nanoleaf OpenAPI auth token. */
  token?: string
}

export interface LightCredentialReader {
  get(deviceId: string): LightCredentials | null
  has(deviceId: string): boolean
}

const CREDENTIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/**
 * Stable SecretStore key for one light device. Device ids are capped at 64
 * characters, which can overflow SecretStore's 64-character key limit when
 * prefixed, so long ids are hashed.
 */
export function lightCredentialKey(deviceId: string): string {
  const safe = deviceId.replace(/[^A-Za-z0-9._-]/g, '')
  if (safe === deviceId && deviceId.length <= 48) return `light.${deviceId}`
  const digest = createHash('sha256').update(`light:${deviceId}`).digest('hex').slice(0, 40)
  return `light.${digest}`
}

/** True when a value can safely travel in a Hue path or Nanoleaf token slot. */
export function isValidLightCredential(value: unknown): value is string {
  return typeof value === 'string' && CREDENTIAL_PATTERN.test(value.trim())
}

function normalize(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return CREDENTIAL_PATTERN.test(trimmed) ? trimmed : undefined
}

/**
 * Per-device credential wrapper over the encrypted SecretStore.
 *
 * Each device owns one namespaced secret containing a small JSON object. The
 * merge semantics let the renderer update a Hue username or a Nanoleaf token
 * independently without clearing the other provider's field.
 */
export class LightCredentialStore implements LightCredentialReader {
  constructor(private readonly secrets: LightSecretStoreLike) {}

  get(deviceId: string): LightCredentials | null {
    if (!deviceId) return null
    const raw = this.secrets.get(lightCredentialKey(deviceId))
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
      const record = parsed as Record<string, unknown>
      const username = normalize(record.username)
      const token = normalize(record.token)
      if (!username && !token) return null
      return {
        ...(username ? { username } : {}),
        ...(token ? { token } : {}),
      }
    } catch {
      // A corrupt value is treated as absent; it never reaches a log.
      return null
    }
  }

  has(deviceId: string): boolean {
    const credentials = this.get(deviceId)
    return credentials !== null && Boolean(credentials.username || credentials.token)
  }

  /**
   * Merge credentials for one device. An explicitly empty `username`/`token`
   * removes that field; when both are gone the secret itself is deleted.
   */
  set(deviceId: string, credentials: LightCredentials): void {
    if (!deviceId) throw new Error('Light credential needs a device id')
    const current = this.get(deviceId) ?? {}
    const next: LightCredentials = { ...current }

    if (credentials.username !== undefined) {
      const username = normalize(credentials.username)
      if (username) next.username = username
      else delete next.username
    }
    if (credentials.token !== undefined) {
      const token = normalize(credentials.token)
      if (token) next.token = token
      else delete next.token
    }

    if (!next.username && !next.token) {
      this.clear(deviceId)
      return
    }
    this.secrets.set(lightCredentialKey(deviceId), JSON.stringify(next))
  }

  clear(deviceId: string): void {
    if (!deviceId) return
    this.secrets.delete(lightCredentialKey(deviceId))
  }
}
