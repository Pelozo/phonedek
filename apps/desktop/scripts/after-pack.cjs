/**
 * Give the unsigned macOS build a stable code identity.
 *
 * With `mac.identity: null` electron-builder skips signing, so the main
 * executable keeps the prebuilt Electron signature (identifier "Electron").
 * macOS TCC then attributes the Swift keyboard helper to that "Electron"
 * identity, while the privacy pane stores the grant under the bundle ID
 * (com.phonedek.desktop). Result: the toggle looks enabled but the helper is
 * still denied.
 *
 * Ad-hoc signing the two executables with the app identifier makes TCC see one
 * consistent identity, so the native permission prompt is enough and users do
 * not have to add the inner binary by hand.
 *
 * This is not Developer ID signing/notarization; Gatekeeper still treats the
 * app as unsigned. It only fixes TCC attribution.
 */
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

function adHocSign(target, identifier) {
  execFileSync('codesign', ['--force', '--sign', '-', '--identifier', identifier, target], {
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

  if (existsSync(executable)) adHocSign(executable, appId)
  if (existsSync(helper)) adHocSign(helper, `${appId}.keyboard-helper`)
}
