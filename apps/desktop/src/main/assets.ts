import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Logger } from './logger'

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const MAX_BYTES = 25 * 1024 * 1024

export const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

export function isSafeAssetName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) && !name.includes('..')
}

export class AssetStore {
  readonly dir: string
  private readonly logger?: Logger

  constructor(dir: string, logger?: Logger) {
    this.dir = dir
    this.logger = logger
    mkdirSync(this.dir, { recursive: true })
  }

  /** Copy an image into the asset store and return its generated file name. */
  importFile(sourcePath: string): string {
    const extension = extname(sourcePath).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error('Only PNG, JPG, WEBP, GIF and BMP images are supported')
    }
    const stats = statSync(sourcePath)
    if (!stats.isFile()) throw new Error('The selected path is not a file')
    if (stats.size > MAX_BYTES) throw new Error('Image is larger than 25 MB')
    const name = `${randomUUID()}${extension}`
    const target = join(this.dir, name)
    copyFileSync(sourcePath, target)
    this.logger?.info(`Imported asset ${name} (${stats.size} bytes)`)
    return name
  }

  /** Resolve an asset name to an absolute path, refusing path traversal. */
  pathFor(name: string): string | null {
    if (!isSafeAssetName(name)) return null
    const base = resolve(this.dir)
    const candidate = resolve(base, name)
    if (candidate !== base && !candidate.startsWith(base + sep)) return null
    if (!existsSync(candidate)) return null
    return candidate
  }

  contentType(name: string): string {
    return CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
  }

  list(): string[] {
    try {
      return readdirSync(this.dir).filter((name) => isSafeAssetName(name))
    } catch {
      return []
    }
  }
}
