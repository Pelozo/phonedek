import { describe, expect, it } from 'vitest'
import type { TwitchStatusView } from '../src/shared/api'
import {
  TWITCH_ACTION_OPTIONS,
  TWITCH_STATE_TARGETS,
  formatTwitchExpiry,
  twitchActionTitle,
  twitchActionVariant,
  twitchAvailability,
  twitchClientIdError,
  twitchClientIdOrEmpty,
  twitchOptionalText,
  twitchStateBadge,
  twitchStateBindingSummary,
  twitchStateTargetInfo,
  twitchStatusSummary,
  twitchTextError,
  twitchVerificationHost,
  twitchVerificationUrl,
} from '../src/renderer/src/lib/twitch'
import {
  TWITCH_STATUS_TILES,
  createTwitchStatusButton,
} from '../src/renderer/src/lib/twitchStatus'

function status(patch: Partial<TwitchStatusView> = {}): TwitchStatusView {
  return {
    state: 'authorized',
    enabled: true,
    connected: true,
    scopes: ['channel:read:stream_key', 'channel:manage:broadcast'],
    account: 'PhoneDeck',
    login: 'phonedek',
    userId: '12345',
    ...patch,
  }
}

describe('twitchStatusSummary', () => {
  it('describes a connected account without exposing tokens', () => {
    const summary = twitchStatusSummary(status())
    expect(summary).toMatchObject({ label: 'Connected', tone: 'ok' })
    expect(summary.detail).toContain('PhoneDeck')
    expect(summary.detail).toContain('2 scopes')
  })

  it('shows the device code while authorizing', () => {
    const summary = twitchStatusSummary(
      status({
        state: 'authorizing',
        connected: false,
        device: {
          userCode: 'ABCD-1234',
          verificationUri: 'https://www.twitch.tv/activate',
          expiresAt: Date.now() + 60_000,
          intervalMs: 5000,
        },
      }),
    )
    expect(summary.label).toBe('Waiting for authorization…')
    expect(summary.tone).toBe('warn')
    expect(summary.detail).toContain('ABCD-1234')
    expect(summary.detail).toContain('twitch.tv/activate')
  })

  it('labels disabled, unauthorized and error states', () => {
    expect(twitchStatusSummary(status({ state: 'disabled', enabled: false })).tone).toBe('muted')
    expect(twitchStatusSummary(status({ state: 'unauthorized', connected: false })).tone).toBe(
      'warn',
    )
    const error = twitchStatusSummary(status({ state: 'error', lastError: 'refresh failed' }))
    expect(error.tone).toBe('error')
    expect(error.detail).toBe('refresh failed')
  })
})

describe('twitch availability for action editors', () => {
  it('distinguishes off, signed out, pending and connected', () => {
    expect(twitchAvailability(status({ state: 'disabled', enabled: false })).label).toBe('TWITCH OFF')
    expect(twitchAvailability(status({ state: 'unauthorized', connected: false })).label).toBe(
      'NOT CONNECTED',
    )
    expect(twitchAvailability(status({ state: 'authorizing', connected: false })).label).toBe(
      'AUTH PENDING',
    )
    expect(twitchAvailability(status()).label).toBe('CONNECTED')
    expect(twitchAvailability(null).label).toBe('STATUS UNKNOWN')
  })

  it('surfaces the last error', () => {
    const error = twitchAvailability(status({ state: 'error', lastError: 'token expired' }))
    expect(error.tone).toBe('error')
    expect(error.detail).toBe('token expired')
  })
})

describe('Twitch client ID validation', () => {
  it('accepts empty input and alphanumeric IDs up to 64 characters', () => {
    expect(twitchClientIdError('')).toBeNull()
    expect(twitchClientIdError('   ')).toBeNull()
    expect(twitchClientIdError('abc123XYZ')).toBeNull()
    expect(twitchClientIdError('a'.repeat(64))).toBeNull()
  })

  it('rejects punctuation, whitespace and overlong IDs', () => {
    expect(twitchClientIdError('a'.repeat(65))).toContain('64')
    expect(twitchClientIdError('abc-def')).toContain('letters and digits')
    expect(twitchClientIdError('abc def')).toContain('letters and digits')
    expect(twitchClientIdOrEmpty('  abc123  ')).toBe('abc123')
  })
})

describe('Twitch text limits', () => {
  it('enforces the shared schema limits', () => {
    expect(twitchTextError('', 500, true)).toContain('Required')
    expect(twitchTextError('   ', 140, true)).toContain('Required')
    expect(twitchTextError('x'.repeat(500), 500, true)).toBeNull()
    expect(twitchTextError('x'.repeat(501), 500, true)).toContain('500')
    expect(twitchTextError('x'.repeat(141), 140, true)).toContain('140')
    expect(twitchTextError('x'.repeat(100), 100, true)).toBeNull()
    expect(twitchTextError('', 140, false)).toBeNull()
    expect(twitchTextError('x'.repeat(141), 140, false)).toContain('140')
    expect(twitchOptionalText('  hi  ')).toBe('hi')
    expect(twitchOptionalText('   ')).toBeUndefined()
  })
})

describe('Twitch URLs and expiry', () => {
  it('normalizes verification URLs for the external opener', () => {
    expect(twitchVerificationUrl('https://www.twitch.tv/activate')).toBe(
      'https://www.twitch.tv/activate',
    )
    expect(twitchVerificationUrl('www.twitch.tv/activate')).toBe(
      'https://www.twitch.tv/activate',
    )
    expect(twitchVerificationUrl('//twitch.tv/activate')).toBe('https://twitch.tv/activate')
    expect(twitchVerificationHost('https://www.twitch.tv/activate/')).toBe('www.twitch.tv/activate')
  })

  it('formats valid expiry times and ignores invalid values', () => {
    expect(formatTwitchExpiry(Date.parse('2026-11-13T12:30:00Z'))).toBeTruthy()
    expect(formatTwitchExpiry(null)).toBeNull()
    expect(formatTwitchExpiry(Number.NaN)).toBeNull()
  })
})

describe('Twitch actions', () => {
  it('titles every operation and exposes an ordered operation list', () => {
    expect(twitchActionTitle({ type: 'twitch', action: 'sendChat', message: '' })).toBe(
      'Twitch chat',
    )
    expect(twitchActionTitle({ type: 'twitch', action: 'createMarker' })).toBe('Twitch marker')
    expect(twitchActionTitle({ type: 'twitch', action: 'setTitle', title: '' })).toBe('Twitch title')
    expect(twitchActionTitle({ type: 'twitch', action: 'setGame', game: '' })).toBe(
      'Twitch category',
    )
    expect(TWITCH_ACTION_OPTIONS.map((option) => option.value)).toEqual([
      'sendChat',
      'createMarker',
      'setTitle',
      'setGame',
    ])
  })

  it('changes operation while preserving still-applicable text', () => {
    expect(
      twitchActionVariant(
        { type: 'twitch', action: 'sendChat', message: 'gg' },
        'setTitle',
      ),
    ).toEqual({ type: 'twitch', action: 'setTitle', title: '' })
    expect(
      twitchActionVariant(
        { type: 'twitch', action: 'createMarker', description: 'Boss' },
        'createMarker',
      ),
    ).toEqual({ type: 'twitch', action: 'createMarker', description: 'Boss' })
    expect(
      twitchActionVariant({ type: 'twitch', action: 'setGame', game: 'Minecraft' }, 'setGame'),
    ).toEqual({ type: 'twitch', action: 'setGame', game: 'Minecraft' })
    expect(
      twitchActionVariant({ type: 'twitch', action: 'sendChat', message: 'hi' }, 'sendChat'),
    ).toEqual({ type: 'twitch', action: 'sendChat', message: 'hi' })
  })
})

describe('Twitch status bindings', () => {
  it('renders static editor badges without pretending to be live', () => {
    expect(twitchStateBadge('live')).toBe('TWITCH · LIVE')
    expect(twitchStateBadge('viewers')).toBe('TWITCH · VIEWERS')
    expect(twitchStateBadge('uptime')).toBe('TWITCH · UPTIME')
    expect(twitchStateBadge('title')).toBe('TWITCH · TITLE')
    expect(twitchStateBadge('game')).toBe('TWITCH · GAME')
  })

  it('summarizes bindings and keeps the target order stable', () => {
    expect(twitchStateBindingSummary({ type: 'twitch', target: 'live' })).toBe('Live status')
    expect(twitchStateBindingSummary({ type: 'twitch', target: 'game' })).toBe('Category / game')
    expect(twitchStateBindingSummary(undefined)).toBeNull()
    expect(TWITCH_STATE_TARGETS.map((target) => target.value)).toEqual([
      'live',
      'viewers',
      'uptime',
      'title',
      'game',
    ])
    expect(twitchStateTargetInfo('title').hint).toContain('title')
  })

  it('creates 1x1 read-only status tiles with no tap action', () => {
    expect(TWITCH_STATUS_TILES.map((tile) => tile.target)).toEqual([
      'live',
      'viewers',
      'uptime',
      'title',
      'game',
    ])
    for (const preset of TWITCH_STATUS_TILES) {
      const button = createTwitchStatusButton(preset, 3)
      expect(button.slot).toBe(3)
      expect(button.label).toBe(preset.label)
      expect(button.state).toEqual({ type: 'twitch', target: preset.target })
      expect(button.actions).toEqual([])
      expect(button.span).toBeUndefined()
    }
  })
})
