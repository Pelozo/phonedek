import { describe, expect, it } from 'vitest'
import type { UpdateState, UpdateStatus } from '../src/shared/api'
import {
  canCheckForUpdates,
  clampPercent,
  describeUpdateError,
  formatBytes,
  formatProgressDetail,
  formatSpeed,
  isCheckBlocked,
  isUpdateNoticeVisible,
  summarizeUpdateStatus,
  updateIndicatorLabel,
  updateProgressPercent,
} from '../src/shared/update-status'

function status(state: UpdateState, patch: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    state,
    currentVersion: '0.1.3',
    canCheck: true,
    ...patch,
  }
}

describe('update status helpers', () => {
  it('blocks checks while an update is already in flight', () => {
    expect(isCheckBlocked(status('checking'))).toBe(true)
    expect(isCheckBlocked(status('available'))).toBe(true)
    expect(isCheckBlocked(status('downloading'))).toBe(true)
    expect(isCheckBlocked(status('downloaded'))).toBe(true)
    expect(isCheckBlocked(status('idle'))).toBe(false)
    expect(isCheckBlocked(status('error'))).toBe(false)
    expect(isCheckBlocked(status('disabled'))).toBe(false)
  })

  it('only allows manual checks when enabled and idle', () => {
    expect(canCheckForUpdates(status('idle'))).toBe(true)
    expect(canCheckForUpdates(status('error'))).toBe(true)
    expect(canCheckForUpdates(status('idle', { canCheck: false }))).toBe(false)
    expect(canCheckForUpdates(status('downloading'))).toBe(false)
  })

  it('shows a top-bar notice only for notices that matter', () => {
    expect(isUpdateNoticeVisible(status('available'))).toBe(true)
    expect(isUpdateNoticeVisible(status('downloading'))).toBe(true)
    expect(isUpdateNoticeVisible(status('downloaded'))).toBe(true)
    expect(isUpdateNoticeVisible(status('idle'))).toBe(false)
    expect(isUpdateNoticeVisible(status('error'))).toBe(false)
    expect(isUpdateNoticeVisible(status('disabled'))).toBe(false)
  })

  it('formats progress, byte counts and speeds', () => {
    expect(clampPercent(undefined)).toBe(0)
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(42.6)).toBe(43)
    expect(clampPercent(120)).toBe(100)
    expect(updateProgressPercent(status('downloading', { progress: 12.4 }))).toBe(12)
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024 * 1.25)).toBe('1.3 MB')
    expect(formatBytes(undefined)).toBeNull()
    expect(formatSpeed(2048)).toBe('2 KB/s')
    expect(formatSpeed(undefined)).toBeNull()
    expect(
      formatProgressDetail(
        status('downloading', {
          progress: 42.4,
          bytesPerSecond: 2048,
          transferred: 1024 * 1024,
          total: 4 * 1024 * 1024,
        }),
      ),
    ).toBe('42% · 2 KB/s · 1 MB of 4 MB')
  })

  it('builds concise top-bar labels', () => {
    expect(updateIndicatorLabel(status('available', { availableVersion: '0.1.4' }))).toBe('Update 0.1.4')
    expect(updateIndicatorLabel(status('available'))).toBe('Update available')
    expect(updateIndicatorLabel(status('downloading', { progress: 37.6 }))).toBe('Update 38%')
    expect(updateIndicatorLabel(status('downloading'))).toBe('Downloading update')
    expect(updateIndicatorLabel(status('downloaded'))).toBe('Update ready')
    expect(updateIndicatorLabel(status('idle'))).toBe('')
  })

  it('summarizes each state for the Settings panel', () => {
    expect(summarizeUpdateStatus(status('disabled', { canCheck: false, message: 'Only packaged Windows.' }))).toMatchObject({
      title: 'Automatic updates are unavailable',
      detail: 'Only packaged Windows.',
      tone: 'neutral',
    })
    expect(summarizeUpdateStatus(status('idle', { message: 'You are up to date.' }))).toMatchObject({
      title: 'PhoneDeck 0.1.3',
      detail: 'You are up to date.',
      tone: 'neutral',
    })
    expect(summarizeUpdateStatus(status('checking'))).toMatchObject({ tone: 'info' })
    expect(summarizeUpdateStatus(status('available', { availableVersion: '0.1.4' }))).toMatchObject({
      title: 'Version 0.1.4 is available',
      tone: 'info',
    })
    expect(
      summarizeUpdateStatus(status('downloading', { availableVersion: '0.1.4', progress: 10, transferred: 0, total: 1000 })),
    ).toMatchObject({ title: 'Downloading version 0.1.4', detail: '10% · 0 B of 1000 B', tone: 'info' })
    expect(summarizeUpdateStatus(status('downloaded', { availableVersion: '0.1.4' }))).toMatchObject({
      title: 'Version 0.1.4 is ready',
      tone: 'success',
    })
    expect(summarizeUpdateStatus(status('error', { message: 'Nope' }))).toMatchObject({
      title: 'Update check failed',
      detail: 'Nope',
      tone: 'error',
    })
  })

  it('turns network and feed errors into useful messages', () => {
    expect(describeUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toContain('internet connection')
    expect(describeUpdateError(new Error('Request failed with status 403: rate limit exceeded'))).toContain(
      'limiting update checks',
    )
    expect(describeUpdateError(new Error('sha512 checksum mismatch'))).toContain('failed verification')
    expect(describeUpdateError(new Error('ENOENT: app-update.yml missing'))).toContain('no usable update feed')
    expect(describeUpdateError(new Error('404 Not Found'))).toContain('No update release')
    expect(describeUpdateError(new Error('EBUSY: resource busy'))).toContain('could not save the update')
    expect(describeUpdateError(new Error('Unexpected updater failure'))).toBe('Update failed: Unexpected updater failure')
    expect(describeUpdateError(undefined)).toBe('Could not check for updates. Try again later.')
  })
})
