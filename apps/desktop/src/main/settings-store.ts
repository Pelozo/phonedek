import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomInt } from 'node:crypto'
import { DEFAULT_HTTP_PORT } from '@phonedek/shared'
import type { Logger } from './logger'

export interface AppSettings {
  port: number
  token: string
  discovery: boolean
  launchAtLogin: boolean
  /** Keep the deck server alive in the system tray when the window is closed. */
  minimizeToTray: boolean
  /** Let paired phones move the cursor and click. Off suspends all pointer input. */
  allowPointerControl: boolean
  /** Optional LAN address to advertise in the QR code. Empty = auto. */
  pairHost: string
  /** macOS full-screen capture folder. Empty = OS Desktop. */
  screenshotDirectory: string
  /** Control OBS through its WebSocket server. */
  obsEnabled: boolean
  /** OBS WebSocket host. Defaults to 127.0.0.1. */
  obsHost: string
  /** OBS WebSocket port. Defaults to 4455. */
  obsPort: number
  /** OBS WebSocket password. Never sent to the phone or renderer. */
  obsPassword: string
}

/** Four-digit pairing PIN (the QR/link is the low-friction path). */
export function createToken(): string {
  return randomInt(0, 10_000).toString().padStart(4, '0')
}

export const DEFAULT_OBS_HOST = '127.0.0.1'
export const DEFAULT_OBS_PORT = 4455

/**
 * Accept localhost, IPv4, hostnames and a bracketed IPv6 literal. Reject
 * schemes, paths, whitespace and anything that could alter the WebSocket URL.
 */
export function sanitizeObsHost(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_OBS_HOST
  const host = value.trim()
  if (!host || host.length > 253) return DEFAULT_OBS_HOST
  if (host.includes('://') || /[/\\?#@\s]/.test(host)) return DEFAULT_OBS_HOST
  const ipv6 = /^\[([0-9a-fA-F:.]+)\]$/.exec(host)
  if (ipv6) {
    const inner = ipv6[1]!
    return inner.includes(':') ? host : DEFAULT_OBS_HOST
  }
  if (host.includes(':')) return DEFAULT_OBS_HOST
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host)) return DEFAULT_OBS_HOST
  if (host.includes('..') || host.startsWith('.') || host.endsWith('.')) return DEFAULT_OBS_HOST
  return host
}

export function sanitizeObsPort(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
    ? value
    : DEFAULT_OBS_PORT
}

export function sanitizeObsPassword(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, 256)
}

export function defaultSettings(): AppSettings {
  return {
    port: DEFAULT_HTTP_PORT,
    token: createToken(),
    discovery: true,
    launchAtLogin: false,
    minimizeToTray: false,
    allowPointerControl: true,
    pairHost: '',
    screenshotDirectory: '',
    obsEnabled: false,
    obsHost: DEFAULT_OBS_HOST,
    obsPort: DEFAULT_OBS_PORT,
    obsPassword: '',
  }
}

function sanitize(input: Partial<AppSettings> | null | undefined): AppSettings {
  const defaults = defaultSettings()
  if (!input) return defaults
  const port =
    typeof input.port === 'number' && Number.isInteger(input.port) && input.port >= 1024 && input.port <= 65535
      ? input.port
      : defaults.port
  // Old installs had a long random token; migrate them to a 4-digit PIN.
  const token =
    typeof input.token === 'string' && /^\d{4}$/.test(input.token)
      ? input.token
      : defaults.token
  const pairHost =
    typeof input.pairHost === 'string' && /^[A-Za-z0-9.-]{1,253}$/.test(input.pairHost.trim())
      ? input.pairHost.trim()
      : ''
  const rawScreenshotDirectory =
    typeof input.screenshotDirectory === 'string' ? input.screenshotDirectory.trim() : ''
  const screenshotDirectory =
    rawScreenshotDirectory &&
    rawScreenshotDirectory.length <= 4096 &&
    isAbsolute(rawScreenshotDirectory)
      ? rawScreenshotDirectory
      : ''
  return {
    port,
    token,
    discovery: typeof input.discovery === 'boolean' ? input.discovery : defaults.discovery,
    launchAtLogin: typeof input.launchAtLogin === 'boolean' ? input.launchAtLogin : defaults.launchAtLogin,
    minimizeToTray:
      typeof input.minimizeToTray === 'boolean' ? input.minimizeToTray : defaults.minimizeToTray,
    allowPointerControl:
      typeof input.allowPointerControl === 'boolean'
        ? input.allowPointerControl
        : defaults.allowPointerControl,
    pairHost,
    screenshotDirectory,
    obsEnabled:
      typeof input.obsEnabled === 'boolean' ? input.obsEnabled : defaults.obsEnabled,
    obsHost: sanitizeObsHost(input.obsHost),
    obsPort: sanitizeObsPort(input.obsPort),
    obsPassword: sanitizeObsPassword(input.obsPassword),
  }
}

export class SettingsStore {
  readonly file: string
  private settings: AppSettings
  private readonly logger?: Logger

  constructor(dir: string, logger?: Logger) {
    this.file = join(dir, 'settings.json')
    this.logger = logger
    mkdirSync(dir, { recursive: true })
    this.settings = this.load()
  }

  get(): AppSettings {
    return { ...this.settings }
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.settings = sanitize({ ...this.settings, ...patch })
    this.write()
    return this.get()
  }

  rotateToken(): string {
    let token = createToken()
    for (let attempt = 0; attempt < 8 && token === this.settings.token; attempt += 1) {
      token = createToken()
    }
    this.settings = { ...this.settings, token }
    this.write()
    return token
  }

  private load(): AppSettings {
    if (!existsSync(this.file)) {
      const settings = defaultSettings()
      this.writeValue(settings)
      return settings
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<AppSettings>
      const settings = sanitize(parsed)
      this.writeValue(settings)
      return settings
    } catch (error) {
      this.logger?.warn(`settings.json was invalid, regenerating: ${String(error)}`)
      const settings = defaultSettings()
      this.writeValue(settings)
      return settings
    }
  }

  private write(): void {
    this.writeValue(this.settings)
  }

  private writeValue(settings: AppSettings): void {
    const temp = `${this.file}.${process.pid}.tmp`
    writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    renameSync(temp, this.file)
  }
}
