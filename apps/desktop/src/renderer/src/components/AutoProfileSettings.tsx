import { useEffect, useState } from 'react'
import type { ServerInfoView, SettingsView } from '../../../shared/api'
import {
  MAX_AUTO_PROFILE_RULES,
  autoProfileDraftsDirty,
  autoProfileProfileName,
  autoProfileRevertHint,
  autoProfileRevertProfileError,
  autoProfileRuleErrors,
  autoProfileRulesFromDrafts,
  nextAutoProfileRuleId,
  normalizeAutoProfileProcess,
  toAutoProfileDrafts,
  type AutoProfileDraft,
} from '../lib/autoProfile'
import { Icon } from './Icons'
import { Toggle } from './Primitives'

/**
 * Settings → Games. Rules are a local draft until Save rules; the master
 * switch saves immediately. There is no live watcher indicator: the game
 * watcher runs in the main process and only the phone reacts to a switch.
 */
export function AutoProfileSettings({
  settings,
  profiles,
  onServerUpdate,
  onToast,
}: {
  settings: SettingsView
  profiles: ReadonlyArray<{ id: string; name: string }>
  onServerUpdate: (server: ServerInfoView) => void
  onToast: (message: string, kind?: 'info' | 'success' | 'error') => void
}) {
  const [drafts, setDrafts] = useState<AutoProfileDraft[]>(() =>
    toAutoProfileDrafts(settings.autoProfileRules),
  )
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)

  const savedKey = JSON.stringify(settings.autoProfileRules)
  useEffect(() => {
    setDrafts(toAutoProfileDrafts(settings.autoProfileRules))
    setAttempted(false)
    setFocusId(null)
  }, [savedKey])

  const dirty = autoProfileDraftsDirty(drafts, settings.autoProfileRules)
  const errors = drafts.map((draft) => autoProfileRuleErrors(draft, profiles))
  const hasErrors = errors.some((error) => error.process || error.profile)
  const noProfiles = profiles.length === 0
  const revertProfileId = settings.autoProfileRevertProfileId
  const revertError = revertProfileId
    ? autoProfileRevertProfileError(revertProfileId, profiles)
    : null

  const updateRevert = async (patch: {
    revertEnabled?: boolean
    revertProfileId?: string | null
  }): Promise<void> => {
    if (patch.revertProfileId) {
      const error = autoProfileRevertProfileError(patch.revertProfileId, profiles)
      if (error) {
        onToast(error, 'error')
        return
      }
    }
    setBusy(true)
    try {
      const result = await window.phonedek.setAutoProfileSettings(patch)
      if (result.state) onServerUpdate(result.state.server)
      if (!result.ok) {
        onToast(result.error ?? 'Could not update the return profile', 'error')
        return
      }
      if (patch.revertEnabled !== undefined) {
        onToast(
          patch.revertEnabled
            ? 'Return profile after game close enabled'
            : 'Return profile after game close disabled',
          'success',
        )
      } else if (patch.revertProfileId) {
        onToast(
          `Phones return to ${autoProfileProfileName(patch.revertProfileId, profiles)} when the game closes`,
          'success',
        )
      } else {
        onToast('Return profile cleared', 'success')
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleEnabled = async (enabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.phonedek.setAutoProfileSettings({ enabled })
      if (result.state) onServerUpdate(result.state.server)
      if (!result.ok) {
        onToast(result.error ?? 'Could not update game launch rules', 'error')
        return
      }
      onToast(
        enabled ? 'Game launch switching enabled' : 'Game launch switching disabled',
        'success',
      )
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const addRule = (): void => {
    if (noProfiles) return
    if (drafts.length >= MAX_AUTO_PROFILE_RULES) {
      onToast(`At most ${MAX_AUTO_PROFILE_RULES} game launch rules can be configured`, 'error')
      return
    }
    const id = nextAutoProfileRuleId(drafts)
    setDrafts((current) => [
      ...current,
      { id, process: '', profileId: profiles[0]?.id ?? '' },
    ])
    setFocusId(id)
  }

  const updateDraft = (id: string, patch: Partial<Omit<AutoProfileDraft, 'id'>>): void => {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    )
  }

  const removeRule = (id: string): void => {
    setDrafts((current) => current.filter((draft) => draft.id !== id))
  }

  const saveRules = async (): Promise<void> => {
    setAttempted(true)
    if (hasErrors) {
      onToast('Fix the highlighted game launch rules before saving', 'error')
      return
    }
    setBusy(true)
    try {
      const result = await window.phonedek.setAutoProfileSettings({
        rules: autoProfileRulesFromDrafts(drafts),
      })
      if (result.state) onServerUpdate(result.state.server)
      if (!result.ok) {
        onToast(result.error ?? 'Could not save game launch rules', 'error')
        return
      }
      setAttempted(false)
      onToast(
        drafts.length === 0
          ? 'Game launch rules cleared'
          : `Saved ${drafts.length} game launch rule${drafts.length === 1 ? '' : 's'}`,
        'success',
      )
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-section auto-profile-settings">
      <h3>Games</h3>
      <Toggle
        label="Switch profiles when a game launches"
        description="When a mapped executable starts, connected phones switch to its profile once. The editor keeps editing the profile you selected; it does not follow the phone."
        checked={settings.autoProfileEnabled}
        onChange={(enabled) => void toggleEnabled(enabled)}
        disabled={busy}
      />

      <div className="auto-profile-revert">
        <Toggle
          label="Return to profile when the game closes"
          description="After the matched game exits and no other mapped game is running, phones return to this profile. A quick restart or launcher handoff cancels the return."
          checked={settings.autoProfileRevertEnabled}
          onChange={(enabled) => void updateRevert({ revertEnabled: enabled })}
          disabled={busy || noProfiles}
        />
        <label className="field auto-profile-revert-target">
          <span>Return profile</span>
          <select
            value={revertProfileId}
            aria-invalid={revertError ? true : undefined}
            disabled={busy || noProfiles}
            onChange={(event) => {
              const profileId = event.target.value
              void updateRevert({ revertProfileId: profileId || null })
            }}
          >
            <option value="">No return profile</option>
            {revertProfileId !== '' &&
              !profiles.some((profile) => profile.id === revertProfileId) && (
                <option value={revertProfileId}>Missing profile</option>
              )}
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name || profile.id}
              </option>
            ))}
          </select>
        </label>
        <p className={`hint${revertError ? ' error-text' : ''}`}>
          {revertError ??
            autoProfileRevertHint(
              settings.autoProfileRevertEnabled,
              revertProfileId,
              profiles,
            )}
        </p>
        {!settings.autoProfileEnabled && settings.autoProfileRevertEnabled && (
          <p className="hint">
            Turn on Switch profiles when a game launches above; the return only follows an
            automatic switch.
          </p>
        )}
      </div>

      <div className="auto-profile-toolbar">
        <span className="mono auto-profile-count">
          {drafts.length}/{MAX_AUTO_PROFILE_RULES} RULES
        </span>
        {dirty && <span className="tag auto-profile-dirty">Unsaved changes</span>}
        <span className="hint">Rules are checked from top to bottom.</span>
      </div>

      {noProfiles ? (
        <div className="auto-profile-empty">
          <Icon name="layers" size={24} />
          <strong>No profiles in this deck</strong>
          <p>
            Rules point at profiles in this deck. Add a profile in the sidebar first, then come
            back here to map a game executable to it.
          </p>
        </div>
      ) : drafts.length === 0 ? (
        <div className="auto-profile-empty">
          <Icon name="play" size={24} />
          <strong>No game launch rules yet</strong>
          <p>
            Add a rule, enter the game&apos;s executable and pick the profile to show on connected
            phones. Nothing switches until the process actually starts.
          </p>
          <p className="hint">
            The editor canvas stays where it is; only the phone follows the rule.
          </p>
        </div>
      ) : (
        <div className="auto-profile-list">
          {drafts.map((draft, index) => {
            const error = errors[index]!
            const normalized = normalizeAutoProfileProcess(draft.process)
            const showProcessError =
              attempted || (draft.process.trim() !== '' && error.process !== null)
            const showProfileError =
              attempted || (draft.profileId !== '' && error.profile !== null)
            return (
              <div className="auto-profile-rule" key={draft.id}>
                <div className="auto-profile-rule-head">
                  <span className="mono auto-profile-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <strong>{normalized || 'New rule'}</strong>
                  <span className="tag">AUTO</span>
                  <button
                    type="button"
                    className="icon-button tiny danger"
                    aria-label={`Remove rule ${index + 1}`}
                    title="Remove this rule"
                    onClick={() => removeRule(draft.id)}
                    disabled={busy}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>

                <div className="auto-profile-fields">
                  <label className="field">
                    <span>Process or executable</span>
                    <input
                      value={draft.process}
                      maxLength={4096}
                      spellCheck={false}
                      autoComplete="off"
                      autoFocus={draft.id === focusId}
                      placeholder="game.exe or chrome"
                      aria-invalid={showProcessError ? true : undefined}
                      disabled={busy}
                      onChange={(event) => updateDraft(draft.id, { process: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                      }}
                    />
                  </label>

                  <span className="auto-profile-arrow" aria-hidden="true">
                    <Icon name="chevron-right" size={15} />
                  </span>

                  <label className="field">
                    <span>Phone profile</span>
                    <select
                      value={draft.profileId}
                      aria-invalid={showProfileError ? true : undefined}
                      disabled={busy || noProfiles}
                      onChange={(event) => updateDraft(draft.id, { profileId: event.target.value })}
                    >
                      <option value="" disabled>
                        Choose a profile
                      </option>
                      {draft.profileId !== '' &&
                        !profiles.some((profile) => profile.id === draft.profileId) && (
                          <option value={draft.profileId}>Missing profile</option>
                        )}
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name || profile.id}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="auto-profile-match-line">
                  <span className="mono">
                    MATCH · {normalized ?? '—'}
                  </span>
                  <span className="hint">
                    Switches to{' '}
                    {autoProfileProfileName(draft.profileId, profiles)} once on launch.
                  </span>
                </div>

                {showProcessError && error.process && (
                  <p className="hint error-text">{error.process}</p>
                )}
                {showProfileError && error.profile && (
                  <p className="hint error-text">{error.profile}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="row gap auto-profile-actions">
        <button
          type="button"
          className="button secondary small"
          onClick={addRule}
          disabled={busy || noProfiles || drafts.length >= MAX_AUTO_PROFILE_RULES}
          title={
            noProfiles
              ? 'Add a deck profile first'
              : drafts.length >= MAX_AUTO_PROFILE_RULES
                ? `At most ${MAX_AUTO_PROFILE_RULES} rules`
                : 'Add another game launch rule'
          }
        >
          <Icon name="plus" size={14} /> Add rule
        </button>
        <button
          type="button"
          className="button primary small"
          onClick={() => void saveRules()}
          disabled={busy || !dirty}
        >
          <Icon name="save" size={14} /> Save rules
        </button>
        {hasErrors && !attempted && (
          <span className="hint">A rule needs both a process and a profile.</span>
        )}
      </div>

      <ul className="auto-profile-notes">
        <li>
          Matches the executable basename, case-insensitively. <code>.exe</code> is optional, so{' '}
          <code>C:\Games\Game.exe</code>, <code>Game.exe</code> and <code>game</code> all match the
          same process.
        </li>
        <li>
          The phone switches once when the process starts. Relaunching the game triggers the switch
          again.
        </li>
        <li>If several rules match, the first rule in this list wins.</li>
        <li>The editor canvas does not switch; only connected phones do.</li>
        <li>
          Local only: rules are stored in this PC&apos;s settings and never change your profiles or
          deck config.
        </li>
      </ul>
    </div>
  )
}
