/** Host operating systems that change shortcut labels and preset availability. */
export type HostPlatform = 'win32' | 'darwin' | 'linux'

/**
 * Normalize a platform string (usually `process.platform` / `ServerInfoView.platform`).
 * Unknown or missing values fall back to `linux`, which keeps the Windows-style
 * key labels and shows cross-platform presets.
 */
export function normalizeHostPlatform(platform?: string | null): HostPlatform {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux' ? platform : 'linux'
}
