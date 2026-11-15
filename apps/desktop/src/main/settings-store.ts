import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomInt } from 'node:crypto'
import {
  DEFAULT_HTTP_PORT,
  LIGHT_DEFAULT_PORT,
  STREAMERBOT_DEFAULT_HOST,
  STREAMERBOT_DEFAULT_PORT,
  lightDefaultPort,
  normalizeProfileId,
  type LightDeviceType,
} from '@phonedek/shared'
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

/**
 * One local light device.
 *
 * Credentials are deliberately absent: Hue application keys and Nanoleaf
 * tokens live in the encrypted SecretStore, keyed by this device id. The
 * renderer and the phone only ever see `hasCredential`.
 */
export interface LightDeviceSettings {
  /** Stable id referenced by bindings/actions; unique within the list. */
  id: string
  /** Display name. */
  name: string
  type: LightDeviceType
  /** Hostname or IPv4/IPv6 literal, no scheme/path. */
  host: string
  /** HTTP/HTTPS port. Defaults to 9123 (Elgato), 443 (Hue) or 16021 (Nanoleaf). */
  port: number
  /**
   * Optional provider-side light id (a Hue light id, for example). Omitted
   * means the adapter picks the first light the device reports.
   */
  lightId?: string
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
  /** Version whose What's New dialog was dismissed, or recorded on first run. */
  lastSeenVersion: string
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
  /** Trigger actions in a local Streamer.bot instance. */
  streamerbotEnabled: boolean
  /** Streamer.bot WebSocket host. Defaults to 127.0.0.1. */
  streamerbotHost: string
  /** Streamer.bot WebSocket port. Defaults to 8080. */
  streamerbotPort: number
  /** Turn local-light control on. Defaults to true when devices are configured. */
  lightsEnabled: boolean
  /** Local devices (Elgato Key Light family). No credentials. Max 8. */
  lights: LightDeviceSettings[]
  /** Switch connected phones to a profile when a configured game starts. */
  autoProfileEnabled: boolean
  /** Process → profile rules, evaluated in order. Max 16. */
  autoProfileRules: AutoProfileRule[]
  /** Return phones to a profile after a matched game exits. */
  autoProfileRevertEnabled: boolean
  /** Profile to return to; ignored when it no longer exists in the config. */
  autoProfileRevertProfileId?: string
  /**
   * Rules in the deck config may only fire when this is true on THIS desktop.
   * Never part of the config or a backup, so an imported deck cannot auto-fire.
   */
  automationEnabled: boolean
}

/** Four-digit pairing PIN (the QR/link is the low-friction path). */
export function createToken(): string {
  return randomInt(0, 10_000).toString().padStart(4, '0')
}

export const DEFAULT_OBS_HOST = '127.0.0.1'
export const DEFAULT_OBS_PORT = 4455
export const DEFAULT_STREAMERBOT_SETTINGS_HOST = STREAMERBOT_DEFAULT_HOST
export const DEFAULT_STREAMERBOT_SETTINGS_PORT = STREAMERBOT_DEFAULT_PORT
export const DEFAULT_LIGHT_PORT = LIGHT_DEFAULT_PORT
export const MAX_LIGHT_DEVICES = 8
export const MAX_AUTO_PROFILE_RULES = 16
const LIGHT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const LIGHT_TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const RULE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const LIGHT_HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/
const LIGHT_DEVICE_TYPES = new Set<LightDeviceType>(['elgato', 'hue', 'nanoleaf'])

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
 * Validate the optional revert target. The id must have the same shape as any
 * other profile id; whether that profile still exists is checked against the
 * current deck config by the watcher and the IPC handler.
 */
export function sanitizeAutoProfileRevertProfileId(value: unknown): string | undefined {
  return normalizeProfileId(value) ?? undefined
}

/**
 * The revert target that should actually be used, or null when the feature is
 * off, no target is selected, or the selected profile was deleted.
 */
export function autoProfileRevertTargetId(
  settings: Pick<AppSettings, 'autoProfileRevertEnabled' | 'autoProfileRevertProfileId'>,
  profileIds?: ReadonlySet<string>,
): string | null {
  if (!settings.autoProfileRevertEnabled) return null
  const profileId = settings.autoProfileRevertProfileId
  if (!profileId) return null
  if (profileIds && !profileIds.has(profileId)) return null
  return profileId
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

/**
 * Normalize a stored app version: trim, drop an optional `v` prefix, and keep
 * only the characters used by semver/pre-release labels. Anything else (or an
 * empty value) becomes `''`, which the renderer treats as a first run.
 */
export function sanitizeLastSeenVersion(value: unknown): string {
  if (typeof value !== 'string') return ''
  const clean = value.trim().replace(/^[vV]/, '')
  if (!clean || clean.length > 32) return ''
  return /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(clean) ? clean : ''
}

/**
 * Streamer.bot shares OBS's host rules: localhost, IPv4, hostnames and a
 * bracketed IPv6 literal; never a scheme, path or whitespace.
 */
export function sanitizeStreamerBotHost(value: unknown): string {
  return sanitizeObsHost(value)
}

export function sanitizeStreamerBotPort(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
    ? value
    : DEFAULT_STREAMERBOT_SETTINGS_PORT
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

export function sanitizeLightPort(value: unknown, fallback = DEFAULT_LIGHT_PORT): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
    ? value
    : fallback
}

/** A provider-side light/panel id, or undefined when it is not safe to use. */
export function sanitizeLightTarget(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const target = value.trim()
  return LIGHT_TARGET_PATTERN.test(target) ? target : undefined
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
 *
 * A missing type is treated as `elgato`: every pre-Hue settings file keeps
 * working unchanged. Credential fields (`username`, `token`) are ignored here;
 * only the IPC handler consumes them and writes them to the SecretStore.
 */
export function sanitizeLightDevices(input: unknown): LightDeviceSettings[] {
  if (!Array.isArray(input)) return []
  const devices: LightDeviceSettings[] = []
  const used = new Set<string>()
  for (const [index, item] of input.entries()) {
    if (devices.length >= MAX_LIGHT_DEVICES) break
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const candidate = item as Record<string, unknown>
    const type: LightDeviceType =
      candidate.type === undefined ? 'elgato' : (candidate.type as LightDeviceType)
    if (!LIGHT_DEVICE_TYPES.has(type)) continue
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

    const target = sanitizeLightTarget(candidate.lightId)
    devices.push({
      id,
      name: lightName(candidate.name, index),
      type,
      host,
      port: sanitizeLightPort(candidate.port, lightDefaultPort(type)),
      ...(target ? { lightId: target } : {}),
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
    lastSeenVersion: '',
    obsEnabled: false,
    obsHost: DEFAULT_OBS_HOST,
    obsPort: DEFAULT_OBS_PORT,
    obsPassword: '',
    twitchEnabled: false,
    twitchClientId: builtinTwitchClientId(),
    streamerbotEnabled: false,
    streamerbotHost: DEFAULT_STREAMERBOT_SETTINGS_HOST,
    streamerbotPort: DEFAULT_STREAMERBOT_SETTINGS_PORT,
    lightsEnabled: false,
    lights: [],
    autoProfileEnabled: false,
    autoProfileRules: [],
    autoProfileRevertEnabled: false,
    automationEnabled: false,
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
    lastSeenVersion: sanitizeLastSeenVersion(input.lastSeenVersion),
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
    streamerbotEnabled:
      typeof input.streamerbotEnabled === 'boolean'
        ? input.streamerbotEnabled
        : defaults.streamerbotEnabled,
    streamerbotHost: sanitizeStreamerBotHost(input.streamerbotHost),
    streamerbotPort: sanitizeStreamerBotPort(input.streamerbotPort),
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
    autoProfileRevertEnabled:
      typeof input.autoProfileRevertEnabled === 'boolean'
        ? input.autoProfileRevertEnabled
        : defaults.autoProfileRevertEnabled,
    autoProfileRevertProfileId: sanitizeAutoProfileRevertProfileId(
      input.autoProfileRevertProfileId,
    ),
    automationEnabled:
      typeof input.automationEnabled === 'boolean'
        ? input.automationEnabled
        : defaults.automationEnabled,
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
      // A settings file from a build before the What's New feature has no
      // usable version field. Treat it as an upgrade so those users see the
      // dialog once; a genuinely fresh install has no settings file at all.
      const storedSeenVersion = sanitizeLastSeenVersion(parsed.lastSeenVersion)
      const settings = sanitize(parsed)
      if (!storedSeenVersion) settings.lastSeenVersion = '0.0.0'
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

/**
 * Force automation off after any deck import.
 *
 * Rules travel inside the config, but the arm switch deliberately does not.
 * Both import paths (Settings → Import and the phone upload) call this so an
 * imported deck can never auto-fire, even when this PC was armed.
 */
export function disarmAutomationAfterImport(settings: SettingsStore): AppSettings {
  return settings.update({ automationEnabled: false })
}
