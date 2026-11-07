/** Keyboard naming shared by the recorder, the editor and the native helper. */

const ALIASES: Record<string, string> = {
  CONTROL: 'CTRL',
  CTRL: 'CTRL',
  CMD: 'WIN',
  COMMAND: 'WIN',
  META: 'WIN',
  SUPER: 'WIN',
  WIN: 'WIN',
  WINDOWS: 'WIN',
  ESCAPE: 'ESC',
  ESC: 'ESC',
  RETURN: 'ENTER',
  ENTER: 'ENTER',
  DEL: 'DELETE',
  DELETE: 'DELETE',
  INS: 'INSERT',
  INSERT: 'INSERT',
  PAGEUP: 'PGUP',
  PAGEDOWN: 'PGDN',
  PGUP: 'PGUP',
  PGDN: 'PGDN',
  SPACEBAR: 'SPACE',
  SPACE: 'SPACE',
  ' ': 'SPACE',
  ARROWUP: 'UP',
  ARROWDOWN: 'DOWN',
  ARROWLEFT: 'LEFT',
  ARROWRIGHT: 'RIGHT',
  UP: 'UP',
  DOWN: 'DOWN',
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  PRINTSCREEN: 'PRINTSCREEN',
  PRTSC: 'PRINTSCREEN',
  PRINT: 'PRINTSCREEN',
  CAPSLOCK: 'CAPSLOCK',
  CAPS: 'CAPSLOCK',
  NUMLOCK: 'NUMLOCK',
  SCROLLLOCK: 'SCROLLLOCK',
  CONTEXTMENU: 'MENU',
  APPS: 'MENU',
  MENU: 'MENU',
  BACKQUOTE: '`',
  BACKSLASH: '\\',
  SLASH: '/',
  COMMA: ',',
  PERIOD: '.',
  SEMICOLON: ';',
  QUOTE: "'",
  BRACKETLEFT: '[',
  BRACKETRIGHT: ']',
  MINUS: '-',
  EQUAL: '=',
  PLUS: '+',
  ASTERISK: '*',
  TAB: 'TAB',
  BACKSPACE: 'BACKSPACE',
  HOME: 'HOME',
  END: 'END',
  PAUSE: 'PAUSE',
  SCROLL: 'SCROLLLOCK',
  SHIFT: 'SHIFT',
  ALT: 'ALT',
  OPTION: 'ALT',
}

const NAMED = new Set([
  'TAB',
  'ENTER',
  'ESC',
  'SPACE',
  'BACKSPACE',
  'DELETE',
  'INSERT',
  'HOME',
  'END',
  'PGUP',
  'PGDN',
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT',
  'PRINTSCREEN',
  'CAPSLOCK',
  'NUMLOCK',
  'SCROLLLOCK',
  'PAUSE',
  'MENU',
  'SHIFT',
  'CTRL',
  'ALT',
  'WIN',
])

const PUNCTUATION = new Set(['`', '\\', '/', ',', '.', ';', "'", '[', ']', '-', '=', '+', '*'])

const MODIFIER_ORDER = ['CTRL', 'ALT', 'SHIFT', 'WIN'] as const

/** Normalize one key name. Throws a descriptive error for unknown names. */
export function normalizeKey(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Empty key name')
  const upper = trimmed.toUpperCase()
  const alias = ALIASES[upper]
  if (alias) return alias
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(upper)) return upper
  if (/^[A-Z]$/.test(upper)) return upper
  if (/^[0-9]$/.test(upper)) return upper
  if (upper === 'NUMPAD0') return 'NUMPAD0'
  if (/^NUMPAD[0-9]$/.test(upper)) return upper
  if (NAMED.has(upper)) return upper
  if (trimmed.length === 1 && PUNCTUATION.has(trimmed)) return trimmed
  throw new Error(`Unknown key: ${raw}`)
}

export function isValidKeyName(raw: string): boolean {
  try {
    normalizeKey(raw)
    return true
  } catch {
    return false
  }
}

export function isModifier(key: string): boolean {
  return (MODIFIER_ORDER as readonly string[]).includes(key)
}

/**
 * Normalize and order a chord. Modifiers are placed first (CTRL, ALT, SHIFT, WIN)
 * followed by the remaining keys in their original order.
 */
export function normalizeCombo(keys: readonly string[]): string[] {
  if (keys.length === 0) throw new Error('A shortcut needs at least one key')
  const seen = new Set<string>()
  const mods: string[] = []
  const rest: string[] = []
  for (const raw of keys) {
    const key = normalizeKey(raw)
    if (seen.has(key)) continue
    seen.add(key)
    if (isModifier(key)) mods.push(key)
    else rest.push(key)
  }
  mods.sort((a, b) => MODIFIER_ORDER.indexOf(a as (typeof MODIFIER_ORDER)[number]) - MODIFIER_ORDER.indexOf(b as (typeof MODIFIER_ORDER)[number]))
  return [...mods, ...rest]
}

/**
 * True for the Windows Snipping Tool chord (Win+Shift+S), regardless of key
 * order or aliases. The desktop executor uses this intent on macOS to take a
 * full screenshot instead of sending Cmd+Shift+S ("Save As…").
 */
export function isScreenshotShortcut(keys: readonly string[]): boolean {
  let combo: string[]
  try {
    combo = normalizeCombo(keys)
  } catch {
    return false
  }
  return (
    combo.length === 3 &&
    combo.includes('WIN') &&
    combo.includes('SHIFT') &&
    combo.includes('S')
  )
}

const LABELS: Record<string, string> = {
  CTRL: 'Ctrl',
  ALT: 'Alt',
  SHIFT: 'Shift',
  WIN: 'Win',
  ESC: 'Esc',
  ENTER: 'Enter',
  SPACE: 'Space',
  BACKSPACE: 'Backspace',
  DELETE: 'Del',
  INSERT: 'Ins',
  PGUP: 'PgUp',
  PGDN: 'PgDn',
  PRINTSCREEN: 'PrtSc',
  CAPSLOCK: 'Caps',
  NUMLOCK: 'Num',
  SCROLLLOCK: 'Scroll',
  TAB: 'Tab',
  UP: '↑',
  DOWN: '↓',
  LEFT: '←',
  RIGHT: '→',
  MENU: 'Menu',
  PAUSE: 'Pause',
}

export function formatKeyLabel(key: string): string {
  return LABELS[key] ?? key
}

export function formatCombo(keys: readonly string[]): string {
  return keys.map(formatKeyLabel).join(' + ')
}

/** Convert a DOM keyboard event (or a plain test object) to a canonical key. */
export function keyFromEvent(event: { key: string; code?: string }): string | null {
  const code = event.code ?? ''
  const key = event.key

  if (key === ' ' || code === 'Space') return 'SPACE'

  const direct = ALIASES[key.toUpperCase()]
  if (direct) return direct

  switch (key) {
    case 'Control':
      return 'CTRL'
    case 'Shift':
      return 'SHIFT'
    case 'Alt':
      return 'ALT'
    case 'Meta':
    case 'OS':
      return 'WIN'
    case 'Escape':
      return 'ESC'
    case 'Enter':
      return 'ENTER'
    case 'Tab':
      return 'TAB'
    case 'Backspace':
      return 'BACKSPACE'
    case 'Delete':
      return 'DELETE'
    case 'Insert':
      return 'INSERT'
    case 'Home':
      return 'HOME'
    case 'End':
      return 'END'
    case 'PageUp':
      return 'PGUP'
    case 'PageDown':
      return 'PGDN'
    case 'ArrowUp':
      return 'UP'
    case 'ArrowDown':
      return 'DOWN'
    case 'ArrowLeft':
      return 'LEFT'
    case 'ArrowRight':
      return 'RIGHT'
    case 'PrintScreen':
      return 'PRINTSCREEN'
    case 'CapsLock':
      return 'CAPSLOCK'
    case 'NumLock':
      return 'NUMLOCK'
    case 'ScrollLock':
      return 'SCROLLLOCK'
    case 'Pause':
      return 'PAUSE'
    case 'ContextMenu':
      return 'MENU'
    default:
      break
  }

  // Use physical codes for letters/digits/punctuation so shifted symbols
  // (e.g. "!" typed with Shift+1) still produce a sane chord.
  const codeMap: Record<string, string> = {
    Semicolon: ';',
    Equal: '=',
    Minus: '-',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backquote: '`',
  }
  if (codeMap[code]) return codeMap[code]
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) return key

  if (key.length === 1) {
    try {
      return normalizeKey(key)
    } catch {
      return null
    }
  }
  return null
}

export function isPrintableKey(key: string): boolean {
  return key.length === 1 && !isModifier(key)
}
