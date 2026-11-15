import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import type { Logger } from './logger'
import {
  autoProfileRevertTargetId,
  normalizeProcessName,
  type AutoProfileRule,
} from './settings-store'

/** How often the configured rules are compared with running processes. */
export const DEFAULT_PROCESS_POLL_MS = 3000

/**
 * Wait this long after a matched game disappears before returning phones to
 * the revert profile. A launcher handoff or a quick restart usually restores
 * the game process within this window, which cancels the return.
 */
export const DEFAULT_REVERT_DEBOUNCE_MS = 5000

/** Settings snapshot the watcher reads on every tick. */
export interface AutoProfileSettings {
  enabled: boolean
  rules: AutoProfileRule[]
  /** Return phones to `revertProfileId` after a matched game exits. */
  revertEnabled: boolean
  /** Target profile id; may reference a deleted profile. */
  revertProfileId?: string
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
  /** Called once after a matched game exits and no other mapped game runs. */
  onRevert?: (profileId: string) => void
  /** Current profile ids; rules referencing a deleted profile are ignored. */
  getProfileIds?: () => readonly string[]
  provider?: ProcessProvider
  intervalMs?: number
  /** Debounce before reverting after an exit. Defaults to 5 seconds. */
  revertDebounceMs?: number
  logger?: Logger
  /** Host platform for the real provider. Defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /** Extra process names to ignore, in addition to the built-in list. */
  ignoredProcesses?: string[]
  /**
   * Keep the shared poller running for another consumer (event rules) even
   * when auto-profile itself is disabled or has no rules.
   */
  keepPolling?: () => boolean
  /**
   * Called after every successful process snapshot, even when auto-profile is
   * off. `running` is normalized and already filtered of PhoneDeck/shells.
   */
  onSnapshot?: (running: ReadonlySet<string>) => void
}

/**
 * Process names that are part of PhoneDeck, the shell or this scan itself.
 * Matching a rule against these would fire on app start or every poll.
 */
export const IGNORED_PROCESSES = [
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
 * stays up, another only after it exits and is relaunched. When the matched
 * game exits and no other mapped game is running, it optionally returns the
 * phones to a configured profile after a short debounce. The desktop config is
 * never modified and the chosen profile is not persisted.
 */
export class GameWatcher {
  private readonly provider: ProcessProvider
  private readonly intervalMs: number
  private readonly revertDebounceMs: number
  private readonly ignored: Set<string>
  private readonly logger?: Logger
  private timer: NodeJS.Timeout | null = null
  private revertTimer: NodeJS.Timeout | null = null
  private generation = 0
  private polling = false
  private warned = false
  private snapshotWarned = false
  /** Most recent rule announced, so repeated polls stay quiet. */
  private lastMatch: { profileId: string; process: string } | null = null

  constructor(private readonly options: GameWatcherOptions) {
    this.provider = options.provider ?? createProcessProvider(options.platform)
    this.intervalMs = Math.max(250, options.intervalMs ?? DEFAULT_PROCESS_POLL_MS)
    this.revertDebounceMs = Math.max(0, options.revertDebounceMs ?? DEFAULT_REVERT_DEBOUNCE_MS)
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

  /** Start or stop the timer after a settings or rule change. */
  refresh(): void {
    const current = this.options.getSettings()
    if (!this.shouldPoll(current)) {
      this.stop()
      return
    }
    if (!current.enabled || !current.revertEnabled || !current.revertProfileId) this.cancelRevert()
    // Event rules keep the poller alive; turning auto-profile off must still
    // forget the last announced game so re-enabling switches again.
    if (!current.enabled || current.rules.length === 0) this.lastMatch = null
    if (!this.timer) this.start()
  }

  /** Auto-profile rules and/or another consumer (event rules) need snapshots. */
  private shouldPoll(current: AutoProfileSettings): boolean {
    if (current.enabled && current.rules.length > 0) return true
    return this.options.keepPolling?.() === true
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
    this.cancelRevert()
    this.lastMatch = null
  }

  dispose(): void {
    this.stop()
  }

  private cancelRevert(): void {
    if (!this.revertTimer) return
    clearTimeout(this.revertTimer)
    this.revertTimer = null
  }

  /** Process names in the snapshot, normalized and without PhoneDeck/shells. */
  private runningProcesses(names: readonly string[]): Set<string> {
    const running = new Set<string>()
    for (const name of names) {
      const normalized = normalizeProcessName(name)
      if (normalized && !this.ignored.has(normalized)) running.add(normalized)
    }
    return running
  }

  /** First rule whose process is running and whose profile still exists. */
  private matchingRule(
    current: AutoProfileSettings,
    running: ReadonlySet<string>,
  ): AutoProfileRule | null {
    const known = this.options.getProfileIds
      ? new Set(this.options.getProfileIds())
      : null
    return (
      current.rules.find((candidate) => {
        const process = normalizeProcessName(candidate.process)
        if (!process || !running.has(process)) return false
        return known === null || known.has(candidate.profileId)
      }) ?? null
    )
  }

  private async poll(generation: number): Promise<void> {
    if (generation !== this.generation || this.polling) return
    const current = this.options.getSettings()
    if (!this.shouldPoll(current)) return
    const autoProfile = current.enabled && current.rules.length > 0

    this.polling = true
    try {
      const names = await this.provider.list()
      if (generation !== this.generation) return
      this.warned = false

      const running = this.runningProcesses(names)
      // Event rules consume the same snapshot; a listener error must never
      // break auto-profile or stop the poller.
      try {
        this.options.onSnapshot?.(running)
        this.snapshotWarned = false
      } catch (error) {
        if (!this.snapshotWarned) {
          this.snapshotWarned = true
          const message = error instanceof Error ? error.message : String(error)
          this.logger?.warn(`Process snapshot listener failed: ${message}`)
        }
      }

      if (!autoProfile) return
      const rule = this.matchingRule(current, running)

      if (!rule) {
        // A mapped game was running and is now gone (or lost its profile).
        // Do not revert while the process itself is still alive, and let a
        // pending debounce handle the actual exit transition.
        if (this.lastMatch && !running.has(this.lastMatch.process)) {
          const exited = this.lastMatch
          this.lastMatch = null
          this.scheduleRevert(generation)
          this.logger?.info(
            `Auto-profile: "${exited.process}" exited; checking whether to return phones to a profile`,
          )
        }
        return
      }

      // Any valid mapped game running cancels a pending return, including a
      // different game that took over from the one that just exited.
      this.cancelRevert()
      if (rule.profileId === this.lastMatch?.profileId) return

      try {
        this.options.onSwitch(rule.profileId, rule)
      } catch (error) {
        this.lastMatch = null
        const message = error instanceof Error ? error.message : String(error)
        this.logger?.warn(`Auto-profile switch to "${rule.profileId}" failed: ${message}`)
        return
      }

      this.lastMatch = {
        profileId: rule.profileId,
        process: normalizeProcessName(rule.process) ?? rule.process,
      }
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

  /**
   * Arm the return timer once. Settings are read again when it fires, so
   * disabling the feature or deleting the target cancels the effect even if a
   * refresh did not clear the timer.
   */
  private scheduleRevert(generation: number): void {
    if (this.revertTimer) return
    const current = this.options.getSettings()
    const target = autoProfileRevertTargetId(
      {
        autoProfileRevertEnabled: current.revertEnabled,
        autoProfileRevertProfileId: current.revertProfileId,
      },
      this.options.getProfileIds ? new Set(this.options.getProfileIds()) : undefined,
    )
    if (!target) return

    this.revertTimer = setTimeout(() => {
      this.revertTimer = null
      return this.revert(generation)
    }, this.revertDebounceMs)
    this.revertTimer.unref?.()
  }

  private async revert(generation: number): Promise<void> {
    if (generation !== this.generation) return
    const current = this.options.getSettings()
    if (!current.enabled) return

    const known = this.options.getProfileIds
      ? new Set(this.options.getProfileIds())
      : undefined
    const target = autoProfileRevertTargetId(
      {
        autoProfileRevertEnabled: current.revertEnabled,
        autoProfileRevertProfileId: current.revertProfileId,
      },
      known,
    )
    if (!target) return

    // A switch may have happened between the timer firing and this callback.
    if (this.lastMatch) return

    // One last snapshot closes the race where a game restarted after the exit
    // poll but before the debounce elapsed. The next poll switches normally.
    let names: string[]
    try {
      names = await this.provider.list()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger?.warn(`Auto-profile return check failed: ${message}`)
      return
    }
    if (generation !== this.generation) return
    if (this.matchingRule(current, this.runningProcesses(names))) return

    try {
      this.options.onRevert?.(target)
      this.logger?.info(`Auto-profile: returning phones to profile "${target}"`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger?.warn(`Auto-profile return to "${target}" failed: ${message}`)
    }
  }
}
