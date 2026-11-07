import type { PermissionStatus } from '../../../shared/api'
import { Icon } from './Icons'

/**
 * Slim, dismissible strip shown while macOS blocks synthetic input. The
 * native prompt is only one click away, so the user never has to hunt through
 * System Settings (which macOS 27 renamed to "Device Control and Data Access").
 *
 * macOS 27 can also authorize the app while still denying the helper binary.
 * That second state is reported separately so the next step is explicit.
 */
export function PermissionBanner({
  permission,
  busy,
  onGrant,
  onOpenSettings,
  onRevealHelper,
  onDismiss,
}: {
  permission: PermissionStatus
  busy: boolean
  onGrant: () => void
  onOpenSettings: () => void
  onRevealHelper: () => void
  onDismiss: () => void
}) {
  const appBlocked = !permission.granted
  const helperBlocked = permission.granted && permission.helperGranted === false
  if (!permission.supported || (!appBlocked && !helperBlocked)) return null

  return (
    <div className={`permission-banner${helperBlocked ? ' helper' : ''}`} role="status">
      <span className="permission-banner-icon" aria-hidden="true">
        <Icon name="lock" size={15} />
      </span>
      <div className="permission-banner-copy">
        <strong>{appBlocked ? 'Allow input control' : 'One more step: allow the input helper'}</strong>
        <span>
          {appBlocked ? (
            <>
              macOS blocks keystrokes, clicks and media keys until PhoneDeck is allowed in{' '}
              <b>{permission.paneName}</b>.
            </>
          ) : (
            <>
              macOS tracks PhoneDeck&apos;s helper separately. Add the highlighted file to <b>{permission.paneName}</b>,
              then press a button again.
            </>
          )}
        </span>
      </div>
      <div className="permission-banner-actions">
        {appBlocked ? (
          <>
            <button type="button" className="button primary small" onClick={onGrant} disabled={busy}>
              <Icon name="check" size={14} /> Grant permission
            </button>
            <button type="button" className="button secondary small" onClick={onOpenSettings}>
              Open settings
            </button>
          </>
        ) : (
          <>
            <button type="button" className="button primary small" onClick={onRevealHelper}>
              <Icon name="folder" size={14} /> Show helper
            </button>
            <button type="button" className="button secondary small" onClick={onOpenSettings}>
              Open settings
            </button>
          </>
        )}
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
