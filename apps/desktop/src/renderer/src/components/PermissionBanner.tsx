import type { PermissionStatus } from '../../../shared/api'
import { Icon } from './Icons'

/**
 * Slim, dismissible strip shown while macOS blocks synthetic input.
 *
 * "Open permission setup" is the reliable path for unsigned builds: it opens
 * the privacy pane and reveals the exact executable in Finder, ready to drag
 * into the list. "Try macOS prompt" uses the native alert, which is the
 * one-click path once releases are Developer ID signed.
 */
export function PermissionBanner({
  permission,
  busy,
  onGrant,
  onOpenSetup,
  onDismiss,
}: {
  permission: PermissionStatus
  busy: boolean
  onGrant: () => void
  onOpenSetup: () => void
  onDismiss: () => void
}) {
  if (!permission.supported || permission.granted) return null

  return (
    <div className="permission-banner" role="status">
      <span className="permission-banner-icon" aria-hidden="true">
        <Icon name="lock" size={15} />
      </span>
      <div className="permission-banner-copy">
        <strong>Allow input control</strong>
        <span>
          macOS blocks keystrokes, clicks and media keys until PhoneDeck is allowed in{' '}
          <b>{permission.paneName}</b>. Open the setup and add the highlighted app file, then press a button again.
        </span>
      </div>
      <div className="permission-banner-actions">
        <button type="button" className="button primary small" onClick={onOpenSetup}>
          <Icon name="folder" size={14} /> Open permission setup
        </button>
        <button type="button" className="button secondary small" onClick={onGrant} disabled={busy}>
          <Icon name="check" size={14} /> Try macOS prompt
        </button>
        <button
          type="button"
          className="icon-button permission-banner-dismiss"
          onClick={onDismiss}
          aria-label="Hide this for now"
          title="Hide this for now"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  )
}
