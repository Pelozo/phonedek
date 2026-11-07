/**
 * Give the macOS build a stable code identity.
 *
 * With `mac.identity: null` electron-builder skips signing, so the main
 * executable keeps the prebuilt Electron signature (identifier "Electron").
 * macOS TCC then attributes the keyboard helper to that identity while the
 * privacy pane stores the grant under the bundle ID, so the toggle misses the
 * app.
 *
 * We always sign the two executables with explicit identifiers. If the local
 * self-signed "PhoneDeck Local Signing" certificate exists (see
 * scripts/make-signing-cert.sh), we use it: TCC then records a
 * certificate-based requirement that survives rebuilds. If that identity is
 * unusable we fall back to ad-hoc signing instead of failing the build.
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

function signWithFallback(target, identifier, identity) {
  try {
    sign(target, identifier, identity)
  } catch (error) {
    if (identity === '-') throw error
    console.warn(
      `[after-pack] Could not sign with "${identity}"; falling back to an ad-hoc signature.`,
    )
    console.warn(
      '  Fix the key access once with:\n' +
        '  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "<login-password>" ~/Library/Keychains/login.keychain-db',
    )
    sign(target, identifier, '-')
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appId = context.packager.config.appId || 'com.phonedek.desktop'
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  const executable = path.join(appPath, 'Contents', 'MacOS', appName)
  const helper = path.join(appPath, 'Contents', 'Resources', 'keyboard-helper')
  const identity = resolveIdentity()

  if (existsSync(executable)) signWithFallback(executable, appId, identity)
  if (existsSync(helper)) signWithFallback(helper, `${appId}.keyboard-helper`, identity)
}
