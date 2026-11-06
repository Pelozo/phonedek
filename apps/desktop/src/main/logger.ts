import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface Logger {
  readonly logPath: string | null
  info(message: string): void
  warn(message: string): void
  error(message: string, error?: unknown): void
}

function format(level: string, message: string): string {
  return `${new Date().toISOString()} [${level}] ${message}\n`
}

export function createLogger(dir?: string): Logger {
  let logPath: string | null = null
  if (dir) {
    try {
      mkdirSync(dir, { recursive: true })
      logPath = join(dir, 'phonedek.log')
      if (existsSync(logPath) && statSync(logPath).size > 4 * 1024 * 1024) {
        try {
          renameSync(logPath, join(dir, `phonedek-${Date.now()}.log`))
        } catch {
          // ignore rotation failures
        }
      }
    } catch {
      logPath = null
    }
  }

  const write = (level: string, message: string, error?: unknown): void => {
    const detail = error instanceof Error ? `${message}: ${error.stack ?? error.message}` : error !== undefined ? `${message}: ${String(error)}` : message
    const line = format(level, detail)
    if (level === 'ERROR') console.error(line.trimEnd())
    else if (level === 'WARN') console.warn(line.trimEnd())
    else console.log(line.trimEnd())
    if (!logPath) return
    try {
      appendFileSync(logPath, line, 'utf8')
    } catch {
      // Logging must never take the app down.
    }
  }

  return {
    logPath,
    info: (message) => write('INFO', message),
    warn: (message) => write('WARN', message),
    error: (message, error) => write('ERROR', message, error),
  }
}
