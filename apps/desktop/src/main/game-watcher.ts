import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import type { Logger } from './logger'
import { normalizeProcessName, type AutoProfileRule } from './settings-store'

/** How often the configured rules are compared with running processes. */
export const DEFAULT_PROCESS_POLL_MS = 3000

/** Settings snapshot the watcher reads on every tick. */
export interface AutoProfileSettings {
  enabled: boolean
  rules: AutoProfileRule[]
}

/** Injectable process snapshot; tests use a fake and never start a game. */
export interface ProcessProvider {
  list(): Promise<string[]>
}

/** Injectable command runner, used by `createProcessProvider`. */
export type CommandRunner = (command: string, args: string[]) => Promise<string>

export interface GameWatcherOptions {
  /** Read the current settings; the watcher always acts on fresh values. */
  getSettings: () => AutoProfileSettings
  /** Called once when a rule's process appears (and again after a relaunch). */
  onSwitch: (profileId: string, rule: AutoProfileRule) => void
  /** Current profile ids; rules referencing a deleted profile are ignored. */
  getProfileIds?: () => readonly string[]
  provider?: ProcessProvider
  intervalMs?: number
  logger?: Logger
  /** Host platform for the real provider. Defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /** Extra process names to ignore, in addition to the built-in list. */
  ignoredProcesses?: string[]
}

/**
 * Process names that are part of PhoneDeck, the shell or this scan itself.
 * Matching a rule against these would fire on app start or every poll.
 */
const IGNORED_PROCESSES = [
  'phonedek',
  'electron',
  'node',
  'tasklist',
  'ps',
  'sh',
  'bash',
  'zsh',
  'cmd',
  'conhost',
  'powershell',
  'pwsh',
  'keyboard-helper',
  'pointer-helper',
]

/** Run a process-snapshot command with a short timeout and no shell. */
export function runProcessCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(stdout)
      },
    )
  })
}

/**
 * Parse `tasklist /FO CSV /NH` output. The image name is the first CSV field;
 * consume it properly so a quoted name containing commas stays intact.
 */
export function parseTasklistOutput(output: string): string[] {
  const names: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || /^INFO:/i.test(trimmed)) continue

    let field = ''
    if (trimmed.startsWith('"')) {
      let index = 1
      while (index < trimmed.length) {
        const character = trimmed[index]!
        if (character === '"') {
          if (trimmed[index + 1] === '"') {
            field += '"'
            index += 2
            continue
          }
          break
        }
        field += character
        index += 1
      }
    } else {
      field = trimmed.split(',', 1)[0] ?? ''
    }

    const name = normalizeProcessName(field)
    if (name) names.push(name)
  }
  return [...new Set(names)]
}

/** Parse `ps -eo comm=` output; `comm` may be a full path, so take basename. */
export function parsePsOutput(output: string): string[] {
  const names: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const name = normalizeProcessName(line)
    if (name) names.push(name)
  }
  return [...new Set(names)]
}

/** Real no-native-dependency snapshot: tasklist on Windows, ps elsewhere. */
export function createProcessProvider(
  platform: NodeJS.Platform = process.platform,
  run: CommandRunner = runProcessCommand,
): ProcessProvider {
  if (platform === 'win32') {
    return {
      list: async () => parseTasklistOutput(await run('tasklist', ['/FO', 'CSV', '/NH'])),
    }
  }
  return {
    list: async () => parsePsOutput(await run('ps', ['-eo', 'comm='])),
  }
}

/**
 * Poll running process names and ask connected phones to switch profile when a
 * mapped game starts. It reacts to transitions: one switch while the process
 * stays up, another only after it exits and is relaunched. The desktop config
 * is never modified and the chosen profile is not persisted.
 */
export class GameWatcher {
  private readonly provider: ProcessProvider
  private readonly intervalMs: number
  private readonly ignored: Set<string>
  private readonly logger?: Logger
  private timer: NodeJS.Timeout | null = null
  private generation = 0
  private polling = false
  private warned = false
  /** Profile most recently announced, so repeated polls stay quiet. */
  private lastProfileId: string | null = null

  constructor(private readonly options: GameWatcherOptions) {
    this.provider = options.provider ?? createProcessProvider(options.platform)
    this.intervalMs = Math.max(250, options.intervalMs ?? DEFAULT_PROCESS_POLL_MS)
    this.logger = options.logger
    this.ignored = new Set(IGNORED_PROCESSES)
    const ownName = normalizeProcessName(basename(process.execPath))
    if (ownName) this.ignored.add(ownName)
    for (const name of options.ignoredProcesses ?? []) {
      const normalized = normalizeProcessName(name)
      if (normalized) this.ignored.add(normalized)
    }
  }

  get running(): boolean {
    return this.timer !== null
  }

  /** Start or stop the timer after a settings change. */
  refresh(): void {
    const current = this.options.getSettings()
    if (!current.enabled || current.rules.length === 0) {
      this.stop()
      return
    }
    if (!this.timer) this.start()
  }

  start(): void {
    if (this.timer) return
    this.generation += 1
    const generation = this.generation
    this.timer = setInterval(() => {
      void this.poll(generation)
    }, this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    this.generation += 1
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.lastProfileId = null
  }

  dispose(): void {
    this.stop()
  }

  private async poll(generation: number): Promise<void> {
    if (generation !== this.generation || this.polling) return
    const current = this.options.getSettings()
    if (!current.enabled || current.rules.length === 0) return

    this.polling = true
    try {
      const names = await this.provider.list()
      if (generation !== this.generation) return
      this.warned = false

      const running = new Set<string>()
      for (const name of names) {
        const normalized = normalizeProcessName(name)
        if (normalized && !this.ignored.has(normalized)) running.add(normalized)
      }

      const known = this.options.getProfileIds
        ? new Set(this.options.getProfileIds())
        : null
      const rule = current.rules.find((candidate) => {
        const process = normalizeProcessName(candidate.process)
        if (!process || !running.has(process)) return false
        return known === null || known.has(candidate.profileId)
      })

      if (!rule) {
        this.lastProfileId = null
        return
      }
      if (rule.profileId === this.lastProfileId) return

      try {
        this.options.onSwitch(rule.profileId, rule)
      } catch (error) {
        this.lastProfileId = null
        const message = error instanceof Error ? error.message : String(error)
        this.logger?.warn(`Auto-profile switch to "${rule.profileId}" failed: ${message}`)
        return
      }

      this.lastProfileId = rule.profileId
      this.logger?.info(
        `Auto-profile: "${rule.process}" started; switching phones to profile "${rule.profileId}"`,
      )
    } catch (error) {
      // A missing command, timeout or parse failure must not stop the app or
      // disconnect phones. Log one line per outage and try again next tick.
      if (!this.warned) {
        this.warned = true
        const message = error instanceof Error ? error.message : String(error)
        this.logger?.warn(`Auto-profile process scan failed: ${message}`)
      }
    } finally {
      this.polling = false
    }
  }
}
