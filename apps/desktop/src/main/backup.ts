import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import AdmZip from 'adm-zip'
import { validateConfig } from '@phonedek/shared'
import type { DeckConfig } from '@phonedek/shared'
import { isSafeAssetName } from './assets'

const CONFIG_ENTRY = 'phonedek-config.json'
const LEGACY_CONFIG_ENTRY = 'config.json'
const ASSET_PREFIX = 'assets/'
const MAX_CONFIG_BYTES = 5 * 1024 * 1024
const MAX_ASSET_BYTES = 25 * 1024 * 1024
const MAX_TOTAL_BYTES = 300 * 1024 * 1024
const MAX_ENTRIES = 2000

const README = `PhoneDeck backup

This ZIP contains:
  phonedek-config.json  profiles, pages, buttons and actions
  assets/               background images referenced by the config

Import it from PhoneDeck Desktop -> Settings -> Import.
The pairing PIN and port are not included; pairing is per installation.
`

export interface BackupReadResult {
  config: DeckConfig
  assets: Map<string, Buffer>
  warnings: string[]
}

export interface BackupWriteResult {
  assets: number
  bytes: number
  warnings: string[]
}

function parseConfigText(raw: string, label: string): DeckConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  const result = validateConfig(parsed)
  if (!result.ok) throw new Error(`${label} is not a valid PhoneDeck config:\n${result.errors.join('\n')}`)
  return result.config
}

/** Read a ZIP backup, or a legacy/config-only JSON file. */
export function readBackupFile(source: string, sourceName = basename(source)): BackupReadResult {
  const buffer = readFileSync(source)
  if (sourceName.toLowerCase().endsWith('.json')) {
    return { config: parseConfigText(buffer.toString('utf8'), sourceName), assets: new Map(), warnings: [] }
  }

  let zip: AdmZip
  try {
    zip = new AdmZip(buffer)
  } catch {
    throw new Error('That file is not a readable ZIP backup')
  }

  const entries = zip.getEntries()
  if (entries.length > MAX_ENTRIES) throw new Error('That backup contains too many files')

  let total = 0
  let configText: string | null = null
  const assets = new Map<string, Buffer>()
  const warnings: string[] = []

  for (const entry of entries) {
    if (entry.isDirectory) continue
    const name = entry.entryName.replace(/\\/g, '/')
    const declaredSize = entry.header.size
    const isConfig = name === CONFIG_ENTRY || name === LEGACY_CONFIG_ENTRY
    if (!isConfig && !name.startsWith(ASSET_PREFIX)) continue

    total += declaredSize
    if (total > MAX_TOTAL_BYTES) throw new Error('That backup is larger than 300 MB when unpacked')

    if (isConfig) {
      if (declaredSize > MAX_CONFIG_BYTES) throw new Error('The config inside the backup is too large')
      configText = entry.getData().toString('utf8')
      continue
    }

    const assetName = name.slice(ASSET_PREFIX.length)
    if (!isSafeAssetName(assetName) || assetName.includes('/')) {
      warnings.push(`Skipped unsafe asset entry: ${name}`)
      continue
    }
    if (declaredSize > MAX_ASSET_BYTES) {
      warnings.push(`Skipped oversized asset: ${assetName}`)
      continue
    }
    if (assets.has(assetName)) warnings.push(`Duplicate asset replaced: ${assetName}`)
    assets.set(assetName, entry.getData())
  }

  if (!configText) throw new Error(`The backup does not contain ${CONFIG_ENTRY}`)
  return { config: parseConfigText(configText, CONFIG_ENTRY), assets, warnings }
}

/** Create a ZIP with the current config and every image in the asset store. */
export function writeBackupFile(target: string, config: DeckConfig, assetsDir: string): BackupWriteResult {
  const zip = new AdmZip()
  zip.addFile(CONFIG_ENTRY, Buffer.from(`${JSON.stringify(config, null, 2)}\n`, 'utf8'))
  zip.addFile('README.txt', Buffer.from(README, 'utf8'))

  let count = 0
  let bytes = 0
  const warnings: string[] = []
  for (const name of readdirSync(assetsDir)) {
    if (!isSafeAssetName(name)) continue
    const path = join(assetsDir, name)
    try {
      const stats = statSync(path)
      if (!stats.isFile()) continue
      if (stats.size > MAX_ASSET_BYTES) {
        warnings.push(`Skipped oversized asset: ${name}`)
        continue
      }
      zip.addFile(`${ASSET_PREFIX}${name}`, readFileSync(path))
      count += 1
      bytes += stats.size
    } catch {
      warnings.push(`Could not include asset: ${name}`)
    }
  }

  zip.writeZip(target)
  return { assets: count, bytes, warnings }
}
