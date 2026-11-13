import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, statSync, accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ObsPlanStep } from '@phonedek/shared'
import type { Logger } from './logger'
import {
  LINUX_INPUT_COMMAND,
  MAC_INPUT_COMMAND,
  linuxInputGainArgs,
  linuxInputMuteArgs,
  linuxInputMuteReadArgs,
  macInputGainArgs,
  macInputReadArgs,
  parseMacInputOutput,
  parsePactlSourceMuteOutput,
} from './microphone-source'

export interface HostActions {
  launch(path: string, args: string[]): Promise<void>
  openUrl(url: string): Promise<void>
  runCommand(command: string, cwd: string | undefined, hidden: boolean): Promise<void>
  /** Capture the full screen on macOS or Windows; returns the saved path. */
  screenshot(): Promise<string>
  /** Set system output volume, 0..100. */
  setVolume(level: number): Promise<void>
  /** Set default capture-device gain, 0..100. */
  setInputGain(level: number): Promise<void>
  /** Toggle mute on the default capture device. */
  toggleInputMute(): Promise<void>
  /** Toggle mute on one OBS input (optional; absent when OBS is not wired). */
  toggleObsInputMute?(input?: string): Promise<void>
  /** Run any OBS plan step (optional; absent when OBS is not wired). */
  runObsAction?(step: ObsPlanStep): Promise<void>
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
  /** Test seam for absolute volume; receives 0..100. */
  setSystemVolume?: (level: number) => Promise<void>
  /** Test seam / shared controller for microphone gain; receives 0..100. */
  setSystemInputGain?: (level: number) => Promise<void>
  /** Test seam / shared controller for microphone mute toggling. */
  toggleSystemInputMute?: () => Promise<void>
  /** Test seam / shared controller for toggling an OBS input's mute. */
  toggleObsInputMute?: (input?: string) => Promise<void>
  /** Test seam / shared controller for the full OBS action family. */
  runObsAction?: (step: ObsPlanStep) => Promise<void>
  /** Overrides the user's home directory (used by tests to avoid touching ~/Desktop). */
  homeDir?: string
  logger?: Logger
}

export const MAC_SCREENSHOT_COMMAND = '/usr/sbin/screencapture'
/** `-x` = silent, `-t png` = explicit PNG output; the destination file follows. */
export const MAC_SCREENSHOT_ARGS: readonly string[] = ['-x', '-t', 'png']

export const WINDOWS_SCREENSHOT_COMMAND = 'powershell.exe'
/**
 * PowerShell script that captures the whole virtual desktop (all monitors)
 * directly to PNG. `-EncodedCommand` avoids every quote/argument-escaping trap
 * between Electron, cmd and PowerShell.
 */
export function windowsScreenshotArgs(path: string): string[] {
  const escaped = path.replace(/'/g, "''")
  const script = [
    "Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();' -Name Dpi -Namespace Win32",
    '[Win32.Dpi]::SetProcessDPIAware() | Out-Null',
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height',
    '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
    '$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)',
    `$bitmap.Save('${escaped}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    '$graphics.Dispose()',
    '$bitmap.Dispose()',
  ].join('\n')
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ]
}

export const MAC_VOLUME_COMMAND = '/usr/bin/osascript'
export function macVolumeArgs(level: number): string[] {
  return ['-e', `set volume output volume ${level}`]
}

export const LINUX_VOLUME_COMMAND = 'pactl'
export function linuxVolumeArgs(level: number): string[] {
  return ['set-sink-volume', '@DEFAULT_SINK@', `${level}%`]
}

/** Validate and clamp an absolute volume level to an integer 0..100. */
export function clampVolumeLevel(level: number): number {
  if (!Number.isFinite(level)) throw new Error('Volume level must be a finite number')
  return Math.max(0, Math.min(100, Math.round(level)))
}

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

function screenshotFailure(
  message: string,
  destination: string,
  platform: NodeJS.Platform,
): Error {
  const hint =
    platform === 'darwin'
      ? ' If macOS blocked the capture, allow Screen Recording for PhoneDeck in ' +
        'System Settings → Privacy & Security.'
      : ''
  const label = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform
  return new Error(`${label} screenshot failed: ${message}. Destination: ${destination}.${hint}`)
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

/** Run a short-lived command and return stdout (used by macOS input-mute emulation). */
function runCapture(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout = (stdout + chunk).slice(-4000)
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000)
    })
    child.once('error', (error) => {
      reject(new Error(`Could not start ${command}: ${error.message}`))
    })
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout)
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

  // macOS has no system input mute. If no shared microphone controller was
  // injected, emulate it here: remember the last gain, set it to 0, restore it.
  let macInputMuted = false
  let macSavedInputGain = 50

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

    async setVolume(level) {
      const value = clampVolumeLevel(level)
      if (options.setSystemVolume) {
        await options.setSystemVolume(value)
      } else if (platform === 'darwin') {
        await runToCompletion(MAC_VOLUME_COMMAND, macVolumeArgs(value))
      } else if (platform === 'linux') {
        try {
          await runToCompletion(LINUX_VOLUME_COMMAND, linuxVolumeArgs(value))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(
            `Could not set system volume with pactl. Install PulseAudio/PipeWire and ensure "pactl" is on PATH. ${message}`,
          )
        }
      } else if (platform === 'win32') {
        throw new Error('Absolute volume is not implemented on Windows yet.')
      } else {
        throw new Error(`Absolute volume is not implemented on ${platform}.`)
      }
      logger?.info(`Set system volume to ${value}%`)
    },

    async setInputGain(level) {
      const value = clampVolumeLevel(level)
      if (options.setSystemInputGain) {
        await options.setSystemInputGain(value)
      } else if (platform === 'darwin') {
        await runToCompletion(MAC_INPUT_COMMAND, macInputGainArgs(value))
        macInputMuted = false
      } else if (platform === 'linux') {
        try {
          await runToCompletion(LINUX_INPUT_COMMAND, linuxInputGainArgs(value))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(
            `Could not set microphone gain with pactl. Install PulseAudio/PipeWire and ensure "pactl" is on PATH. ${message}`,
          )
        }
      } else if (platform === 'win32') {
        throw new Error('Microphone gain is not available on Windows without the keyboard helper.')
      } else {
        throw new Error(`Microphone gain is not implemented on ${platform}.`)
      }
      logger?.info(`Set microphone gain to ${value}%`)
    },

    async toggleInputMute() {
      if (options.toggleSystemInputMute) {
        await options.toggleSystemInputMute()
      } else if (platform === 'darwin') {
        if (macInputMuted) {
          await runToCompletion(MAC_INPUT_COMMAND, macInputGainArgs(macSavedInputGain))
          macInputMuted = false
        } else {
          const current = parseMacInputOutput(
            await runCapture(MAC_INPUT_COMMAND, macInputReadArgs()),
          )
          if (current > 0) macSavedInputGain = current
          await runToCompletion(MAC_INPUT_COMMAND, macInputGainArgs(0))
          macInputMuted = true
        }
      } else if (platform === 'linux') {
        try {
          const current = parsePactlSourceMuteOutput(
            await runCapture(LINUX_INPUT_COMMAND, linuxInputMuteReadArgs()),
          )
          await runToCompletion(LINUX_INPUT_COMMAND, linuxInputMuteArgs(!current))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(
            `Could not toggle microphone mute with pactl. Install PulseAudio/PipeWire and ensure "pactl" is on PATH. ${message}`,
          )
        }
      } else if (platform === 'win32') {
        throw new Error('Microphone mute is not available on Windows without the keyboard helper.')
      } else {
        throw new Error(`Microphone mute is not implemented on ${platform}.`)
      }
      logger?.info('Toggled microphone mute')
    },

    ...(options.toggleObsInputMute
      ? {
          async toggleObsInputMute(input?: string) {
            await options.toggleObsInputMute!(input)
            logger?.info(input ? `Toggled OBS input mute: ${input}` : 'Toggled OBS input mute')
          },
        }
      : {}),

    ...(options.runObsAction
      ? {
          async runObsAction(step: ObsPlanStep) {
            await options.runObsAction!(step)
            logger?.info(`Ran OBS action: ${step.action}`)
          },
        }
      : {}),

    async screenshot() {
      if (platform !== 'darwin' && platform !== 'win32') {
        throw new Error('Full-screen screenshot is only implemented on macOS and Windows')
      }

      const directory = screenshotDirectory()
      try {
        mkdirSync(directory, { recursive: true })
      } catch (error) {
        throw screenshotFailure(
          `could not create ${directory}: ${error instanceof Error ? error.message : String(error)}`,
          directory,
          platform,
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
          platform,
        )
      }

      let target: string
      try {
        target = uniqueScreenshotPath(join(directory, macScreenshotFileName(new Date())))
      } catch (error) {
        throw screenshotFailure(
          error instanceof Error ? error.message : String(error),
          directory,
          platform,
        )
      }

      try {
        if (options.captureScreen) {
          await options.captureScreen(target)
        } else if (platform === 'win32') {
          await runToCompletion(WINDOWS_SCREENSHOT_COMMAND, windowsScreenshotArgs(target))
          if (!existsSync(target) || statSync(target).size === 0) {
            throw new Error('the capture did not write a file')
          }
        } else {
          await runToCompletion(MAC_SCREENSHOT_COMMAND, macScreenshotArgs(target))
        }
      } catch (error) {
        throw screenshotFailure(
          error instanceof Error ? error.message : String(error),
          target,
          platform,
        )
      }
      logger?.info(`Saved full-screen screenshot to ${target}`)
      return target
    },
  }
}
