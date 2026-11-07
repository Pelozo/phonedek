import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { keyboardHelperPath } from '../src/main/platform'

const packaged = {
  isPackaged: true,
  appPath: '/repo/apps/desktop',
  resourcesPath: '/repo/apps/desktop/release/mac-arm64/PhoneDeck.app/Contents/Resources',
}

const development = {
  isPackaged: false,
  appPath: '/repo/apps/desktop',
  resourcesPath: '/ignored',
}

describe('keyboardHelperPath', () => {
  it('uses the packaged PowerShell script on Windows', () => {
    expect(keyboardHelperPath('win32', packaged)).toBe(join(packaged.resourcesPath, 'keyboard-helper.ps1'))
    expect(keyboardHelperPath('win32', development)).toBe(
      join(development.appPath, 'resources', 'keyboard-helper.ps1'),
    )
  })

  it('uses the compiled Swift helper on macOS', () => {
    expect(keyboardHelperPath('darwin', packaged)).toBe(join(packaged.resourcesPath, 'keyboard-helper'))
    expect(keyboardHelperPath('darwin', development)).toBe(
      join(development.appPath, 'resources', 'mac', 'keyboard-helper'),
    )
  })

  it('has no helper path on unsupported platforms', () => {
    expect(keyboardHelperPath('linux', packaged)).toBe('')
    expect(keyboardHelperPath('freebsd', packaged)).toBe('')
  })
})
