import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { audioDeviceHelperPath, keyboardHelperPath } from '../src/main/platform'

const root = join(__dirname, '..', '..', '..')
const desktop = join(root, 'apps', 'desktop')
const helperPath = join(desktop, 'resources', 'audio-device-helper.ps1')
const helper = readFileSync(helperPath, 'utf8')

describe('audio-device-helper.ps1', () => {
  it('is a Windows PowerShell 5.1 / C# 5 compatible Add-Type helper', () => {
    expect(helper).toContain('Add-Type -TypeDefinition')
    expect(helper).toContain("$ErrorActionPreference = 'Stop'")
    expect(helper).toContain('[Console]::OutputEncoding')
    // C# 7 inline out variables do not compile under Windows PowerShell 5.1.
    const code = helper
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
    expect(code).not.toMatch(/\bout\s+var\b/)
    expect(code).not.toMatch(/\$\"[^\"]*\{/)
  })

  it('declares the Core Audio enumeration COM interfaces in vtable order', () => {
    expect(helper).toContain('IMMDeviceEnumerator')
    expect(helper).toContain('IMMDeviceCollection')
    expect(helper).toContain('IMMDevice')
    expect(helper).toContain('IPropertyStore')
    expect(helper).toContain('EnumAudioEndpoints')
    expect(helper).toContain('GetDefaultAudioEndpoint')
    expect(helper).toContain('OpenPropertyStore')
    expect(helper).toContain('PropVariantClear')

    const device = helper.slice(
      helper.indexOf('internal interface IMMDevice'),
      helper.indexOf('internal interface IPropertyStore'),
    )
    expect(device.indexOf('Activate')).toBeGreaterThan(-1)
    expect(device.indexOf('OpenPropertyStore')).toBeGreaterThan(device.indexOf('Activate'))
    expect(device.indexOf('GetId')).toBeGreaterThan(device.indexOf('OpenPropertyStore'))
    expect(device.indexOf('GetState')).toBeGreaterThan(device.indexOf('GetId'))
  })

  it('declares every IPolicyConfig variant and role loop', () => {
    expect(helper).toContain('F8679F50-850A-41CF-9C72-430F290290C8')
    expect(helper).toContain('568B9108-44BF-40B4-9006-86AFE5B5A620')
    expect(helper).toContain('CA286FC3-91FD-42C3-8E9B-CAAFA66242E3')
    expect(helper).toContain('6BE54BE8-A068-4875-A49D-0C2966473B11')
    expect(helper).toContain('SetDefaultEndpoint')
    expect(helper).toContain('new int[] { 0, 1, 2 }')
    expect(helper).toContain('ApplyRoles')
    expect(helper).toContain('Windows rejected the default audio device change')
  })

  it('reads friendly names and form tags from the property store', () => {
    expect(helper).toContain('a45c254e-df1c-4efd-8020-67d146a850e0')
    expect(helper).toContain('PKEY_DeviceInterface_FriendlyName')
    expect(helper).toContain('b3f8fa53-0004-438e-9003-51a46e139bfc')
    expect(helper).toContain('VT_LPWSTR')
    for (const form of [
      'speakers',
      'headphones',
      'headset',
      'microphone',
      'usb',
      'bluetooth',
      'hdmi',
      'virtual',
      'other',
    ]) {
      expect(helper).toContain(`"${form}"`)
    }
  })

  it('hashes opaque endpoint ids and never prints the raw path', () => {
    expect(helper).toContain('SHA256')
    expect(helper).toContain('HashId')
    expect(helper).toContain('builder.Append(hash[index].ToString("x2"))')
    // RawId stays inside the C# object and is only used for FindRawId/set.
    expect(helper).toContain('public string RawId;')
    const projection = helper.slice(
      helper.indexOf('function Select-Endpoint'),
      helper.indexOf('function Get-ListSnapshot'),
    )
    expect(projection).toContain('id = [string]$Endpoint.Id')
    expect(projection).not.toContain('Raw')
  })

  it('implements list/default/set/selftest and a persistent JSONL mode', () => {
    expect(helper).toContain("'list'")
    expect(helper).toContain("'default'")
    expect(helper).toContain("'set'")
    expect(helper).toContain("'selftest'")
    expect(helper).toContain('--jsonl')
    expect(helper).toContain('{ ready = $true }')
    expect(helper).toContain('--all-roles')
    expect(helper).toContain('--kind')
    expect(helper).toContain('--id')
    expect(helper).toContain('ConvertTo-Json -Compress')
    expect(helper).toContain('ok = $false')
    expect(helper).toContain('exit 1')
  })

  it('keeps the selftest valid without audio hardware', () => {
    const selftest = helper.slice(
      helper.indexOf('function Invoke-SelfTest'),
      helper.indexOf('function Invoke-AudioCommand'),
    )
    expect(selftest).toContain('$enumerated = $false')
    expect(selftest).toContain('$warning')
    expect(selftest).toContain('selftest = $true')
    // The catch must not rethrow: the CI runner may have no endpoints.
    expect(selftest).not.toContain('throw')
  })
})

describe('audio device helper packaging', () => {
  it('is copied by both Windows electron-builder configs', () => {
    for (const name of ['electron-builder.yml', 'electron-builder.signed.yml']) {
      const config = readFileSync(join(desktop, name), 'utf8')
      expect(config).toContain('from: resources/audio-device-helper.ps1')
      expect(config).toContain('to: audio-device-helper.ps1')
    }
  })

  it('ships beside the keyboard helper, not inside the asar file list', () => {
    const files = readFileSync(join(desktop, 'electron-builder.yml'), 'utf8')
    expect(files).toContain('files:\n  - out/**\n  - package.json')
    expect(existsSync(join(desktop, 'resources', 'keyboard-helper.ps1'))).toBe(true)
    expect(existsSync(helperPath)).toBe(true)
  })

  it('runs the selftest in Windows CI without audio hardware', () => {
    const workflow = readFileSync(join(root, '.github', 'workflows', 'build.yml'), 'utf8')
    expect(workflow).toContain('audio-device-helper.ps1 selftest')
    expect(workflow).toContain('Audio device helper self-test')
    expect(workflow).toContain('resources/audio-device-helper.ps1')
  })
})

describe('audioDeviceHelperPath', () => {
  const options = {
    isPackaged: false,
    appPath: '/app',
    resourcesPath: '/resources',
  }

  it('uses the workspace resource in development', () => {
    expect(audioDeviceHelperPath('win32', options)).toBe(
      join('/app', 'resources', 'audio-device-helper.ps1'),
    )
  })

  it('uses the packaged resources directory', () => {
    expect(audioDeviceHelperPath('win32', { ...options, isPackaged: true })).toBe(
      join('/resources', 'audio-device-helper.ps1'),
    )
  })

  it('has no helper on macOS or Linux', () => {
    expect(audioDeviceHelperPath('darwin', options)).toBe('')
    expect(audioDeviceHelperPath('linux', options)).toBe('')
    expect(keyboardHelperPath('win32', options)).toBe(
      join('/app', 'resources', 'keyboard-helper.ps1'),
    )
  })
})
