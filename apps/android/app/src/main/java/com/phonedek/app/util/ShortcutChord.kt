package com.phonedek.app.util

import java.util.Locale

/**
 * Pure key-name helpers for shortcut (key wheel) controls.
 *
 * The phone never sends the chord itself: the desktop maps deltas to key
 * chords. The tile only needs to show which chord a detent will send, so this
 * mirrors the shared `keys.ts` aliases closely enough to normalize, validate
 * and render desktop-authored bindings.
 */
object ShortcutChord {
    private val aliases = mapOf(
        "CONTROL" to "CTRL",
        "CTRL" to "CTRL",
        "CMD" to "WIN",
        "COMMAND" to "WIN",
        "META" to "WIN",
        "SUPER" to "WIN",
        "WIN" to "WIN",
        "WINDOWS" to "WIN",
        "ESCAPE" to "ESC",
        "ESC" to "ESC",
        "RETURN" to "ENTER",
        "ENTER" to "ENTER",
        "DEL" to "DELETE",
        "DELETE" to "DELETE",
        "INS" to "INSERT",
        "INSERT" to "INSERT",
        "PAGEUP" to "PGUP",
        "PAGEDOWN" to "PGDN",
        "PGUP" to "PGUP",
        "PGDN" to "PGDN",
        "SPACEBAR" to "SPACE",
        "SPACE" to "SPACE",
        "ARROWUP" to "UP",
        "ARROWDOWN" to "DOWN",
        "ARROWLEFT" to "LEFT",
        "ARROWRIGHT" to "RIGHT",
        "UP" to "UP",
        "DOWN" to "DOWN",
        "LEFT" to "LEFT",
        "RIGHT" to "RIGHT",
        "PRINTSCREEN" to "PRINTSCREEN",
        "PRTSC" to "PRINTSCREEN",
        "PRINT" to "PRINTSCREEN",
        "CAPSLOCK" to "CAPSLOCK",
        "CAPS" to "CAPSLOCK",
        "NUMLOCK" to "NUMLOCK",
        "SCROLLLOCK" to "SCROLLLOCK",
        "SCROLL" to "SCROLLLOCK",
        "CONTEXTMENU" to "MENU",
        "APPS" to "MENU",
        "MENU" to "MENU",
        "BACKQUOTE" to "`",
        "BACKSLASH" to "\\",
        "SLASH" to "/",
        "COMMA" to ",",
        "PERIOD" to ".",
        "SEMICOLON" to ";",
        "QUOTE" to "'",
        "BRACKETLEFT" to "[",
        "BRACKETRIGHT" to "]",
        "MINUS" to "-",
        "EQUAL" to "=",
        "PLUS" to "+",
        "ASTERISK" to "*",
        "TAB" to "TAB",
        "BACKSPACE" to "BACKSPACE",
        "HOME" to "HOME",
        "END" to "END",
        "PAUSE" to "PAUSE",
        "SHIFT" to "SHIFT",
        "ALT" to "ALT",
        "OPTION" to "ALT",
    )

    private val named = setOf(
        "TAB", "ENTER", "ESC", "SPACE", "BACKSPACE", "DELETE", "INSERT",
        "HOME", "END", "PGUP", "PGDN", "UP", "DOWN", "LEFT", "RIGHT",
        "PRINTSCREEN", "CAPSLOCK", "NUMLOCK", "SCROLLLOCK", "PAUSE", "MENU",
        "SHIFT", "CTRL", "ALT", "WIN",
    )

    private val punctuation = setOf(
        '`', '\\', '/', ',', '.', ';', '\'', '[', ']', '-', '=', '+', '*',
    )

    private val modifierOrder = listOf("CTRL", "ALT", "SHIFT", "WIN")

    private val functionKey = Regex("^F([1-9]|1[0-9]|2[0-4])$")
    private val numpadKey = Regex("^NUMPAD[0-9]$")
    private val letterKey = Regex("^[A-Z]$")

    // Compact glyphs. `WIN` is shown as the command glyph; it reads the same
    // on mac keyboards and is unambiguous for Windows users.
    private val symbols = mapOf(
        "CTRL" to "⌃",
        "SHIFT" to "⇧",
        "ALT" to "⌥",
        "WIN" to "⌘",
        "TAB" to "⇥",
        "UP" to "↑",
        "DOWN" to "↓",
        "LEFT" to "←",
        "RIGHT" to "→",
        "ENTER" to "↵",
        "ESC" to "⎋",
        "SPACE" to "␣",
        "BACKSPACE" to "⌫",
        "DELETE" to "⌦",
        "INSERT" to "⎀",
        "HOME" to "↖",
        "END" to "↘",
        "PGUP" to "⇞",
        "PGDN" to "⇟",
        "CAPSLOCK" to "⇪",
        "PRINTSCREEN" to "⎙",
        "MENU" to "☰",
        "PAUSE" to "⏸",
    )

    /** Canonical key name, or null when the name is not a known key. */
    fun normalizeKey(raw: String): String? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null
        val upper = trimmed.uppercase(Locale.ROOT)
        aliases[upper]?.let { return it }
        if (functionKey.matches(upper)) return upper
        if (letterKey.matches(upper)) return upper
        if (upper.length == 1 && upper[0] in '0'..'9') return upper
        if (numpadKey.matches(upper)) return upper
        if (upper in named) return upper
        if (trimmed.length == 1 && trimmed[0] in punctuation) return trimmed
        return null
    }

    /**
     * Validates and canonicalizes a chord the same way the desktop schema does:
     * 1..8 keys, known names, modifiers first (CTRL, ALT, SHIFT, WIN), then the
     * remaining keys in authored order. Duplicate keys are dropped.
     * Returns null when any key is unknown.
     */
    fun normalizeKeys(raw: List<String>): List<String>? {
        if (raw.isEmpty() || raw.size > 8) return null
        val seen = LinkedHashSet<String>()
        raw.forEach { key ->
            seen += normalizeKey(key) ?: return null
        }
        if (seen.isEmpty()) return null
        val modifiers = modifierOrder.filter { it in seen }
        val rest = seen.filter { it !in modifierOrder }
        return modifiers + rest
    }

    /** One compact glyph for a key name; unknown names fall back to upper case. */
    fun keyLabel(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return ""
        val canonical = normalizeKey(trimmed) ?: trimmed.uppercase(Locale.ROOT)
        return symbols[canonical] ?: canonical
    }

    /** Compact chord badge, e.g. `CTRL`+`TAB` -> `⌃⇥` or `[` as-is. */
    fun format(keys: List<String>): String =
        keys.map { keyLabel(it) }
            .filter { it.isNotEmpty() }
            .joinToString("")

    /**
     * Optional hold-key indicator, e.g. `+ALT`. Hold names stay as upper-case
     * words because the badge already uses tight modifier glyphs for the chord.
     */
    fun holdIndicator(holdKeys: List<String>?): String {
        if (holdKeys.isNullOrEmpty()) return ""
        val labels = holdKeys.mapNotNull { raw ->
            normalizeKey(raw) ?: raw.trim().uppercase(Locale.ROOT).takeIf { it.isNotEmpty() }
        }.distinct()
        if (labels.isEmpty()) return ""
        return labels.joinToString("+", prefix = "+")
    }

    /** Header badge: chord plus the optional hold indicator. */
    fun badge(keys: List<String>, holdKeys: List<String>? = null): String {
        val chord = format(keys)
        val hold = holdIndicator(holdKeys)
        return listOf(chord, hold).filter { it.isNotEmpty() }.joinToString(" ")
    }
}
