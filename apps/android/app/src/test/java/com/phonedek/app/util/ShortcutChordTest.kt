package com.phonedek.app.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShortcutChordTest {
    @Test
    fun modifiersUseCompactGlyphs() {
        assertEquals("⌃", ShortcutChord.format(listOf("CTRL")))
        assertEquals("⇧", ShortcutChord.format(listOf("SHIFT")))
        assertEquals("⌥", ShortcutChord.format(listOf("ALT")))
        assertEquals("⌘", ShortcutChord.format(listOf("WIN")))
        // Aliases from the desktop recorder normalize to the same glyphs.
        assertEquals("⌃", ShortcutChord.format(listOf("CONTROL")))
        assertEquals("⌥", ShortcutChord.format(listOf("OPTION")))
        assertEquals("⌘", ShortcutChord.format(listOf("CMD")))
    }

    @Test
    fun tabAndArrowsUseCompactGlyphs() {
        assertEquals("⌃⇥", ShortcutChord.format(listOf("CTRL", "TAB")))
        assertEquals("⌘⇥", ShortcutChord.format(listOf("WIN", "TAB")))
        assertEquals("⌘←", ShortcutChord.format(listOf("WIN", "LEFT")))
        assertEquals("⌃↑", ShortcutChord.format(listOf("CTRL", "UP")))
        assertEquals("⌃↓", ShortcutChord.format(listOf("CTRL", "DOWN")))
        assertEquals("⌃→", ShortcutChord.format(listOf("CTRL", "RIGHT")))
        assertEquals("⌥⇥", ShortcutChord.format(listOf("ALT", "TAB")))
    }

    @Test
    fun namedKeysUseTheirSymbols() {
        assertEquals("↵", ShortcutChord.format(listOf("ENTER")))
        assertEquals("⎋", ShortcutChord.format(listOf("ESC")))
        assertEquals("␣", ShortcutChord.format(listOf("SPACE")))
        assertEquals("⌫", ShortcutChord.format(listOf("BACKSPACE")))
        assertEquals("⌦", ShortcutChord.format(listOf("DELETE")))
        assertEquals("⌃⌫", ShortcutChord.format(listOf("CTRL", "BACKSPACE")))
    }

    @Test
    fun punctuationAndUnmappedKeysFallBackToUppercaseNames() {
        assertEquals("[", ShortcutChord.format(listOf("[")))
        assertEquals("⌃[", ShortcutChord.format(listOf("CTRL", "BRACKETLEFT")))
        assertEquals("A", ShortcutChord.format(listOf("a")))
        assertEquals("F13", ShortcutChord.format(listOf("f13")))
        assertEquals("NUMPAD7", ShortcutChord.format(listOf("numpad7")))
        assertEquals("⌃F5", ShortcutChord.format(listOf("ctrl", "f5")))
    }

    @Test
    fun holdIndicatorIsPrefixedWithPlusAndUsesNames() {
        assertEquals("", ShortcutChord.holdIndicator(null))
        assertEquals("", ShortcutChord.holdIndicator(emptyList()))
        assertEquals("+ALT", ShortcutChord.holdIndicator(listOf("ALT")))
        assertEquals("+CTRL+ALT", ShortcutChord.holdIndicator(listOf("CTRL", "OPTION")))
        assertEquals("⌃⇥ +ALT", ShortcutChord.badge(listOf("CTRL", "TAB"), listOf("ALT")))
        assertEquals("⌃⇥", ShortcutChord.badge(listOf("CTRL", "TAB")))
    }

    @Test
    fun normalizeOrdersModifiersDedupesAndRejectsUnknownNames() {
        assertEquals(
            listOf("CTRL", "SHIFT", "TAB"),
            ShortcutChord.normalizeKeys(listOf("TAB", "shift", "control")),
        )
        assertEquals(
            listOf("CTRL", "TAB"),
            ShortcutChord.normalizeKeys(listOf("CTRL", "TAB", "ctrl")),
        )
        assertEquals(
            listOf("CTRL", "ALT", "SHIFT", "WIN", "DELETE"),
            ShortcutChord.normalizeKeys(listOf("DELETE", "WIN", "SHIFT", "ALT", "CTRL")),
        )
        assertEquals(listOf("[", "A"), ShortcutChord.normalizeKeys(listOf("[", "a")))
        assertNull(ShortcutChord.normalizeKeys(emptyList()))
        assertNull(ShortcutChord.normalizeKeys(listOf("CTRL", "BOGUS")))
        assertNull(ShortcutChord.normalizeKeys(listOf("CTRL", "")))
        // The desktop schema caps a chord at 8 keys.
        assertNull(
            ShortcutChord.normalizeKeys(
                listOf("CTRL", "ALT", "SHIFT", "A", "B", "C", "D", "E", "F"),
            ),
        )
        assertTrue(
            ShortcutChord.normalizeKeys(listOf("CTRL", "ALT", "SHIFT", "A", "B", "C", "D", "E"))!!
                .isNotEmpty(),
        )
    }
}
