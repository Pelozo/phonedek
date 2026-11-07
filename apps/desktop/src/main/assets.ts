import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  ASSET_CONTENT_TYPES,
  assetKindFromName,
  assetMaxBytes,
  assetContentType,
  formatAssetLimit,
  type AssetKind,
} from '@phonedek/shared'
import type { Logger } from './logger'

/** Kept for callers that imported the map from this module. */
export const CONTENT_TYPES = ASSET_CONTENT_TYPES

export function isSafeAssetName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) && !name.includes('..')
}

function kindLabel(kind: AssetKind): string {
  return kind === 'video' ? 'video' : 'image'
}

function unsupportedExtensionMessage(kind: AssetKind): string {
  return kind === 'video'
    ? 'Only MP4, WEBM, M4V and MOV videos are supported'
    : 'Only PNG, JPG, WEBP, GIF and BMP images are supported'
}

function checkExtension(name: string, kind: AssetKind): boolean {
  const inferred = assetKindFromName(name)
  return inferred === kind
}

function checkSize(name: string, bytes: number, kind: AssetKind): void {
  const limit = assetMaxBytes(kind)
  if (bytes > limit) {
    throw new Error(`${kind === 'video' ? 'Video' : 'Image'} ${name ? `"${name}" ` : ''}is larger than ${formatAssetLimit(kind)}`)
  }
}

export class AssetStore {
  readonly dir: string
  private readonly logger?: Logger

  constructor(dir: string, logger?: Logger) {
    this.dir = dir
    this.logger = logger
    mkdirSync(this.dir, { recursive: true })
  }

  /**
   * Copy an image/video into the asset store and return its generated file
   * name. `kind` defaults to `image` so existing callers keep working.
   */
  importFile(sourcePath: string, kind: AssetKind = 'image'): string {
    const extension = extname(sourcePath).toLowerCase()
    if (!checkExtension(sourcePath, kind)) {
      throw new Error(unsupportedExtensionMessage(kind))
    }
    const stats = statSync(sourcePath)
    if (!stats.isFile()) throw new Error('The selected path is not a file')
    checkSize('', stats.size, kind)
    const name = `${randomUUID()}${extension}`
    const target = join(this.dir, name)
    copyFileSync(sourcePath, target)
    this.logger?.info(`Imported ${kindLabel(kind)} asset ${name} (${stats.size} bytes)`)
    return name
  }

  /**
   * Write an asset imported from a backup ZIP. Returns false for unsafe names
   * or extensions that do not match the kind.
   *
   * `kind` is inferred from the file name when omitted so existing backup
   * imports (which call `importBuffer(name, data)`) keep working for videos.
   */
  importBuffer(name: string, data: Buffer, kind?: AssetKind): boolean {
    if (!isSafeAssetName(name)) return false
    const resolvedKind = kind ?? assetKindFromName(name) ?? 'image'
    if (!checkExtension(name, resolvedKind)) return false
    checkSize(name, data.length, resolvedKind)
    writeFileSync(join(this.dir, name), data)
    this.logger?.info(`Imported ${kindLabel(resolvedKind)} asset ${name} (${data.length} bytes)`)
    return true
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
    return assetContentType(name)
  }

  list(): string[] {
    try {
      return readdirSync(this.dir).filter((name) => isSafeAssetName(name))
    } catch {
      return []
    }
  }
}
