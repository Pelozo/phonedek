import { describe, expect, it } from 'vitest'
import {
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
