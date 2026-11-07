import type { UpdateState, UpdateStatus } from './api'

export type UpdateTone = 'neutral' | 'info' | 'success' | 'error'

export interface UpdateSummary {
  title: string
  detail: string
  tone: UpdateTone
}

/**
 * A check is pointless (and can race with electron-updater) while an update
 * is already being checked, offered, downloaded, or waiting for a restart.
 */
export function isCheckBlocked(status: UpdateStatus): boolean {
  return (
    status.state === 'checking' ||
    status.state === 'available' ||
    status.state === 'downloading' ||
    status.state === 'downloaded'
  )
}

export function canCheckForUpdates(status: UpdateStatus): boolean {
  return status.canCheck && !isCheckBlocked(status)
}

export function isUpdateNoticeVisible(status: UpdateStatus): boolean {
  return status.state === 'available' || status.state === 'downloading' || status.state === 'downloaded'
}

export function clampPercent(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function formatBytes(value: number | undefined): string | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null
  if (value < 1024) return `${Math.round(value)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = value / 1024
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  const rounded = amount >= 100 ? Math.round(amount) : Math.round(amount * 10) / 10
  return `${rounded} ${units[unit]}`
}

export function formatSpeed(bytesPerSecond: number | undefined): string | null {
  const formatted = formatBytes(bytesPerSecond)
  return formatted ? `${formatted}/s` : null
}

export function updateProgressPercent(status: UpdateStatus): number {
  return clampPercent(status.progress)
}

export function updateIndicatorLabel(status: UpdateStatus): string {
  switch (status.state) {
    case 'available':
      return status.availableVersion ? `Update ${status.availableVersion}` : 'Update available'
    case 'downloading':
      return status.progress == null ? 'Downloading update' : `Update ${clampPercent(status.progress)}%`
    case 'downloaded':
      return 'Update ready'
    default:
      return ''
  }
}

function versionLabel(version: string | undefined): string {
  return version ? `Version ${version}` : 'A new version'
}

export function formatProgressDetail(status: UpdateStatus): string {
  const parts = [`${updateProgressPercent(status)}%`]
  const speed = formatSpeed(status.bytesPerSecond)
  if (speed) parts.push(speed)
  const transferred = formatBytes(status.transferred)
  const total = formatBytes(status.total)
  if (transferred && total) parts.push(`${transferred} of ${total}`)
  return parts.join(' · ')
}

export function summarizeUpdateStatus(status: UpdateStatus): UpdateSummary {
  switch (status.state) {
    case 'disabled':
      return {
        title: 'Automatic updates are unavailable',
        detail:
          status.message ??
          'Only the installed Windows app can update itself. Development and Linux builds must be updated manually.',
        tone: 'neutral',
      }
    case 'idle':
      return {
        title: `PhoneDeck ${status.currentVersion}`,
        detail: status.message ?? 'You are up to date.',
        tone: 'neutral',
      }
    case 'checking':
      return {
        title: 'Checking for updates…',
        detail: 'Looking for the newest public GitHub release.',
        tone: 'info',
      }
    case 'available':
      return {
        title: `${versionLabel(status.availableVersion)} is available`,
        detail: 'PhoneDeck is downloading the update in the background. Keep the app running.',
        tone: 'info',
      }
    case 'downloading':
      return {
        title: `Downloading ${versionLabel(status.availableVersion).toLowerCase()}`,
        detail: formatProgressDetail(status),
        tone: 'info',
      }
    case 'downloaded':
      return {
        title: `${versionLabel(status.availableVersion)} is ready`,
        detail: 'Restart PhoneDeck to finish installing. Your profiles and settings are kept.',
        tone: 'success',
      }
    case 'error':
      return {
        title: 'Update check failed',
        detail: status.message ?? 'Could not check for updates. Try again later.',
        tone: 'error',
      }
  }
}

/**
 * Turn low-level electron-updater/network errors into text that makes sense
 * in the UI. The raw error is still written to the log by UpdateService.
 */
export function describeUpdateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const message = raw.trim()
  if (!message) return 'Could not check for updates. Try again later.'

  const lower = message.toLowerCase()
  if (/rate.?limit|too many requests|\b403\b/.test(lower)) {
    return 'GitHub is limiting update checks right now. Try again in a few minutes.'
  }
  if (/sha512|checksum|integrity|verification failed/.test(lower)) {
    return 'The downloaded update failed verification and was discarded. Try again or install the latest release manually.'
  }
  if (/app-update\.yml|latest\.yml|update config|no published|no release/.test(lower)) {
    return 'This build has no usable update feed. Download the latest installer from GitHub Releases.'
  }
  if (/\b404\b|not found/.test(lower)) {
    return 'No update release was found for this build yet. Try again later.'
  }
  if (/net::err_|enotfound|eai_again|econn|etimedout|timed? out|network|offline|internet|socket/.test(lower)) {
    return 'Could not reach GitHub. Check your internet connection and try again.'
  }
  if (/eacces|ebusy|eperm|permission denied|access is denied/.test(lower)) {
    return 'Windows could not save the update. Close other copies of PhoneDeck and try again.'
  }
  const detail = message.length > 180 ? `${message.slice(0, 177)}…` : message
  return `Update failed: ${detail}`
}

export function isBusyUpdateState(state: UpdateState): boolean {
  return state === 'checking' || state === 'downloading'
}
