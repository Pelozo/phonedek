import { describe, expect, it } from 'vitest'
import { ActionSchema } from '@phonedek/shared'
import type { StreamerBotAction } from '@phonedek/shared'
import type {
  StreamerBotActionView,
  StreamerBotStatus,
} from '../src/shared/api'
import {
  appendStreamerbotArg,
  filterStreamerbotActions,
  findStreamerbotAction,
  groupStreamerbotActions,
  isLoopbackStreamerbotHost,
  removeStreamerbotArg,
  streamerbotActionSummary,
  streamerbotActiveArgCount,
  streamerbotArgError,
  streamerbotArgRowError,
  streamerbotArgRows,
  streamerbotArgsFromRows,
  streamerbotAvailability,
  streamerbotEndpoint,
  streamerbotHostError,
  streamerbotNameError,
  streamerbotPickerAvailability,
  streamerbotPortError,
  streamerbotStatusSummary,
  updateStreamerbotArg,
  type StreamerBotArgRow,
  STREAMERBOT_ACTION_PLACEHOLDER,
} from '../src/renderer/src/lib/streamerbot'

function status(patch: Partial<StreamerBotStatus> = {}): StreamerBotStatus {
  return { state: 'connected', host: '127.0.0.1', port: 8080, ...patch }
}

function action(patch: Partial<StreamerBotActionView> = {}): StreamerBotActionView {
  return {
    id: 'a1',
    name: 'Alert',
    enabled: true,
    subactionCount: 3,
    triggerCount: 1,
    ...patch,
  }
}

function row(id: string, key: string, value = ''): StreamerBotArgRow {
  return { id, key, value }
}

describe('streamerbotStatusSummary', () => {
  it('describes a connected instance with version and action count', () => {
    const summary = streamerbotStatusSummary(
      status({ instanceName: 'Studio Bot', version: '1.0.4', actionCount: 42 }),
    )
    expect(summary).toMatchObject({ label: 'Connected', tone: 'ok' })
    expect(summary.detail).toContain('Studio Bot')
    expect(summary.detail).toContain('Streamer.bot 1.0.4')
    expect(summary.detail).toContain('42 actions')
  })

  it('falls back to the endpoint when the Hello details are missing', () => {
    expect(streamerbotStatusSummary(status()).detail).toContain('127.0.0.1:8080')
    expect(streamerbotEndpoint({ host: '::1', port: 8080 })).toBe('[::1]:8080')
    expect(streamerbotEndpoint(null)).toContain('WebSocket')
  })

  it('labels disabled, connecting, offline and error states', () => {
    expect(streamerbotStatusSummary(status({ state: 'disabled' }))).toMatchObject({
      label: 'Disabled',
      tone: 'muted',
    })
    expect(streamerbotStatusSummary(status({ state: 'connecting' })).tone).toBe('warn')
    const offline = streamerbotStatusSummary(status({ state: 'disconnected', lastError: 'ECONNREFUSED' }))
    expect(offline.label).toBe('Offline')
    expect(offline.detail).toBe('ECONNREFUSED')
    const error = streamerbotStatusSummary(status({ state: 'error', lastError: 'boom' }))
    expect(error.tone).toBe('error')
    expect(error.detail).toContain('boom')
    expect(streamerbotStatusSummary(null).tone).toBe('muted')
  })

  it('makes an auth failure actionable and includes the retry countdown', () => {
    const auth = streamerbotStatusSummary(status({ state: 'auth-failed' }))
    expect(auth.tone).toBe('error')
    expect(auth.detail).toContain('password')
    expect(auth.detail).toContain('Servers/Clients')
    const retry = streamerbotStatusSummary(
      status({ state: 'reconnecting', nextRetryMs: 4000, lastError: 'timeout' }),
    )
    expect(retry.label).toBe('Reconnecting…')
    expect(retry.detail).toContain('4s')
    expect(retry.detail).toContain('timeout')
  })
})

describe('streamerbotAvailability', () => {
  it('uses short labels for the action picker', () => {
    expect(streamerbotAvailability(status()).label).toBe('CONNECTED')
    expect(streamerbotAvailability(status({ state: 'disabled', host: '', port: 0 })).label).toBe(
      'STREAMER.BOT OFF',
    )
    expect(streamerbotAvailability(status({ state: 'auth-failed' })).label).toBe('AUTH FAILED')
    expect(streamerbotAvailability(status({ state: 'disconnected' })).label).toBe('OFFLINE')
    expect(streamerbotAvailability(null).label).toBe('STATUS UNKNOWN')
  })

  it('explains list and selection problems only while connected', () => {
    const connected = status()
    expect(
      streamerbotPickerAvailability({
        status: connected,
        actions: [],
        loaded: false,
      }).label,
    ).toBe('CHECKING')
    expect(
      streamerbotPickerAvailability({
        status: connected,
        actions: [],
        loaded: true,
        error: 'GetActions timed out',
      }),
    ).toMatchObject({ label: 'LIST UNAVAILABLE', tone: 'error' })
    expect(
      streamerbotPickerAvailability({ status: connected, actions: [], loaded: true }).label,
    ).toBe('NO ACTIONS')
    expect(
      streamerbotPickerAvailability({
        status: connected,
        actions: [action()],
        loaded: true,
      }).label,
    ).toBe('PICK ACTION')
    expect(
      streamerbotPickerAvailability({
        status: connected,
        actions: [action()],
        loaded: true,
        selected: 'Missing',
      }).label,
    ).toBe('NOT IN LIST')
    expect(
      streamerbotPickerAvailability({
        status: connected,
        actions: [action({ group: 'Alerts' })],
        loaded: true,
        selected: 'Alert',
      }),
    ).toEqual({
      label: 'READY',
      detail: 'Alerts · 3 subactions · 1 trigger',
      tone: 'ok',
    })
    expect(
      streamerbotPickerAvailability({
        status: connected,
        actions: [action({ enabled: false })],
        loaded: true,
        selected: 'Alert',
      }).tone,
    ).toBe('warn')
  })
})

describe('Streamer.bot action list helpers', () => {
  const actions = [
    action({ id: 'a', name: 'Alert', group: 'Alerts' }),
    action({ id: 'b', name: 'Raid Shoutout' }),
    action({ id: 'c', name: 'Scene Intro', group: 'Scenes' }),
  ]

  it('filters by name and group with every token required', () => {
    expect(filterStreamerbotActions(actions, 'alert').map((item) => item.name)).toEqual(['Alert'])
    expect(filterStreamerbotActions(actions, 'ALERTS').map((item) => item.name)).toEqual(['Alert'])
    expect(filterStreamerbotActions(actions, 'scene intro').map((item) => item.name)).toEqual([
      'Scene Intro',
    ])
    expect(filterStreamerbotActions(actions, 'raid alerts')).toEqual([])
    expect(filterStreamerbotActions(actions, '   ')).toHaveLength(3)
  })

  it('groups ungrouped actions first, then named groups alphabetically', () => {
    expect(groupStreamerbotActions(actions)).toEqual([
      { group: null, actions: [actions[1]] },
      { group: 'Alerts', actions: [actions[0]] },
      { group: 'Scenes', actions: [actions[2]] },
    ])
  })

  it('matches names exactly and ignores blank selections', () => {
    expect(findStreamerbotAction(actions, ' Alert ')?.id).toBe('a')
    expect(findStreamerbotAction(actions, 'alert')).toBeUndefined()
    expect(findStreamerbotAction(actions, '  ')).toBeUndefined()
  })

  it('validates required 1..128-character action names', () => {
    expect(streamerbotNameError('')).toContain('Required')
    expect(streamerbotNameError('   ')).toContain('Required')
    expect(streamerbotNameError('x'.repeat(128))).toBeNull()
    expect(streamerbotNameError('x'.repeat(129))).toContain('128')
  })

  it('keeps a newly added action schema-valid until a real name is picked', () => {
    expect(streamerbotNameError(STREAMERBOT_ACTION_PLACEHOLDER)).toBeNull()
    expect(
      ActionSchema.safeParse({
        type: 'streamerbot',
        action: 'doAction',
        actionName: STREAMERBOT_ACTION_PLACEHOLDER,
      }).success,
    ).toBe(true)
  })

  it('builds the collapsed STREAMER.BOT summary', () => {
    expect(
      streamerbotActionSummary({ type: 'streamerbot', action: 'doAction', actionName: '' }),
    ).toBe('STREAMER.BOT · No action selected')
    expect(
      streamerbotActionSummary({ type: 'streamerbot', action: 'doAction', actionName: ' Alert ' }),
    ).toBe('STREAMER.BOT · Alert')
    expect(
      streamerbotActionSummary({
        type: 'streamerbot',
        action: 'doAction',
        actionName: 'Alert',
        args: { user: 'Ada', amount: '5' },
      }),
    ).toBe('STREAMER.BOT · Alert · 2 args')
  })

  it('clips long one-line summaries', () => {
    const summary = streamerbotActionSummary({
      type: 'streamerbot',
      action: 'doAction',
      actionName: `${'x'.repeat(60)}\n${'y'.repeat(20)}`,
    })
    expect(summary).toContain('…')
    expect(summary.length).toBeLessThan(70)
  })
})

describe('Streamer.bot settings validation', () => {
  it('accepts bare hosts and bracketed IPv6 only', () => {
    expect(streamerbotHostError('127.0.0.1')).toBeNull()
    expect(streamerbotHostError('localhost')).toBeNull()
    expect(streamerbotHostError('studio-bot.lan')).toBeNull()
    expect(streamerbotHostError('[::1]')).toBeNull()
    expect(streamerbotHostError('')).toContain('Enter a host')
    expect(streamerbotHostError('ws://127.0.0.1')).toContain('no scheme')
    expect(streamerbotHostError('host/path')).toContain('no scheme')
    expect(streamerbotHostError('host:8080')).toContain('port')
    expect(streamerbotHostError('bad_host')).toContain('letters')
    expect(streamerbotHostError('a..b')).toContain('valid hostname')
    expect(streamerbotHostError('[abcd]')).toContain('IPv6')
  })

  it('validates the port and detects loopback hosts', () => {
    expect(streamerbotPortError(8080)).toBeNull()
    expect(streamerbotPortError('8080')).toBeNull()
    expect(streamerbotPortError(0)).toContain('1 and 65535')
    expect(streamerbotPortError(65536)).toContain('1 and 65535')
    expect(streamerbotPortError('abc')).toContain('1 and 65535')
    expect(isLoopbackStreamerbotHost('127.0.0.1')).toBe(true)
    expect(isLoopbackStreamerbotHost('LOCALHOST')).toBe(true)
    expect(isLoopbackStreamerbotHost('192.168.1.20')).toBe(false)
  })
})

describe('Streamer.bot argument rows', () => {
  it('seeds rows from an existing argument map', () => {
    const rows = streamerbotArgRows({ user: 'Ada', amount: '5' })
    expect(rows.map((item) => [item.key, item.value])).toEqual([
      ['user', 'Ada'],
      ['amount', '5'],
    ])
    expect(new Set(rows.map((item) => item.id)).size).toBe(2)
    expect(streamerbotArgRows()).toEqual([])
    expect(streamerbotArgRows(null)).toEqual([])
  })

  it('adds, updates and removes rows up to sixteen entries', () => {
    const one = appendStreamerbotArg([])
    expect(one).toHaveLength(1)
    const updated = updateStreamerbotArg(one, one[0]!.id, { key: 'user', value: 'Ada' })
    expect(updated[0]).toMatchObject({ key: 'user', value: 'Ada' })
    expect(removeStreamerbotArg(updated, updated[0]!.id)).toEqual([])

    const full = Array.from({ length: 16 }, (_, index) => row(`r${index}`, `k${index}`))
    expect(appendStreamerbotArg(full)).toHaveLength(16)
    expect(streamerbotActiveArgCount(full)).toBe(16)
    expect(streamerbotActiveArgCount([...full, row('blank', '')])).toBe(16)
  })

  it('validates lengths, blank names and case-insensitive duplicates', () => {
    expect(streamerbotArgRowError([row('a', 'user', 'Ada')], 'a')).toBeNull()
    expect(streamerbotArgRowError([row('a', 'x'.repeat(65))], 'a')).toContain('64')
    expect(streamerbotArgRowError([row('a', 'user', 'x'.repeat(513))], 'a')).toContain('512')
    expect(streamerbotArgRowError([row('a', '', 'Ada')], 'a')).toContain('Name required')
    expect(streamerbotArgRowError([row('a', '', '')], 'a')).toBeNull()
    expect(
      streamerbotArgRowError([row('a', 'User', 'Ada'), row('b', 'user', 'Grace')], 'b'),
    ).toContain('Duplicate')
    expect(
      streamerbotArgRowError([row('a', 'User', 'Ada'), row('b', 'user', 'Grace')], 'a'),
    ).toBeNull()
    expect(streamerbotArgError([row('a', 'user'), row('b', '', 'Ada')])).toBe(
      'Argument 2: Name required.',
    )
    expect(streamerbotArgError([])).toBeNull()
  })

  it('builds a trimmed map, skips blanks and keeps the first duplicate', () => {
    expect(
      streamerbotArgsFromRows([
        row('a', ' user ', 'Ada'),
        row('b', '', 'ignored'),
        row('c', 'USER', 'Grace'),
        row('d', 'amount', '5'),
      ]),
    ).toEqual({ user: 'Ada', amount: '5' })
    expect(streamerbotArgsFromRows([row('a', '', 'only a value')])).toBeUndefined()
    expect(streamerbotArgsFromRows([])).toBeUndefined()
  })
})

describe('streamerbot executor compatibility', () => {
  it('keeps the shared action shape intact', () => {
    const action: StreamerBotAction = {
      type: 'streamerbot',
      action: 'doAction',
      actionName: 'Alert',
      args: { user: 'Ada' },
    }
    expect(ActionSchema.safeParse(action).success).toBe(true)
    expect(ActionSchema.safeParse({ ...action, actionName: '' }).success).toBe(false)

    const args = streamerbotArgsFromRows([row('a', ' user ', 'Ada'), row('b', 'note', '')])
    expect(ActionSchema.safeParse({ ...action, args }).success).toBe(true)
  })
})
