import { describe, expect, it } from 'vitest'
import { macApplicationOpenArgs } from '../src/main/host-actions'

describe('macApplicationOpenArgs', () => {
  it('opens an app bundle without arguments', () => {
    expect(macApplicationOpenArgs('/Applications/TextEdit.app', [])).toEqual([
      '-a',
      '/Applications/TextEdit.app',
    ])
  })

  it('forwards arguments after --args', () => {
    expect(macApplicationOpenArgs('/Applications/Visual Studio Code.app', ['notes.txt', '--new-window'])).toEqual([
      '-a',
      '/Applications/Visual Studio Code.app',
      '--args',
      'notes.txt',
      '--new-window',
    ])
  })
})
