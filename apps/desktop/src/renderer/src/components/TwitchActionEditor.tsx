import type { TwitchAction } from '@phonedek/shared'
import type { ServerInfoView } from '../../../shared/api'
import {
  TWITCH_ACTION_OPTIONS,
  twitchActionVariant,
  twitchAvailability,
  twitchOptionalText,
  twitchTextError,
} from '../lib/twitch'

const LIMITS = {
  sendChat: 500,
  createMarker: 140,
  setTitle: 140,
  setGame: 100,
} as const

function CharacterCount({ value, limit }: { value: string; limit: number }) {
  const ratio = value.length / limit
  return (
    <span
      className={`char-count${ratio >= 1 ? ' at-limit' : ratio >= 0.9 ? ' near-limit' : ''}`}
      aria-hidden="true"
    >
      {value.length}/{limit}
    </span>
  )
}

/**
 * Twitch Helix action fields. Chat/title/category text is configured here and
 * validated by the shared config schema; the phone never supplies it.
 */
export function TwitchActionEditor({
  action,
  server,
  onUpdate,
}: {
  action: TwitchAction
  server: ServerInfoView | null
  onUpdate: (action: TwitchAction) => void
}) {
  const availability = twitchAvailability(server?.twitchStatus)
  const chatError = action.action === 'sendChat' ? twitchTextError(action.message, 500, true) : null
  const markerError =
    action.action === 'createMarker'
      ? twitchTextError(action.description, 140, false)
      : null
  const titleError = action.action === 'setTitle' ? twitchTextError(action.title, 140, true) : null
  const gameError = action.action === 'setGame' ? twitchTextError(action.game, 100, true) : null

  return (
    <div className="stack">
      <div className={`twitch-status ${availability.tone}`}>
        <span
          className={`dot ${
            availability.tone === 'ok'
              ? 'online'
              : availability.tone === 'error'
                ? 'error'
                : 'offline'
          }`}
          aria-hidden="true"
        />
        <div>
          <strong>{availability.label}</strong>
          <small>{availability.detail}</small>
        </div>
      </div>

      <label className="field">
        <span>Twitch operation</span>
        <select
          value={action.action}
          onChange={(event) =>
            onUpdate(twitchActionVariant(action, event.target.value as TwitchAction['action']))
          }
        >
          {TWITCH_ACTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {action.action === 'sendChat' && (
        <>
          <label className="field">
            <span>
              Chat message <CharacterCount value={action.message} limit={LIMITS.sendChat} />
            </span>
            <textarea
              rows={3}
              value={action.message}
              maxLength={LIMITS.sendChat}
              spellCheck
              placeholder="Message to send as your Twitch account…"
              aria-invalid={chatError ? true : undefined}
              onChange={(event) => onUpdate({ ...action, message: event.target.value })}
            />
          </label>
          {chatError ? (
            <p className="hint error-text">{chatError}</p>
          ) : (
            <p className="hint">
              Posts as the connected Twitch account. Slow mode, followers-only chat, moderation,
              and Twitch rate limits can still reject the message.
            </p>
          )}
        </>
      )}

      {action.action === 'createMarker' && (
        <>
          <label className="field">
            <span>
              Marker description (optional){' '}
              <CharacterCount value={action.description ?? ''} limit={LIMITS.createMarker} />
            </span>
            <input
              value={action.description ?? ''}
              maxLength={LIMITS.createMarker}
              spellCheck
              placeholder="e.g. Boss attempt 3"
              aria-invalid={markerError ? true : undefined}
              onChange={(event) =>
                onUpdate({
                  ...action,
                  ...(twitchOptionalText(event.target.value)
                    ? { description: event.target.value }
                    : { description: undefined }),
                })
              }
            />
          </label>
          {markerError && <p className="hint error-text">{markerError}</p>}
          <p className="hint">
            Adds a marker to the live broadcast and its VOD timeline. The channel must be live and
            have video markers enabled on Twitch.
          </p>
        </>
      )}

      {action.action === 'setTitle' && (
        <>
          <label className="field">
            <span>
              Stream title <CharacterCount value={action.title} limit={LIMITS.setTitle} />
            </span>
            <input
              value={action.title}
              maxLength={LIMITS.setTitle}
              spellCheck
              placeholder="What are you streaming?"
              aria-invalid={titleError ? true : undefined}
              onChange={(event) => onUpdate({ ...action, title: event.target.value })}
            />
          </label>
          {titleError ? (
            <p className="hint error-text">{titleError}</p>
          ) : (
            <p className="hint">
              Replaces the live channel title for the connected account. The 140-character Twitch
              limit is enforced before saving.
            </p>
          )}
        </>
      )}

      {action.action === 'setGame' && (
        <>
          <label className="field">
            <span>
              Category / game <CharacterCount value={action.game} limit={LIMITS.setGame} />
            </span>
            <input
              value={action.game}
              maxLength={LIMITS.setGame}
              spellCheck={false}
              placeholder="e.g. Just Chatting, Minecraft"
              aria-invalid={gameError ? true : undefined}
              onChange={(event) => onUpdate({ ...action, game: event.target.value })}
            />
          </label>
          {gameError ? (
            <p className="hint error-text">{gameError}</p>
          ) : (
            <p className="hint">
              Type the exact Twitch category name. This build cannot search Twitch&apos;s category
              directory yet; Twitch resolves the name when the button is pressed, so typos fail
              with a clear error. The 100-character limit matches Twitch.
            </p>
          )}
        </>
      )}
    </div>
  )
}
