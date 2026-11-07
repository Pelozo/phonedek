import { describe, expect, it } from 'vitest'
import {
  createDeveloperIdProbe,
  detectDeveloperIdSignature,
  hasDeveloperIdAuthority,
  isDeveloperIdSignature,
  resolveUpdatePolicy,
} from '../src/main/update-policy'
import { disabledUpdateMessage } from '../src/shared/update-status'

const EXEC_PATH = '/Applications/PhoneDeck.app/Contents/MacOS/PhoneDeck'
const SIGNED_STDERR = [
  `Executable=${EXEC_PATH}`,
  'Identifier=com.phonedek.desktop',
  'Authority=Developer ID Application: Example Corp (TEAMID123)',
  'Authority=Developer ID Certification Authority',
  'Authority=Apple Root CA',
  'TeamIdentifier=TEAMID123',
].join('\n')

describe('update policy matrix', () => {
  it('enables packaged Windows regardless of any signature state', () => {
    expect(
      resolveUpdatePolicy({ isPackaged: true, platform: 'win32', developerIdSigned: true }),
    ).toEqual({ enabled: true, reason: null, developerIdSigned: false })
  })

  it('disables every development build', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as NodeJS.Platform[]) {
      expect(resolveUpdatePolicy({ isPackaged: false, platform, developerIdSigned: true })).toMatchObject({
        enabled: false,
        reason: 'development',
      })
    }
    expect(
      resolveUpdatePolicy({ isPackaged: false, platform: 'darwin', developerIdSigned: true }),
    ).toMatchObject({ enabled: false, reason: 'development', developerIdSigned: true })
  })

  it('enables packaged macOS only with a Developer ID signature', () => {
    expect(
      resolveUpdatePolicy({ isPackaged: true, platform: 'darwin', developerIdSigned: true }),
    ).toEqual({ enabled: true, reason: null, developerIdSigned: true })

    expect(
      resolveUpdatePolicy({ isPackaged: true, platform: 'darwin', developerIdSigned: false }),
    ).toEqual({ enabled: false, reason: 'unsigned-macos', developerIdSigned: false })

    // Omitted signature data means unsigned, never a crash.
    expect(resolveUpdatePolicy({ isPackaged: true, platform: 'darwin' })).toEqual({
      enabled: false,
      reason: 'unsigned-macos',
      developerIdSigned: false,
    })
  })

  it('keeps packaged Linux disabled', () => {
    expect(resolveUpdatePolicy({ isPackaged: true, platform: 'linux' })).toEqual({
      enabled: false,
      reason: 'unsupported-platform',
      developerIdSigned: false,
    })
  })
})

describe('Developer ID signature detection', () => {
  it('finds the authority line in stdout or stderr', () => {
    expect(hasDeveloperIdAuthority('  Authority=Developer ID Application: Example (TEAM)')).toBe(true)
    expect(isDeveloperIdSignature({ status: 0, stderr: SIGNED_STDERR })).toBe(true)
    expect(isDeveloperIdSignature({ status: 0, stdout: SIGNED_STDERR, stderr: '' })).toBe(true)
  })

  it('rejects other authorities, unsigned output and failed probes', () => {
    expect(isDeveloperIdSignature({ status: 0, stderr: 'Authority=Developer ID Installer: Example' })).toBe(false)
    expect(isDeveloperIdSignature({ status: 0, stderr: 'Authority=Apple Development: Example' })).toBe(false)
    expect(isDeveloperIdSignature({ status: 0, stderr: 'code object is not signed at all' })).toBe(false)
    expect(isDeveloperIdSignature({ status: 0 })).toBe(false)
    // A non-zero status wins even if an authority-looking line appears.
    expect(isDeveloperIdSignature({ status: 1, stderr: SIGNED_STDERR })).toBe(false)
    expect(isDeveloperIdSignature({ status: null, error: 'spawn /usr/bin/codesign ENOENT' })).toBe(false)
  })

  it('runs codesign with the documented arguments', () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const signed = detectDeveloperIdSignature(EXEC_PATH, (command, args) => {
      calls.push({ command, args })
      return { status: 0, stderr: SIGNED_STDERR }
    })
    expect(signed).toBe(true)
    expect(calls).toEqual([
      { command: '/usr/bin/codesign', args: ['-dv', '--verbose=2', EXEC_PATH] },
    ])
  })

  it('treats a throwing runner as unsigned', () => {
    expect(
      detectDeveloperIdSignature(EXEC_PATH, () => {
        throw new Error('codesign exploded')
      }),
    ).toBe(false)
  })

  it('caches each executable probe result', () => {
    let calls = 0
    const probe = createDeveloperIdProbe(() => {
      calls += 1
      return { status: 1, stderr: 'code object is not signed at all' }
    })
    expect(probe('/app/one')).toBe(false)
    expect(probe('/app/one')).toBe(false)
    expect(calls).toBe(1)
    expect(probe('/app/two')).toBe(false)
    expect(calls).toBe(2)
  })
})

describe('disabled update messages', () => {
  it('explains manual DMG/ZIP updates for unsigned macOS builds', () => {
    const message = disabledUpdateMessage('darwin', 'unsigned-macos')
    expect(message).toMatch(/unsigned macOS build/)
    expect(message).toMatch(/DMG/)
    expect(message).toMatch(/manually/)
  })

  it('uses the normal development message for a signed-but-unpackaged macOS app', () => {
    const message = disabledUpdateMessage('darwin', 'development')
    expect(message).toMatch(/packaged builds/)
    expect(message).toMatch(/manually/)
    expect(message).not.toMatch(/unsigned/)
  })

  it('keeps the Windows and Linux text', () => {
    expect(disabledUpdateMessage('win32')).toMatch(/installed Windows app/)
    expect(disabledUpdateMessage('linux')).toMatch(/Linux/)
    expect(disabledUpdateMessage('freebsd')).toMatch(/unavailable on this platform/)
  })
})
