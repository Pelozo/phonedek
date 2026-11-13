import { describe, expect, it } from 'vitest'
import { ProfileMessageSchema, normalizeProfileId, parseClientMessage } from '../src/protocol'
import type { ServerMessage } from '../src/types'

describe('profile switch message', () => {
  it('accepts a valid server profile message', () => {
    const parsed = ProfileMessageSchema.safeParse({ type: 'profile', profileId: 'game-profile' })
    expect(parsed.success).toBe(true)

    const messages: ServerMessage[] = [{ type: 'profile', profileId: 'game-profile' }]
    expect(messages).toEqual([{ type: 'profile', profileId: 'game-profile' }])
  })

  it('rejects empty, overlong and malformed profile ids', () => {
    for (const profileId of ['', 'x'.repeat(65), 'with space', '../escape', '-leading']) {
      expect(ProfileMessageSchema.safeParse({ type: 'profile', profileId }).success).toBe(false)
    }
    expect(ProfileMessageSchema.safeParse({ type: 'profile' }).success).toBe(false)
    expect(ProfileMessageSchema.safeParse({ type: 'profile', profileId: 42 }).success).toBe(false)
  })

  it('normalizes a profile id and ignores unsafe values', () => {
    expect(normalizeProfileId('  game-profile  ')).toBe('game-profile')
    expect(normalizeProfileId('p_1')).toBe('p_1')
    for (const value of [undefined, null, 42, '', '   ', 'x'.repeat(65), 'a b', '/etc/passwd']) {
      expect(normalizeProfileId(value)).toBeNull()
    }
  })

  it('does not accept a server profile message as a client message', () => {
    expect(parseClientMessage({ type: 'profile', profileId: 'game-profile' }).ok).toBe(false)
  })
})
