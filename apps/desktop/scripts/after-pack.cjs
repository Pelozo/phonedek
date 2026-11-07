/**
 * Give the macOS build a stable code identity.
 *
 * With `mac.identity: null` electron-builder skips signing, so the main
 * executable keeps the prebuilt Electron signature (identifier "Electron").
 * macOS TCC then attributes the Swift keyboard helper to that identity while
 * the privacy pane stores the grant under the bundle ID, so the toggle misses
 * the helper.
 *
 * We always ad-hoc sign the two executables with explicit identifiers. If a
 * local self-signed "PhoneDeck Local Signing" certificate exists (see
 * scripts/make-signing-cert.sh), we use it instead: TCC then records a
 * certificate-based requirement that survives rebuilds.
 */
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

function resolveIdentity() {
  if (process.env.PHONEDEK_SIGN_IDENTITY) return process.env.PHONEDEK_SIGN_IDENTITY
  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
    })
    const match = out.match(/"(PhoneDeck Local Signing[^"]*)"/)
    if (match) return match[1]
  } catch {
    // `security` is macOS-only; keep ad-hoc signing if it is unavailable.
  }
  return '-'
}

function sign(target, identifier, identity) {
  execFileSync('codesign', ['--force', '--sign', identity, '--identifier', identifier, target], {
    stdio: 'inherit',
  })
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appId = context.packager.config.appId || 'com.phonedek.desktop'
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  const executable = path.join(appPath, 'Contents', 'MacOS', appName)
  const helper = path.join(appPath, 'Contents', 'Resources', 'keyboard-helper')
  const identity = resolveIdentity()

  if (existsSync(executable)) sign(executable, appId, identity)
  if (existsSync(helper)) sign(helper, `${appId}.keyboard-helper`, identity)
}
