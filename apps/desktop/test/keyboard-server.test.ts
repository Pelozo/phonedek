import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { createDefaultConfig } from '@phonedek/shared'
import type {
  Action,
  ClientMessage,
  DeckButton,
  DeckConfig,
  KeyboardMessage,
  KeyboardResult,
  KeyboardStartMessage,
  ServerMessage,
} from '@phonedek/shared'
import { AssetStore } from '../src/main/assets'
import {
  DeckServer,
  outdatedClientMessage,
  serverCapabilities,
  type KeyboardContext,
} from '../src/main/server'

interface KeyboardCall {
  message: KeyboardMessage
  context: KeyboardContext | null
}

interface Harness {
  server: DeckServer
  port: number
  token: string
  config: DeckConfig
  button: DeckButton
  calls: KeyboardCall[]
}

const cleanups: Array<() => Promise<void>> = []

async function harness(
  handlerResult: (message: KeyboardMessage) => KeyboardResult = (message) => ({
    seq: message.seq,
    ok: true,
  }),
  keyboardSupported: () => boolean = () => true,
): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'phonedek-keyboard-server-'))
  const config = createDefaultConfig()
  config.serverName = 'Keyboard deck'
  const button = config.profiles[0]!.pages[0]!.buttons[0]!
  button.actions = [{ type: 'keyboard', action: 'open' }] as unknown as Action[]
  const calls: KeyboardCall[] = []
  const token = 'test-token-keyboard'
  const server = new DeckServer({
    port: 0,
    token,
    version: '0.1.0',
    assets: new AssetStore(join(dir, 'assets')),
    getConfig: () => config,
    getServerName: () => config.serverName,
    onPress: async () => ({ ok: true }),
    keyboardSupported,
    onKeyboard: async (_client, message, context) => {
      calls.push({ message, context })
      return handlerResult(message)
    },
  })
  const port = await server.start()
  cleanups.push(() => server.stop())
  return { server, port, token, config, button, calls }
}

function socketUrl(h: Harness): string {
  return `ws://127.0.0.1:${h.port}/ws?token=${encodeURIComponent(h.token)}`
}

function openSocket(h: Harness): Promise<{ ws: WebSocket; messages: ServerMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl(h))
    const messages: ServerMessage[] = []
    ws.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage))
    ws.on('open', () => resolve({ ws, messages }))
    ws.on('error', reject)
  })
}

function send(ws: WebSocket, message: ClientMessage): void {
  ws.send(JSON.stringify(message))
}

function waitFor<T>(check: () => T | undefined | null | false, timeout = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = (): void => {
      const value = check()
      if (value) {
        resolve(value)
        return
      }
      if (Date.now() - started > timeout) {
        reject(new Error('Timed out waiting for condition'))
        return
      }
      setTimeout(tick, 10)
    }
    tick()
  })
}

function startMessage(button: DeckButton, seq = 1): KeyboardStartMessage {
  return {
    type: 'keyboard',
    seq,
    phase: 'start',
    profileId: 'profile-desktop',
    pageId: 'page-main',
    controlId: button.id,
  }
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

describe('keyboard capability', () => {
  it('advertises keyboard-v1 only when the host and switch allow it', async () => {
    const enabled = await harness(undefined, () => true)
    const info = await fetch(`http://127.0.0.1:${enabled.port}/api/info`)
    const body = (await info.json()) as { capabilities?: string[] }
    expect(body.capabilities).toContain('keyboard-v1')

    const disabled = await harness(undefined, () => false)
    const offInfo = await fetch(`http://127.0.0.1:${disabled.port}/api/info`)
    const offBody = (await offInfo.json()) as { capabilities?: string[] }
    expect(offBody.capabilities).not.toContain('keyboard-v1')

    const { ws, messages } = await openSocket(disabled)
    const hello = await waitFor(() => messages.find((message) => message.type === 'hello'))
    expect(hello.capabilities).not.toContain('keyboard-v1')
    ws.close()
  })

  it('lists keyboard-v1 in the host capability helper', () => {
    expect(serverCapabilities(true, false, false, false, false, true)).toContain('keyboard-v1')
    expect(serverCapabilities(true, false, false, false, false, false)).not.toContain('keyboard-v1')
  })

  it('notifies old phones when the deck uses the keyboard', () => {
    const config = createDefaultConfig()
    const button = config.profiles[0]!.pages[0]!.buttons[0]!
    button.actions = [{ type: 'keyboard', action: 'open' }] as unknown as Action[]

    expect(outdatedClientMessage(config, [], false, true)).toBe(
      'This deck uses the Keyboard. Update the PhoneDeck app on your phone to use it.',
    )
    expect(outdatedClientMessage(config, ['keyboard-v1'], false, true)).toBeNull()
    expect(outdatedClientMessage(config, [], false, false)).toBeNull()
  })
})

describe('keyboard message handling', () => {
  it('resolves the launcher and acks start/end but not text', async () => {
    const h = await harness()
    const { ws, messages } = await openSocket(h)
    await waitFor(() => messages.find((message) => message.type === 'hello'))

    send(ws, { type: 'hello', protocol: 1, device: { name: 'Test phone' }, capabilities: ['keyboard-v1'] })
    send(ws, startMessage(h.button, 10))
    const started = await waitFor(() =>
      messages.find(
        (message): message is ServerMessage & { type: 'keyboardResult' } =>
          message.type === 'keyboardResult' && message.seq === 10,
      ),
    )
    expect(started.ok).toBe(true)
    expect(h.calls[0]?.context?.button.id).toBe(h.button.id)

    send(ws, { type: 'keyboard', seq: 11, phase: 'text', text: 'hello' })
    send(ws, { type: 'keyboard', seq: 12, phase: 'end' })
    const ended = await waitFor(() =>
      messages.find(
        (message): message is ServerMessage & { type: 'keyboardResult' } =>
          message.type === 'keyboardResult' && message.seq === 12,
      ),
    )
    expect(ended.ok).toBe(true)
    expect(messages.some((message) => message.type === 'keyboardResult' && message.seq === 11)).toBe(
      false,
    )
    expect(h.calls.map((call) => call.message.phase)).toEqual(['start', 'text', 'end'])

    ws.close()
  })

  it('rejects a start that does not resolve to a keyboard launcher', async () => {
    const h = await harness()
    const { ws, messages } = await openSocket(h)
    await waitFor(() => messages.find((message) => message.type === 'hello'))

    send(ws, { ...startMessage(h.button, 20), controlId: 'missing-button' })
    const missing = await waitFor(() =>
      messages.find(
        (message): message is ServerMessage & { type: 'keyboardResult' } =>
          message.type === 'keyboardResult' && message.seq === 20,
      ),
    )
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('not found')
    expect(h.calls).toHaveLength(0)

    h.button.actions = []
    send(ws, startMessage(h.button, 21))
    const plain = await waitFor(() =>
      messages.find(
        (message): message is ServerMessage & { type: 'keyboardResult' } =>
          message.type === 'keyboardResult' && message.seq === 21,
      ),
    )
    expect(plain.ok).toBe(false)
    expect(plain.error).toContain('does not open the phone keyboard')

    ws.close()
  })

  it('reports handler errors and protocol text limits', async () => {
    const h = await harness((message) =>
      message.phase === 'text'
        ? { seq: message.seq, ok: false, error: 'Keyboard control is suspended on the PC.' }
        : { seq: message.seq, ok: true },
    )
    const { ws, messages } = await openSocket(h)
    await waitFor(() => messages.find((message) => message.type === 'hello'))

    send(ws, startMessage(h.button, 30))
    await waitFor(() =>
      messages.find((message) => message.type === 'keyboardResult' && message.seq === 30),
    )

    send(ws, { type: 'keyboard', seq: 31, phase: 'text', text: 'a'.repeat(4096) })
    const failed = await waitFor(() =>
      messages.find(
        (message): message is ServerMessage & { type: 'keyboardResult' } =>
          message.type === 'keyboardResult' && message.seq === 31,
      ),
    )
    expect(failed.ok).toBe(false)
    expect(failed.error).toContain('suspended')

    send(ws, { type: 'keyboard', seq: 32, phase: 'text', text: 'a'.repeat(4097) })
    const bad = await waitFor(() =>
      messages.find(
        (message): message is ServerMessage & { type: 'error' } =>
          message.type === 'error' && message.code === 'BAD_MESSAGE',
      ),
    )
    expect(bad.message).toContain('4096')

    ws.close()
  })
})
