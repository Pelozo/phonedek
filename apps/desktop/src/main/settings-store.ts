import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomInt } from 'node:crypto'
import { DEFAULT_HTTP_PORT, LIGHT_DEFAULT_PORT, normalizeProfileId } from '@phonedek/shared'
import type { Logger } from './logger'
import { builtinTwitchClientId, sanitizeTwitchClientId } from './twitch-auth'

/** One auto-profile rule: launch this process → show this deck profile. */
export interface AutoProfileRule {
  /** Stable id; unique within the list. */
  id: string
  /** Normalized executable basename, lowercase, without `.exe`. */
  process: string
  /** Profile id from the deck config. */
  profileId: string
}

/** One local light device. Elgato is the only provider in this MVP. */
export interface LightDeviceSettings {
  /** Stable id referenced by bindings/actions; unique within the list. */
  id: string
  /** Display name. */
  name: string
  type: 'elgato'
  /** Hostname or IPv4/IPv6 literal, no scheme/path. */
  host: string
  /** HTTP port; Elgato's default is 9123. */
  port: number
}

export interface AppSettings {
  port: number
  token: string
  discovery: boolean
  launchAtLogin: boolean
  /** Keep the deck server alive in the system tray when the window is closed. */
  minimizeToTray: boolean
  /** Let paired phones move the cursor and click. Off suspends all pointer input. */
  allowPointerControl: boolean
  /** Let paired phones type text and keys. Off suspends all keyboard input. */
  allowKeyboardControl: boolean
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
  /** Connect the streamer's Twitch account through Device Code Flow. */
  twitchEnabled: boolean
  /** Public Twitch client ID. Defaults to a bundled/env value when present. */
  twitchClientId: string
  /** Turn local-light control on. Defaults to true when devices are configured. */
  lightsEnabled: boolean
  /** Local devices (Elgato Key Light family). No credentials. Max 8. */
  lights: LightDeviceSettings[]
  /** Switch connected phones to a profile when a configured game starts. */
  autoProfileEnabled: boolean
  /** Process → profile rules, evaluated in order. Max 16. */
  autoProfileRules: AutoProfileRule[]
}

/** Four-digit pairing PIN (the QR/link is the low-friction path). */
export function createToken(): string {
  return randomInt(0, 10_000).toString().padStart(4, '0')
}

export const DEFAULT_OBS_HOST = '127.0.0.1'
export const DEFAULT_OBS_PORT = 4455
export const DEFAULT_LIGHT_PORT = LIGHT_DEFAULT_PORT
export const MAX_LIGHT_DEVICES = 8
export const MAX_AUTO_PROFILE_RULES = 16
const LIGHT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const RULE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const LIGHT_HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/

/**
 * Normalize an executable name to the form used by process snapshots:
 * basename, lowercase, no trailing `.exe`. Accepts a full path or a bare
 * filename so a pasted `C:\Games\Game.exe` and `game` match the same process.
 */
export function normalizeProcessName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || raw.length > 4096) return null
  const slash = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
  let name = (slash >= 0 ? raw.slice(slash + 1) : raw).trim().toLowerCase()
  if (name.endsWith('.exe')) name = name.slice(0, -4)
  if (!name || name.length > 160) return null
  if (/[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

/**
 * Sanitize the persisted auto-profile list: drop malformed entries, normalize
 * process names, cap at 16 and make ids stable, valid and unique. Profile
 * existence is checked by the caller against the current deck config.
 */
export function sanitizeAutoProfileRules(input: unknown): AutoProfileRule[] {
  if (!Array.isArray(input)) return []
  const rules: AutoProfileRule[] = []
  const used = new Set<string>()
  for (const [index, item] of input.entries()) {
    if (rules.length >= MAX_AUTO_PROFILE_RULES) break
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const candidate = item as Record<string, unknown>
    const process = normalizeProcessName(candidate.process)
    const profileId = normalizeProfileId(candidate.profileId)
    if (!process || !profileId) continue

    const rawId = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    let id = RULE_ID_PATTERN.test(rawId) ? rawId : `rule-${index + 1}`
    if (used.has(id)) {
      let suffix = 2
      while (used.has(`${id}-${suffix}`)) suffix += 1
      id = `${id}-${suffix}`
    }
    used.add(id)

    rules.push({ id, process, profileId })
  }
  return rules
}

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

/** A valid device host, or null when the value cannot be a bare hostname/IP. */
export function sanitizeLightHost(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const host = value.trim()
  if (!host || host.length > 253) return null
  if (host.includes('://') || /[/\\?#@\s]/.test(host)) return null
  const ipv6 = /^\[([0-9a-fA-F:.]+)\]$/.exec(host)
  if (ipv6) return ipv6[1]!.includes(':') ? host : null
  if (host.includes(':')) return null
  if (!LIGHT_HOST_PATTERN.test(host)) return null
  if (host.includes('..') || host.startsWith('.') || host.endsWith('.')) return null
  return host
}

export function sanitizeLightPort(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
    ? value
    : DEFAULT_LIGHT_PORT
}

function lightName(value: unknown, index: number): string {
  if (typeof value === 'string') {
    const name = value.trim().slice(0, 40)
    if (name) return name
  }
  return `Light ${index + 1}`
}

/**
 * Sanitize the persisted device list: drop invalid hosts/providers, cap at 8,
 * and make ids stable, valid and unique. An id is derived from the list index
 * when it is missing or malformed, so a hand-edited settings.json still loads.
 */
export function sanitizeLightDevices(input: unknown): LightDeviceSettings[] {
  if (!Array.isArray(input)) return []
  const devices: LightDeviceSettings[] = []
  const used = new Set<string>()
  for (const [index, item] of input.entries()) {
    if (devices.length >= MAX_LIGHT_DEVICES) break
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const candidate = item as Record<string, unknown>
    const type = candidate.type
    if (type !== undefined && type !== 'elgato') continue
    const host = sanitizeLightHost(candidate.host)
    if (!host) continue

    const rawId = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    let id = LIGHT_ID_PATTERN.test(rawId) ? rawId : `light-${index + 1}`
    if (used.has(id)) {
      let suffix = 2
      while (used.has(`${id}-${suffix}`)) suffix += 1
      id = `${id}-${suffix}`
    }
    used.add(id)

    devices.push({
      id,
      name: lightName(candidate.name, index),
      type: 'elgato',
      host,
      port: sanitizeLightPort(candidate.port),
    })
  }
  return devices
}

export function defaultSettings(): AppSettings {
  return {
    port: DEFAULT_HTTP_PORT,
    token: createToken(),
    discovery: true,
    launchAtLogin: false,
    minimizeToTray: false,
    allowPointerControl: true,
    allowKeyboardControl: true,
    pairHost: '',
    screenshotDirectory: '',
    obsEnabled: false,
    obsHost: DEFAULT_OBS_HOST,
    obsPort: DEFAULT_OBS_PORT,
    obsPassword: '',
    twitchEnabled: false,
    twitchClientId: builtinTwitchClientId(),
    lightsEnabled: false,
    lights: [],
    autoProfileEnabled: false,
    autoProfileRules: [],
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
  const lights = sanitizeLightDevices(input.lights)
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
    allowKeyboardControl:
      typeof input.allowKeyboardControl === 'boolean'
        ? input.allowKeyboardControl
        : defaults.allowKeyboardControl,
    pairHost,
    screenshotDirectory,
    obsEnabled:
      typeof input.obsEnabled === 'boolean' ? input.obsEnabled : defaults.obsEnabled,
    obsHost: sanitizeObsHost(input.obsHost),
    obsPort: sanitizeObsPort(input.obsPort),
    obsPassword: sanitizeObsPassword(input.obsPassword),
    twitchEnabled:
      typeof input.twitchEnabled === 'boolean' ? input.twitchEnabled : defaults.twitchEnabled,
    // An explicit empty string is meaningful (user cleared a bundled default).
    twitchClientId:
      input.twitchClientId === undefined
        ? defaults.twitchClientId
        : sanitizeTwitchClientId(input.twitchClientId),
    // A configured device list means the user wants lights on; an explicit
    // boolean still wins so the user can temporarily disable them.
    lightsEnabled:
      typeof input.lightsEnabled === 'boolean' ? input.lightsEnabled : lights.length > 0,
    lights,
    autoProfileEnabled:
      typeof input.autoProfileEnabled === 'boolean'
        ? input.autoProfileEnabled
        : defaults.autoProfileEnabled,
    autoProfileRules: sanitizeAutoProfileRules(input.autoProfileRules),
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
    return {
      ...this.settings,
      lights: this.settings.lights.map((device) => ({ ...device })),
      autoProfileRules: this.settings.autoProfileRules.map((rule) => ({ ...rule })),
    }
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const effectivePatch =
      patch.lights !== undefined && patch.lightsEnabled === undefined
        ? { ...patch, lightsEnabled: Array.isArray(patch.lights) && patch.lights.length > 0 }
        : patch
    this.settings = sanitize({ ...this.settings, ...effectivePatch })
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
