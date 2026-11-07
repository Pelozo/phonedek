/**
 * Shared media asset metadata for GIF/video backgrounds and button icons.
 *
 * Keep this file free of Node APIs: the desktop asset store and the shared
 * schema both use these lists so an imported file always validates later.
 */

export type AssetKind = 'image' | 'video'

export const IMAGE_ASSET_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] as const
export const VIDEO_ASSET_EXTENSIONS = ['.mp4', '.webm', '.m4v', '.mov'] as const

/** Per-file limits shared by the importer and the backup writer. */
export const IMAGE_ASSET_MAX_BYTES = 25 * 1024 * 1024
export const VIDEO_ASSET_MAX_BYTES = 100 * 1024 * 1024

export const ASSET_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
}

const IMAGE_EXTENSIONS = new Set<string>(IMAGE_ASSET_EXTENSIONS)
const VIDEO_EXTENSIONS = new Set<string>(VIDEO_ASSET_EXTENSIONS)

/** Lower-cased extension including the leading dot, or an empty string. */
export function assetExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

/** Infer the kind from a file name; null for unsupported extensions. */
export function assetKindFromName(name: string): AssetKind | null {
  const extension = assetExtension(name)
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  return null
}

export function isImageAssetName(name: string): boolean {
  return IMAGE_EXTENSIONS.has(assetExtension(name))
}

export function isVideoAssetName(name: string): boolean {
  return VIDEO_EXTENSIONS.has(assetExtension(name))
}

export function assetContentType(name: string): string {
  return ASSET_CONTENT_TYPES[assetExtension(name)] ?? 'application/octet-stream'
}

export function assetMaxBytes(kind: AssetKind): number {
  return kind === 'video' ? VIDEO_ASSET_MAX_BYTES : IMAGE_ASSET_MAX_BYTES
}

export function formatAssetLimit(kind: AssetKind): string {
  return kind === 'video' ? '100 MB' : '25 MB'
}
