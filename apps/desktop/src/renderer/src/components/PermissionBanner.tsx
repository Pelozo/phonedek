import type { PermissionStatus } from '../../../shared/api'
import { Icon } from './Icons'

/**
 * Slim, dismissible strip shown while macOS blocks synthetic input. The
 * native prompt is only one click away, so the user never has to hunt through
 * System Settings (which macOS 27 renamed to "Device Control and Data Access").
 */
export function PermissionBanner({
  permission,
  busy,
  onGrant,
  onOpenSettings,
  onDismiss,
}: {
  permission: PermissionStatus
  busy: boolean
  onGrant: () => void
  onOpenSettings: () => void
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
          <b>{permission.paneName}</b>.
        </span>
      </div>
      <div className="permission-banner-actions">
        <button type="button" className="button primary small" onClick={onGrant} disabled={busy}>
          <Icon name="check" size={14} /> Grant permission
        </button>
        <button type="button" className="button secondary small" onClick={onOpenSettings}>
          Open settings
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
