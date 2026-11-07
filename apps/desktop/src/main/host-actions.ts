import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Logger } from './logger'

export interface HostActions {
  launch(path: string, args: string[]): Promise<void>
  openUrl(url: string): Promise<void>
  runCommand(command: string, cwd: string | undefined, hidden: boolean): Promise<void>
  /** Capture the full screen on macOS (no shutter sound); returns the saved path. */
  screenshot(): Promise<string>
}

export interface HostActionOptions {
  platform?: NodeJS.Platform
  openPath?: (path: string) => Promise<string>
  openExternal?: (url: string) => Promise<void>
  /** Test seam for the macOS screenshot command; receives the destination file. */
  captureScreen?: (path: string) => Promise<void>
  /** Folder for macOS captures. Empty/omitted = Desktop. */
  screenshotDirectory?: string
  /** Runtime folder lookup; takes precedence over `screenshotDirectory`. */
  getScreenshotDirectory?: () => string
  /** Overrides the user's home directory (used by tests to avoid touching ~/Desktop). */
  homeDir?: string
  logger?: Logger
}

export const MAC_SCREENSHOT_COMMAND = '/usr/sbin/screencapture'
/** `-x` = silent, `-t png` = explicit PNG output; the destination file follows. */
export const MAC_SCREENSHOT_ARGS: readonly string[] = ['-x', '-t', 'png']

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Finder-friendly, colon-free screenshot name, e.g.
 * `PhoneDeck Screenshot 2026-11-07 at 12.34.56.png`.
 */
export function macScreenshotFileName(date: Date): string {
  const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  const time = `${pad2(date.getHours())}.${pad2(date.getMinutes())}.${pad2(date.getSeconds())}`
  return `PhoneDeck Screenshot ${day} at ${time}.png`
}

/** Absolute destination on the user's Desktop. */
export function macScreenshotPath(date: Date, homeDir: string): string {
  return join(homeDir, 'Desktop', macScreenshotFileName(date))
}

/**
 * `screencapture` requires an output path; without one it exits 1 with
 * "no file specified". Array args avoid any shell quoting issues.
 */
export function macScreenshotArgs(path: string): string[] {
  return [...MAC_SCREENSHOT_ARGS, path]
}

/** Never overwrite an existing capture: `… 12.34.56 2.png`, `… 3.png`, … */
function uniqueScreenshotPath(basePath: string): string {
  if (!existsSync(basePath)) return basePath
  const stem = basePath.replace(/\.png$/i, '')
  for (let attempt = 2; attempt < 1000; attempt += 1) {
    const candidate = `${stem} ${attempt}.png`
    if (!existsSync(candidate)) return candidate
  }
  throw new Error(`Could not find an unused screenshot name near ${basePath}`)
}

function screenshotFailure(message: string, destination: string): Error {
  return new Error(
    `macOS screenshot failed: ${message}. Destination: ${destination}. If macOS blocked the capture, ` +
      'allow Screen Recording for PhoneDeck in System Settings → Privacy & Security.',
  )
}

function spawnDetached(
  command: string,
  args: string[],
  options: { cwd?: string; shell?: boolean; hidden?: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
      detached: true,
      stdio: 'ignore',
      windowsHide: options.hidden ?? false,
    })
    let spawned = false
    child.once('error', (error) => {
      if (!spawned) reject(new Error(`Could not start process: ${error.message}`))
    })
    child.once('spawn', () => {
      spawned = true
      child.unref()
      resolve()
    })
  })
}

/**
 * Run a short-lived process and wait for its exit status, surfacing stderr in
 * the rejection so the caller (and the phone) sees a useful error.
 */
function runToCompletion(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = ''
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000)
    })
    child.once('error', (error) => {
      reject(new Error(`Could not start ${command}: ${error.message}`))
    })
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code ?? 'unknown'}${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
    })
  })
}

function looksLikeShellItem(path: string): boolean {
  if (/\.(lnk|url)$/i.test(path)) return true
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * `open -a <app> --args ...` is the only macOS launch path that forwards
 * arguments to an application bundle. Without `-a`, `open` treats the first
 * argument as a document rather than the app itself.
 */
export function macApplicationOpenArgs(path: string, args: readonly string[]): string[] {
  return args.length > 0 ? ['-a', path, '--args', ...args] : ['-a', path]
}

function quoteWindows(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

export function createHostActions(options: HostActionOptions = {}): HostActions {
  const platform = options.platform ?? process.platform
  const logger = options.logger

  const screenshotDirectory = (): string => {
    const configured = (options.getScreenshotDirectory?.() ?? options.screenshotDirectory ?? '').trim()
    if (configured) return configured
    return join(options.homeDir ?? homedir(), 'Desktop')
  }

  return {
    async launch(path, args) {
      if (!path.trim()) throw new Error('Launch action has no path')
      if (platform === 'darwin' && /\.app$/i.test(path)) {
        await spawnDetached('/usr/bin/open', macApplicationOpenArgs(path, args), { hidden: false })
        logger?.info(`Launched ${path}${args.length ? ` ${args.join(' ')}` : ''}`)
        return
      }
      if (options.openPath && looksLikeShellItem(path)) {
        const error = await options.openPath(path)
        if (error) throw new Error(error)
        logger?.info(`Opened shell item ${path}`)
        return
      }
      if (platform === 'win32' && /\.(bat|cmd)$/i.test(path)) {
        const commandLine = [quoteWindows(path), ...args.map(quoteWindows)].join(' ')
        await spawnDetached('cmd.exe', ['/d', '/s', '/c', commandLine], { hidden: false })
        logger?.info(`Launched script ${path}`)
        return
      }
      await spawnDetached(path, args, { hidden: false })
      logger?.info(`Launched ${path}${args.length ? ` ${args.join(' ')}` : ''}`)
    },

    async openUrl(url) {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new Error(`Invalid URL: ${url}`)
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only http and https URLs can be opened')
      }
      if (options.openExternal) {
        await options.openExternal(url)
      } else {
        const command = platform === 'win32' ? 'cmd.exe' : platform === 'darwin' ? 'open' : 'xdg-open'
        const args = platform === 'win32' ? ['/d', '/s', '/c', 'start', '', url] : [url]
        await spawnDetached(command, args, { hidden: true })
      }
      logger?.info(`Opened URL ${url}`)
    },

    async runCommand(command, cwd, hidden) {
      if (!command.trim()) throw new Error('Command action is empty')
      if (platform === 'win32') {
        await spawnDetached(command, [], { cwd, shell: true, hidden })
      } else {
        await spawnDetached('/bin/sh', ['-c', command], { cwd, hidden })
      }
      logger?.info(`Ran command: ${command.slice(0, 140)}`)
    },

    async screenshot() {
      if (platform !== 'darwin') {
        throw new Error('Full-screen screenshot is only implemented on macOS')
      }

      const directory = screenshotDirectory()
      try {
        mkdirSync(directory, { recursive: true })
      } catch (error) {
        throw screenshotFailure(
          `could not create ${directory}: ${error instanceof Error ? error.message : String(error)}`,
          directory,
        )
      }
      try {
        if (!statSync(directory).isDirectory()) {
          throw new Error('the configured screenshot path is not a directory')
        }
        accessSync(directory, constants.W_OK)
      } catch (error) {
        throw screenshotFailure(
          `cannot use ${directory}: ${error instanceof Error ? error.message : String(error)}`,
          directory,
        )
      }

      let target: string
      try {
        target = uniqueScreenshotPath(join(directory, macScreenshotFileName(new Date())))
      } catch (error) {
        throw screenshotFailure(
          error instanceof Error ? error.message : String(error),
          directory,
        )
      }

      try {
        if (options.captureScreen) {
          await options.captureScreen(target)
        } else {
          await runToCompletion(MAC_SCREENSHOT_COMMAND, macScreenshotArgs(target))
        }
      } catch (error) {
        throw screenshotFailure(
          error instanceof Error ? error.message : String(error),
          target,
        )
      }
      logger?.info(`Saved full-screen screenshot to ${target}`)
      return target
    },
  }
}
