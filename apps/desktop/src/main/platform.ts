import { join } from 'node:path'

export interface HelperPathOptions {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
}

/**
 * Location of the persistent input helper for this platform.
 *
 * Packaged builds copy the helper into the Electron resources directory
 * (see electron-builder.yml). Development runs read it from the workspace.
 * Linux has no helper; createKeySender falls back to xdotool there.
 */
export function keyboardHelperPath(platform: NodeJS.Platform, options: HelperPathOptions): string {
  if (platform === 'darwin') {
    return options.isPackaged
      ? join(options.resourcesPath, 'keyboard-helper')
      : join(options.appPath, 'resources', 'mac', 'keyboard-helper')
  }
  if (platform === 'win32') {
    return options.isPackaged
      ? join(options.resourcesPath, 'keyboard-helper.ps1')
      : join(options.appPath, 'resources', 'keyboard-helper.ps1')
  }
  return ''
}
