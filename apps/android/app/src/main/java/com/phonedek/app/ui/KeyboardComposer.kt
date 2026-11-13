package com.phonedek.app.ui

import com.phonedek.app.data.DeckButton

/**
 * Pure rules for the phone keyboard panel. The Compose overlay and the
 * ViewModel both use these so the wire limits and the composition guard can be
 * unit-tested without an emulator.
 *
 * The panel is deliberately "line mode": text is only committed on an explicit
 * boundary (SEND, the IME Send action or the strip Enter). There is no timer,
 * because a timer fires while the IME is still composing and sends pinyin or
 * half-corrected words that the IME then rewrites.
 */

internal const val KEYBOARD_MAX_TEXT = 4096
internal const val KEYBOARD_MAX_KEYS = 8
internal const val KEYBOARD_MAX_REPEAT = 100

/** Canonical chord order used by the desktop's `normalizeCombo`. */
internal val KEYBOARD_MODIFIERS = listOf("CTRL", "ALT", "SHIFT", "WIN")

/** State shown in the panel header. Text/key successes are silent. */
enum class KeyboardStatus {
    READY,
    OPENING,
    TX_ERROR,
}

/** Result of inspecting a tapped deck button. */
sealed interface KeyboardLaunch {
    /** The button is not a phone-keyboard launcher. */
    data object NotLauncher : KeyboardLaunch

    /** It is a launcher, but this desktop did not advertise keyboard-v1. */
    data object Unsupported : KeyboardLaunch

    /** It is a launcher but the deck has no live socket right now. */
    data object Offline : KeyboardLaunch

    data class Open(
        val profileId: String,
        val pageId: String,
        val controlId: String,
        val label: String,
    ) : KeyboardLaunch
}

/** True when the button carries a phone-local keyboard open action. */
internal fun hasKeyboardAction(button: DeckButton): Boolean =
    button.actions.any { it.type == "keyboard" }

internal fun keyboardLaunch(
    button: DeckButton,
    profileId: String?,
    pageId: String?,
    capable: Boolean,
    connected: Boolean,
): KeyboardLaunch {
    if (!hasKeyboardAction(button)) return KeyboardLaunch.NotLauncher
    if (!capable) return KeyboardLaunch.Unsupported
    if (!connected || profileId.isNullOrBlank() || pageId.isNullOrBlank()) {
        return KeyboardLaunch.Offline
    }
    return KeyboardLaunch.Open(
        profileId = profileId,
        pageId = pageId,
        controlId = button.id,
        label = button.label,
    )
}

/**
 * Phases sent when the panel closes. A normal close releases held keys and then
 * ends the ordered queue; a background/ON_STOP close cancels pending work.
 */
internal fun keyboardClosePhases(cancel: Boolean): List<String> =
    if (cancel) listOf("cancel") else listOf("release", "end")

/**
 * Latched modifiers. A tap arms one for the next chord; a long-press locks it
 * for repeated chords. Locked modifiers survive [afterKey]; armed ones clear.
 */
data class KeyboardModifierState(
    val armed: Set<String> = emptySet(),
    val locked: Set<String> = emptySet(),
) {
    fun isActive(key: String): Boolean = key in armed || key in locked

    fun hasActive(): Boolean = armed.isNotEmpty() || locked.isNotEmpty()

    fun tap(key: String): KeyboardModifierState {
        if (key !in KEYBOARD_MODIFIERS) return this
        return if (key in armed) {
            copy(armed = armed - key)
        } else {
            copy(armed = armed + key)
        }
    }

    fun longPress(key: String): KeyboardModifierState {
        if (key !in KEYBOARD_MODIFIERS) return this
        return if (key in locked) {
            copy(locked = locked - key)
        } else {
            copy(locked = locked + key, armed = armed - key)
        }
    }

    /** Called after a non-modifier key: latched-for-one keys are consumed. */
    fun afterKey(): KeyboardModifierState = copy(armed = emptySet())

    fun clear(): KeyboardModifierState = KeyboardModifierState()

    /** Atomic chord: modifiers in canonical order, then the key. */
    fun chordFor(key: String): List<String> {
        val modifiers = KEYBOARD_MODIFIERS.filter { isActive(it) }
        val chord = buildList {
            addAll(modifiers)
            if (key !in modifiers) add(key)
        }
        return chord.take(KEYBOARD_MAX_KEYS)
    }
}

/** One line-mode commit. `enter` is only used by an auto-enter variant. */
data class KeyboardLineSend(
    val text: String,
    val enter: Boolean,
)

/**
 * The critical composition rule: never emit text while the IME reports an
 * active composition. Blank text is not a send.
 */
internal fun planLineSend(
    text: String,
    composing: Boolean,
    autoEnter: Boolean = false,
): KeyboardLineSend? {
    if (composing) return null
    if (text.isEmpty()) return null
    return KeyboardLineSend(text = text, enter = autoEnter)
}

/**
 * Split committed text into wire-sized chunks. Concatenating the result always
 * reproduces [text]; a surrogate pair is never cut, and a chunk prefers to end
 * just after whitespace inside its last quarter. `limit` is the protocol's
 * 4096 UTF-16 units.
 */
internal fun chunkKeyboardText(
    text: String,
    limit: Int = KEYBOARD_MAX_TEXT,
): List<String> {
    if (text.isEmpty()) return emptyList()
    val max = limit.coerceIn(2, 1 shl 20)
    val chunks = ArrayList<String>(text.length / max + 1)
    var start = 0
    while (start < text.length) {
        var end = minOf(start + max, text.length)

        // Never split a surrogate pair across messages.
        if (end < text.length &&
            Character.isHighSurrogate(text[end - 1]) &&
            Character.isLowSurrogate(text[end])
        ) {
            end -= 1
        }

        // Prefer a whitespace boundary, but only inside the last quarter of
        // the window so a single early space cannot produce tiny chunks.
        if (end < text.length) {
            val earliestBreak = maxOf(start + 1, end - max / 4)
            for (index in end - 1 downTo earliestBreak) {
                val char = text[index]
                if (char == ' ' || char == '\n' || char == '\t') {
                    end = index + 1
                    break
                }
            }
        }

        if (end <= start) end = minOf(start + max, text.length)
        // Defensive: the fallback above must still not cut a pair.
        if (end < text.length &&
            Character.isHighSurrogate(text[end - 1]) &&
            Character.isLowSurrogate(text[end]) &&
            end - start > 1
        ) {
            end -= 1
        }
        chunks += text.substring(start, end)
        start = end
    }
    return chunks
}
