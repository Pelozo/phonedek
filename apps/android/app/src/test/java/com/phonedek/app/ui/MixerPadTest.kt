package com.phonedek.app.ui

import com.phonedek.app.data.ActionDto
import com.phonedek.app.data.DeckButton
import com.phonedek.app.net.MixerSessionPayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MixerPadTest {
    private val launcher = DeckButton(
        id = "btn-mix",
        label = "Mixer",
        actions = listOf(ActionDto(type = "mixer", action = "open")),
    )

    @Test
    fun plainButtonIsNotAMixerLauncher() {
        val button = DeckButton(id = "btn", actions = listOf(ActionDto(type = "hotkey")))
        assertFalse(hasMixerAction(button))
        assertEquals(
            MixerLaunch.NotLauncher,
            mixerLaunch(button, capable = true, connected = true),
        )
    }

    @Test
    fun onlyTheMixerOpenActionIsALauncher() {
        assertTrue(hasMixerAction(launcher))
        assertTrue(
            "an older config may omit the explicit action name",
            hasMixerAction(DeckButton(id = "b", actions = listOf(ActionDto(type = "mixer")))),
        )
        assertFalse(
            "a different mixer action is not the panel launcher",
            hasMixerAction(
                DeckButton(id = "b", actions = listOf(ActionDto(type = "mixer", action = "other"))),
            ),
        )
    }

    @Test
    fun actionInterceptionOpensWithoutSendingAPress() {
        // onButtonPressed takes this branch before any press payload is built.
        assertEquals(
            MixerLaunch.Open,
            mixerLaunch(launcher, capable = true, connected = true),
        )
    }

    @Test
    fun missingCapabilityGatesThePanel() {
        assertEquals(
            MixerLaunch.Unsupported,
            mixerLaunch(launcher, capable = false, connected = true),
        )
    }

    @Test
    fun offlineDeckDoesNotOpenThePanel() {
        assertEquals(
            MixerLaunch.Offline,
            mixerLaunch(launcher, capable = true, connected = false),
        )
    }

    @Test
    fun keyboardLauncherIsNotAMixerLauncher() {
        val keyboard = DeckButton(
            id = "btn-kbd",
            actions = listOf(ActionDto(type = "keyboard", action = "open")),
        )
        assertFalse(hasMixerAction(keyboard))
        assertEquals(
            MixerLaunch.NotLauncher,
            mixerLaunch(keyboard, capable = true, connected = true),
        )
    }

    @Test
    fun sessionsSortByNameProcessThenId() {
        val sessions = listOf(
            session(id = "s3", process = "z.exe", name = "Zeta"),
            session(id = "s1", process = "b.exe", name = "alpha"),
            session(id = "s2", process = "a.exe", name = "Alpha"),
            session(id = "s4", process = "m.exe", name = "beta"),
        )

        assertEquals(
            listOf("s2", "s1", "s4", "s3"),
            sortedMixerSessions(sessions).map { it.id },
        )
        // Sorting never mutates or drops the desktop snapshot.
        assertEquals(listOf("s3", "s1", "s2", "s4"), sessions.map { it.id })
    }

    @Test
    fun identicalNamesFallBackToTheOpaqueId() {
        val sessions = listOf(
            session(id = "b", process = "same.exe", name = "Same"),
            session(id = "a", process = "same.exe", name = "Same"),
            session(id = "c", process = "same.exe", name = "Same"),
        )
        assertEquals(
            listOf("a", "b", "c"),
            sortedMixerSessions(sessions).map { it.id },
        )
    }

    @Test
    fun faderFirstMoveSendsImmediately() {
        val throttle = MixerFaderThrottle()
        assertEquals(40, throttle.onMove(40, now = 1_000L))
        assertEquals(0L, throttle.waitMs(1_000L))
    }

    @Test
    fun faderCoalescesInsideTheIntervalAndKeepsTheLatestValue() {
        val throttle = MixerFaderThrottle()
        assertEquals(10, throttle.onMove(10, now = 0L))

        assertNull(throttle.onMove(20, now = 10L))
        assertNull(throttle.onMove(30, now = 20L))
        assertEquals(40L, throttle.waitMs(now = 10L))
        assertEquals(25L, throttle.waitMs(now = 25L))
        assertEquals(30, throttle.flush(25L))

        // The next move 35 ms after the flush waits the remaining 15 ms.
        assertNull(throttle.onMove(60, now = 60L))
        assertEquals(15L, throttle.waitMs(60L))
    }

    @Test
    fun faderSendsTheCurrentValueWhenTheIntervalElapses() {
        val throttle = MixerFaderThrottle()
        assertEquals(25, throttle.onMove(25, now = 100L))
        assertNull(throttle.onMove(26, now = 120L))
        // Boundary: 50 ms after the first send the newest value wins.
        assertEquals(27, throttle.onMove(27, now = 150L))
    }

    @Test
    fun faderCommitAlwaysSendsTheReleaseValue() {
        val throttle = MixerFaderThrottle()
        throttle.onMove(10, now = 0L)
        throttle.onMove(55, now = 10L)

        assertEquals(55, throttle.commit(55, now = 12L))
        assertNull("commit clears the pending write", throttle.flush(13L))
        assertEquals(0L, throttle.waitMs(13L))

        // After a commit the next move inside the interval still waits...
        assertNull(throttle.onMove(56, now = 20L))
        // ...and the first move after it sends the latest value.
        assertEquals(57, throttle.onMove(57, now = 70L))
    }

    @Test
    fun faderClampsAndResets() {
        val throttle = MixerFaderThrottle()
        assertEquals(0, throttle.onMove(-30, now = 0L))
        assertEquals(100, throttle.onMove(160, now = 100L))

        throttle.onMove(70, now = 110L)
        throttle.reset()
        assertEquals(42, throttle.onMove(42, now = 120L))
    }

    private fun session(id: String, process: String, name: String) = MixerSessionPayload(
        id = id,
        process = process,
        name = name,
        volume = 50,
        muted = false,
    )
}
