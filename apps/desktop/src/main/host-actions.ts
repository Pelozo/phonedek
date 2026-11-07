import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import type { Logger } from './logger'

export interface HostActions {
  launch(path: string, args: string[]): Promise<void>
  openUrl(url: string): Promise<void>
  runCommand(command: string, cwd: string | undefined, hidden: boolean): Promise<void>
}

export interface HostActionOptions {
  platform?: NodeJS.Platform
  openPath?: (path: string) => Promise<string>
  openExternal?: (url: string) => Promise<void>
  logger?: Logger
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
  }
}
