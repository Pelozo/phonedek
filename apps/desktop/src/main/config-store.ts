import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createDefaultConfig, migrateStarterDeck } from '@phonedek/shared'
import { parseConfig } from '@phonedek/shared'
import type { DeckConfig } from '@phonedek/shared'
import type { Logger } from './logger'

export interface ConfigStoreOptions {
  /** Directory that holds config.json and assets/. */
  dir: string
  now?: () => Date
  logger?: Logger
}

export type ConfigListener = (config: DeckConfig) => void

/**
 * Desktop-owned configuration. Writes are atomic (temp file + rename), and a
 * corrupt file is preserved as config.corrupt-<timestamp>.json before the
 * starter config is restored.
 */
export class ConfigStore {
  readonly file: string
  readonly assetsDir: string
  private config: DeckConfig
  private readonly listeners = new Set<ConfigListener>()
  private readonly now: () => Date
  private readonly logger?: Logger
  private lastError: string | null = null

  constructor(options: ConfigStoreOptions) {
    this.file = join(options.dir, 'config.json')
    this.assetsDir = join(options.dir, 'assets')
    this.now = options.now ?? (() => new Date())
    this.logger = options.logger
    mkdirSync(this.assetsDir, { recursive: true })
    this.config = this.readOrCreate()
  }

  get(): DeckConfig {
    return this.config
  }

  getLastError(): string | null {
    return this.lastError
  }

  replace(input: unknown): DeckConfig {
    const parsed = parseConfig(input)
    const next: DeckConfig = { ...parsed, updatedAt: this.now().toISOString() }
    this.commit(next)
    return next
  }

  update(mutator: (draft: DeckConfig) => DeckConfig | void): DeckConfig {
    const draft = structuredClone(this.config)
    const returned = mutator(draft)
    const candidate = returned ?? draft
    const next = parseConfig({ ...candidate, updatedAt: this.now().toISOString() })
    this.commit(next)
    return next
  }

  onChange(listener: ConfigListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private readOrCreate(): DeckConfig {
    if (!existsSync(this.file)) {
      const config = createDefaultConfig(process.platform, this.now())
      this.write(config)
      return config
    }
    const raw = readFileSync(this.file, 'utf8')
    try {
      const parsed = parseConfig(JSON.parse(raw))
      const migrated = migrateStarterDeck(parsed, process.platform)
      if (migrated !== parsed) this.write(migrated)
      return migrated
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      const backup = join(dirname(this.file), `config.corrupt-${Date.now()}.json`)
      try {
        copyFileSync(this.file, backup)
      } catch {
        // best effort
      }
      this.logger?.warn(`Config was invalid; backed up to ${backup}. ${this.lastError}`)
      const config = createDefaultConfig(process.platform, this.now())
      this.write(config)
      return config
    }
  }

  private commit(config: DeckConfig): void {
    this.write(config)
    this.config = config
    this.lastError = null
    for (const listener of this.listeners) {
      try {
        listener(config)
      } catch (error) {
        this.logger?.error('Config listener failed', error)
      }
    }
  }

  private write(config: DeckConfig): void {
    const temp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    renameSync(temp, this.file)
  }
}
