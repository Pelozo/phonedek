import type { PermissionStatus } from '../../../shared/api'
import { Icon } from './Icons'

/**
 * Slim, dismissible strip shown while macOS blocks synthetic input. The
 * native prompt is one click away, and the app executable path is exposed for
 * macOS 27, where the privacy pane sometimes needs the file added explicitly
 * instead of the bundle-id entry created by the prompt.
 */
export function PermissionBanner({
  permission,
  busy,
  onGrant,
  onOpenSettings,
  onRevealApp,
  onDismiss,
}: {
  permission: PermissionStatus
  busy: boolean
  onGrant: () => void
  onOpenSettings: () => void
  onRevealApp: () => void
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
          <b>{permission.paneName}</b>. If the switch is already on, add the app file instead.
        </span>
      </div>
      <div className="permission-banner-actions">
        <button type="button" className="button primary small" onClick={onGrant} disabled={busy}>
          <Icon name="check" size={14} /> Grant permission
        </button>
        <button type="button" className="button secondary small" onClick={onOpenSettings}>
          Open settings
        </button>
        <button type="button" className="button secondary small" onClick={onRevealApp}>
          <Icon name="folder" size={14} /> Show app file
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
