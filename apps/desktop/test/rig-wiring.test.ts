import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import {
  createDefaultConfig,
  rigActionOf,
  rigById,
  RIG_CAPABILITY,
  type ClientMessage,
  type DeckConfig,
  type PlanGroup,
  type RigPreset,
  type ServerMessage,
} from '@phonedek/shared'
import { AssetStore } from '../src/main/assets'
import type { ExecutePlanOptions, PlanResult } from '../src/main/executor'
import { RigRunner, type RigProgressFrame } from '../src/main/rig-runner'
import { DeckServer, type PressContext } from '../src/main/server'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

function waitFor<T>(fn: () => T | undefined | null | false, timeout = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = (): void => {
      const value = fn()
      if (value) {
        resolve(value)
        return
      }
      if (Date.now() - started > timeout) {
        reject(new Error('Timed out waiting for condition'))
        return
      }
      setTimeout(tick, 20)
    }
    tick()
  })
}

function openSocket(
  target: string,
): Promise<{ ws: WebSocket; messages: ServerMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target)
    const messages: ServerMessage[] = []
    ws.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage))
    ws.on('open', () => resolve({ ws, messages }))
    ws.on('error', reject)
  })
}

function hello(capabilities: string[]): ClientMessage {
  return {
    type: 'hello',
    protocol: 1,
    device: { name: 'Test phone', model: 'test', appVersion: '0.15.0' },
    capabilities,
  }
}

function goLiveRig(): RigPreset {
  return {
    id: 'go-live',
    name: 'Go Live',
    steps: [
      { label: 'Scene', action: { type: 'obs', action: 'setScene', scene: 'Main' } },
      { label: 'Record', action: { type: 'obs', action: 'startRecord' } },
    ],
  }
}

function rigConfig(): DeckConfig {
  const config = createDefaultConfig()
  config.serverName = 'Rig test'
  config.rigs = [goLiveRig()]
  const button = config.profiles[0]!.pages[0]!.buttons[0]!
  ;(button as unknown as { actions: unknown[] }).actions = [
    { type: 'rig', action: 'run', presetId: 'go-live' },
  ]
  return config
}

function planResult(total: number): PlanResult {
  return {
    ok: true,
    completed: total,
    total,
    failures: [],
    cancelled: false,
    timedOut: false,
    stoppedOnFailure: false,
    message: 'ok',
  }
}

describe('rig wiring composition', () => {
  it('previews without progress/last-run and runs from a press through the capability gate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phonedek-rig-wiring-'))
    const config = rigConfig()
    const frames: RigProgressFrame[] = []
    let deckServer: DeckServer | null = null
    const calls: Array<{ groups: readonly PlanGroup[]; options: ExecutePlanOptions }> = []

    const runner = new RigRunner(
      {
        executePlan: async (groups, _label, options) => {
          calls.push({ groups, options })
          for (let index = 0; index < groups.length; index += 1) {
            options.onProgress?.({
              index: index + 1,
              total: groups.length,
              label: groups[index]!.label,
              ok: true,
            })
          }
          return planResult(groups.length)
        },
        probes: {},
      },
      {
        onProgress: (frame) => {
          frames.push(frame)
          deckServer?.sendToClientsWithCapability(RIG_CAPABILITY, {
            type: 'rigProgress',
            ...frame,
          })
        },
      },
    )

    const preview = await runner.preview(goLiveRig())
    expect(preview).toMatchObject({ presetId: 'go-live', ok: true, total: 2 })
    expect(frames).toHaveLength(0)
    expect(runner.lastRun('go-live')).toBeUndefined()

    const token = 'rig-token'
    const server = new DeckServer({
      port: 0,
      token,
      version: '0.15.0',
      assets: new AssetStore(join(dir, 'assets')),
      getConfig: () => config,
      getServerName: () => config.serverName,
      onPress: async (_client, _message, context: PressContext) => {
        const action = rigActionOf(context.button.actions)
        if (!action) return { ok: false, error: 'not a rig button' }
        const result = await runner.run(rigById(config.rigs, action.presetId), {
          presetId: action.presetId,
          buttonId: context.button.id,
        })
        return {
          ok: result.ok,
          ...(result.error !== undefined ? { error: result.error } : {}),
          ...(result.message !== undefined ? { message: result.message } : {}),
        }
      },
    })
    deckServer = server
    const port = await server.start()
    cleanups.push(() => server.stop())

    const capable = await openSocket(`ws://127.0.0.1:${port}/ws?token=${token}`)
    const old = await openSocket(`ws://127.0.0.1:${port}/ws?token=${token}`)
    cleanups.push(async () => {
      capable.ws.close()
      old.ws.close()
    })
    const capableHello = await waitFor(() =>
      capable.messages.find((message) => message.type === 'hello'),
    )
    // The rig config still loads for an old client; it just sees an unknown
    // action object and the final pressResult.
    expect(capableHello.type === 'hello' && capableHello.config.rigs?.[0]?.id).toBe('go-live')
    await waitFor(() => old.messages.some((message) => message.type === 'hello'))
    capable.ws.send(JSON.stringify(hello([RIG_CAPABILITY, 'control-state-v1'])))
    old.ws.send(JSON.stringify(hello([])))
    await new Promise((resolve) => setTimeout(resolve, 60))

    const button = config.profiles[0]!.pages[0]!.buttons[0]!
    capable.ws.send(
      JSON.stringify({
        type: 'press',
        requestId: 'req-1',
        profileId: config.profiles[0]!.id,
        pageId: config.profiles[0]!.pages[0]!.id,
        buttonId: button.id,
      } satisfies ClientMessage),
    )

    const press = await waitFor(() =>
      capable.messages.find((message) => message.type === 'pressResult'),
    )
    expect(press).toMatchObject({
      type: 'pressResult',
      requestId: 'req-1',
      buttonId: button.id,
      ok: true,
    })
    expect(calls).toHaveLength(1)
    expect(frames.map((frame) => frame.phase)).toEqual(['start', 'step', 'step', 'done'])
    expect(frames[0]!.buttonId).toBe(button.id)

    const progress = capable.messages.filter((message) => message.type === 'rigProgress')
    expect(progress).toHaveLength(4)
    expect(progress.at(-1)).toMatchObject({ phase: 'done', presetId: 'go-live', ok: true })

    // An old phone still presses the rig as an opaque action: it gets the final
    // pressResult and never an unknown `rigProgress` frame.
    old.ws.send(
      JSON.stringify({
        type: 'press',
        requestId: 'req-2',
        profileId: config.profiles[0]!.id,
        pageId: config.profiles[0]!.pages[0]!.id,
        buttonId: button.id,
      } satisfies ClientMessage),
    )
    const oldPress = await waitFor(() =>
      old.messages.find((message) => message.type === 'pressResult'),
    )
    expect(oldPress).toMatchObject({ type: 'pressResult', requestId: 'req-2', ok: true })
    expect(old.messages.some((message) => message.type === 'rigProgress')).toBe(false)
    expect(runner.lastRun('go-live')?.status).toBe('ok')
  })
})
