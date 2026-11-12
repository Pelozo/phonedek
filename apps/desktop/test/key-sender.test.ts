import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HelperKeySender,
  MacKeySender,
  WindowsKeySender,
  createKeySender,
  helperFailure,
} from '../src/main/key-sender'

describe('createKeySender', () => {
  it('selects the macOS helper on darwin', () => {
    const sender = createKeySender('/Applications/PhoneDeck.app/Contents/Resources/keyboard-helper', 'darwin')
    expect(sender).toBeInstanceOf(MacKeySender)
    expect(sender).toHaveProperty('prewarm')
  })

  it('keeps the Windows helper on win32', () => {
    expect(createKeySender('C:\\PhoneDeck\\keyboard-helper.ps1', 'win32')).toBeInstanceOf(WindowsKeySender)
  })
})

describe('helperFailure', () => {
  it('turns the accessibility error into actionable instructions', () => {
    const error = helperFailure('Accessibility permission is required', 'accessibility')
    expect(error.message).toMatch(/Privacy & Security/)
    expect(error.message).toMatch(/Accessibility/)
  })

  it('preserves ordinary helper errors', () => {
    expect(helperFailure('Unknown key: NOPE').message).toBe('Unknown key: NOPE')
    expect(helperFailure(undefined).message).toBe('Keyboard helper failed')
  })
})

describe('HelperKeySender serialization', () => {
  it('forwards held down/press/up steps in order to a fake helper', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'phonedek-key-'))
    const script = join(directory, 'fake-helper.cjs')
    const log = join(directory, 'steps.jsonl')
    writeFileSync(
      script,
      [
        "const fs = require('node:fs')",
        "const readline = require('node:readline')",
        'const log = process.argv[2]',
        "process.stdout.write('{\"ready\":true}\\n')",
        "const rl = readline.createInterface({ input: process.stdin })",
        "rl.on('line', (line) => {",
        '  if (!line.trim()) return',
        '  const command = JSON.parse(line)',
        '  fs.appendFileSync(log, JSON.stringify(command.steps) + "\\n")',
        '  process.stdout.write(JSON.stringify({ id: command.id, ok: true }) + "\\n")',
        '})',
      ].join('\n'),
      'utf8',
    )

    const sender = new HelperKeySender(script, {
      command: process.execPath,
      args: [script, log],
      label: 'fake helper',
    })
    try {
      await sender.send({ kind: 'keys', keys: ['ALT'], holdMs: 0, action: 'down' })
      await sender.send({ kind: 'keys', keys: ['TAB'], holdMs: 35, action: 'press' })
      await sender.send({ kind: 'keys', keys: ['ALT'], holdMs: 0, action: 'up' })

      const steps = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as unknown[])
      expect(steps).toEqual([
        [{ kind: 'keys', keys: ['ALT'], holdMs: 0, action: 'down' }],
        [{ kind: 'keys', keys: ['TAB'], holdMs: 35, action: 'press' }],
        [{ kind: 'keys', keys: ['ALT'], holdMs: 0, action: 'up' }],
      ])
    } finally {
      sender.dispose()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

