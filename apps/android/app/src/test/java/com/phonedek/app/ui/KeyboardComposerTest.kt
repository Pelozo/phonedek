package com.phonedek.app.ui

import com.phonedek.app.data.ActionDto
import com.phonedek.app.data.DeckButton
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KeyboardComposerTest {
    private val launcher = DeckButton(
        id = "btn-kbd",
        label = "Keyboard",
        actions = listOf(ActionDto(type = "keyboard", action = "open")),
    )

    @Test
    fun plainButtonIsNotAKeyboardLauncher() {
        val button = DeckButton(id = "btn", actions = listOf(ActionDto(type = "hotkey")))
        assertEquals(
            KeyboardLaunch.NotLauncher,
            keyboardLaunch(button, "p1", "pg1", capable = true, connected = true),
        )
        assertFalse(hasKeyboardAction(button))
    }

    @Test
    fun missingCapabilityGatesThePanel() {
        assertEquals(
            KeyboardLaunch.Unsupported,
            keyboardLaunch(launcher, "p1", "pg1", capable = false, connected = true),
        )
    }

    @Test
    fun offlineDeckDoesNotOpenThePanel() {
        assertEquals(
            KeyboardLaunch.Offline,
            keyboardLaunch(launcher, "p1", "pg1", capable = true, connected = false),
        )
        assertEquals(
            KeyboardLaunch.Offline,
            keyboardLaunch(launcher, null, "pg1", capable = true, connected = true),
        )
    }

    @Test
    fun capableConnectedLauncherOpensWithIds() {
        val launch = keyboardLaunch(launcher, "p1", "pg1", capable = true, connected = true)
        assertTrue(launch is KeyboardLaunch.Open)
        launch as KeyboardLaunch.Open
        assertEquals("p1", launch.profileId)
        assertEquals("pg1", launch.pageId)
        assertEquals("btn-kbd", launch.controlId)
        assertEquals("Keyboard", launch.label)
    }

    @Test
    fun closeSendsReleaseThenEndOrCancel() {
        assertEquals(listOf("release", "end"), keyboardClosePhases(cancel = false))
        assertEquals(listOf("cancel"), keyboardClosePhases(cancel = true))
    }

    @Test
    fun compositionBlocksTheLineCommit() {
        assertNull(planLineSend("拼", composing = true))
        assertNull("blank text is not a send", planLineSend("", composing = false))
        val plan = planLineSend("hello", composing = false)
        assertNotNull(plan)
        assertEquals("hello", plan!!.text)
        assertFalse(plan.enter)

        val auto = planLineSend("hello", composing = false, autoEnter = true)
        assertTrue(auto!!.enter)
    }

    @Test
    fun shortTextIsOneChunk() {
        assertEquals(listOf("hello"), chunkKeyboardText("hello"))
        assertEquals(emptyList<String>(), chunkKeyboardText(""))
    }

    @Test
    fun chunksRespectTheLimitAndReassembleExactly() {
        val text = buildString {
            repeat(1_200) { index -> append("word$index ") }
        }
        val chunks = chunkKeyboardText(text, limit = 4096)

        assertTrue(chunks.size > 1)
        chunks.forEach { chunk ->
            assertTrue("chunk ${chunk.length} exceeds the limit", chunk.length <= 4096)
            assertFalse(
                "chunk ends on a high surrogate",
                chunk.isNotEmpty() && Character.isHighSurrogate(chunk.last()),
            )
        }
        assertEquals(text, chunks.joinToString(""))
    }

    @Test
    fun chunkBoundaryPrefersWhitespace() {
        val text = "a".repeat(4000) + " " + "b".repeat(100)
        val chunks = chunkKeyboardText(text, limit = 4096)
        assertEquals(2, chunks.size)
        assertEquals(4001, chunks[0].length)
        assertTrue(chunks[0].endsWith(" "))
        assertEquals("b".repeat(100), chunks[1])
    }

    @Test
    fun surrogatePairsAreNeverSplit() {
        val emoji = "\uD83D\uDE00"
        val text = "a".repeat(4095) + emoji + "tail"
        val chunks = chunkKeyboardText(text, limit = 4096)

        assertEquals(text, chunks.joinToString(""))
        chunks.forEach { chunk ->
            assertFalse(
                "chunk ends on a high surrogate",
                Character.isHighSurrogate(chunk.last()),
            )
            assertFalse(
                "chunk starts on a low surrogate",
                Character.isLowSurrogate(chunk.first()),
            )
            assertTrue(chunk.length <= 4096)
        }
        assertEquals(4095, chunks[0].length)
    }

    @Test
    fun modifierTapArmsOneChordAndClearsAfterTheKey() {
        var modifiers = KeyboardModifierState()
        modifiers = modifiers.tap("CTRL")
        assertTrue(modifiers.isActive("CTRL"))
        assertEquals(listOf("CTRL", "C"), modifiers.chordFor("C"))

        modifiers = modifiers.afterKey()
        assertFalse(modifiers.isActive("CTRL"))
        assertEquals(listOf("C"), modifiers.chordFor("C"))
    }

    @Test
    fun modifiersAreOrderedAndDeduplicated() {
        val modifiers = KeyboardModifierState()
            .tap("SHIFT")
            .tap("CTRL")
            .tap("ALT")

        assertEquals(listOf("CTRL", "ALT", "SHIFT", "TAB"), modifiers.chordFor("TAB"))
    }

    @Test
    fun tappingAnArmedModifierDisarmsIt() {
        val modifiers = KeyboardModifierState().tap("ALT").tap("ALT")
        assertFalse(modifiers.hasActive())
    }

    @Test
    fun lockedModifierSurvivesChordsUntilToggled() {
        var modifiers = KeyboardModifierState().longPress("CTRL")
        assertTrue(modifiers.isActive("CTRL"))

        modifiers = modifiers.afterKey()
        assertTrue("locked modifier stays armed", modifiers.isActive("CTRL"))
        assertEquals(listOf("CTRL", "TAB"), modifiers.chordFor("TAB"))

        modifiers = modifiers.longPress("CTRL")
        modifiers = modifiers.afterKey()
        assertFalse(modifiers.isActive("CTRL"))
    }

    @Test
    fun chordIsCappedAtEightKeys() {
        val modifiers = KeyboardModifierState()
            .tap("CTRL")
            .tap("ALT")
            .tap("SHIFT")
            .tap("WIN")
        val chord = modifiers.chordFor("A")
        assertTrue(chord.size <= KEYBOARD_MAX_KEYS)
        assertEquals(listOf("CTRL", "ALT", "SHIFT", "WIN", "A"), chord)
    }

    @Test
    fun clearDropsArmedAndLockedModifiers() {
        val modifiers = KeyboardModifierState()
            .tap("ALT")
            .longPress("SHIFT")
            .clear()
        assertFalse(modifiers.hasActive())
    }
}
