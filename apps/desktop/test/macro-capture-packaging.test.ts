import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktop = join(process.cwd(), 'apps', 'desktop')

function read(relative: string): string {
  return readFileSync(join(desktop, relative), 'utf8')
}

describe('uiohook packaging', () => {
  it('ships uiohook-napi as a pinned production dependency', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.['uiohook-napi']).toBe('1.5.5')
    expect(pkg.devDependencies?.['uiohook-napi']).toBeUndefined()
  })

  it('unpacks the native module from the asar in both builder configs', () => {
    for (const config of ['electron-builder.yml', 'electron-builder.signed.yml']) {
      const yml = read(config)
      expect(yml).toContain('asarUnpack:')
      expect(yml).toContain("'**/node_modules/uiohook-napi/**'")
      // uiohook's runtime loader must be unpacked beside the native module.
      expect(yml).toContain("'**/node_modules/node-gyp-build/**'")
    }
  })

  it('keeps the native module external in the main bundle', () => {
    expect(read('electron.vite.config.ts')).toContain("external: ['uiohook-napi']")
  })
})
