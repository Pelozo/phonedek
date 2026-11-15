package com.phonedek.app.ui

import com.phonedek.app.data.RigProgressDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class RigProgressTest {
    @Test
    fun startStepAndDoneTrackTheLatestRun() {
        var state = RigProgressStore.apply(
            RigProgressState(),
            frame("start", index = 0, total = 3, buttonId = "btn-run"),
            1_000L,
        )
        assertEquals("0/3", state.forTile("btn-run", "rig-1")?.chipText())
        assertTrue(state.forTile("btn-run", "rig-1")!!.isActive)

        state = RigProgressStore.apply(state, frame("step", index = 1, total = 3), 2_000L)
        assertEquals("1/3", state.forTile("btn-run", "rig-1")?.chipText())

        state = RigProgressStore.apply(state, frame("step", index = 2, total = 3), 3_000L)
        assertEquals("2/3", state.forTile("btn-run", "rig-1")?.chipText())

        state = RigProgressStore.apply(
            state,
            frame("done", index = 3, total = 3, status = "partial", ok = false),
            4_000L,
        )
        val done = state.forTile("btn-run", "rig-1")!!
        assertFalse(done.isActive)
        assertEquals("PARTIAL", done.chipText())
        assertEquals(1_000L, done.startedAtMillis)
        assertEquals(4_000L, done.doneAtMillis)
    }

    @Test
    fun duplicateAndOutOfOrderStepsAreIgnored() {
        var state = RigProgressStore.apply(
            RigProgressState(),
            frame("start", index = 0, total = 9),
            1_000L,
        )
        state = RigProgressStore.apply(state, frame("step", index = 4, total = 9), 2_000L)

        val duplicate = RigProgressStore.apply(
            state,
            frame("step", index = 4, total = 9),
            3_000L,
        )
        assertSame(state, duplicate)

        val older = RigProgressStore.apply(
            state,
            frame("step", index = 2, total = 9),
            4_000L,
        )
        assertSame(state, older)
        assertEquals(4, state.byPreset.getValue("rig-1").index)

        // A late step after `done` never revives the run.
        state = RigProgressStore.apply(
            state,
            frame("done", index = 9, total = 9, status = "ok", ok = true),
            5_000L,
        )
        val afterDone = RigProgressStore.apply(
            state,
            frame("step", index = 7, total = 9),
            6_000L,
        )
        assertSame(state, afterDone)
        assertFalse(state.byPreset.getValue("rig-1").isActive)
    }

    @Test
    fun aDuplicateDoneDoesNotExtendTheHold() {
        val done = frame("done", index = 3, total = 3, status = "ok", ok = true)
        val once = RigProgressStore.apply(RigProgressState(), done, 1_000L)
        val twice = RigProgressStore.apply(once, done, 2_000L)
        assertSame(once, twice)
        assertEquals(1_000L, twice.byPreset.getValue("rig-1").doneAtMillis)
    }

    @Test
    fun doneChipClearsAfterTheShortHold() {
        val done = RigProgressStore.apply(
            RigProgressState(),
            frame("done", index = 3, total = 3, status = "ok", ok = true),
            10_000L,
        )
        val stillVisible = RigProgressStore.prune(
            done,
            10_000L + RigProgressStore.DONE_HOLD_MS - 1,
        )
        assertSame(done, stillVisible)

        val cleared = RigProgressStore.prune(
            done,
            10_000L + RigProgressStore.DONE_HOLD_MS,
        )
        assertTrue(cleared.byPreset.isEmpty())
        assertTrue(cleared.byButton.isEmpty())
        assertNull(cleared.forTile("btn-run", "rig-1"))
    }

    @Test
    fun reconnectAndPageSwitchDropEveryRun() {
        val state = RigProgressStore.apply(
            RigProgressState(),
            frame("start", index = 0, total = 2, buttonId = "btn-run"),
            1_000L,
        )
        assertTrue(state.byPreset.isNotEmpty())

        val cleared = RigProgressStore.clear()
        assertTrue(cleared.byPreset.isEmpty())
        assertTrue(cleared.byButton.isEmpty())
        assertNull(cleared.forTile("btn-run", "rig-1"))
    }

    @Test
    fun latestRunWinsAcrossButtonsForTheSamePreset() {
        var state = RigProgressStore.apply(
            RigProgressState(),
            frame("start", index = 0, total = 4, buttonId = "btn-a"),
            1_000L,
        )
        state = RigProgressStore.apply(
            state,
            frame("step", index = 1, total = 4),
            2_000L,
        )
        state = RigProgressStore.apply(
            state,
            frame("start", index = 0, total = 4, buttonId = "btn-b"),
            3_000L,
        )

        assertNull(state.byButton["btn-a"])
        assertEquals("0/4", state.forTile("btn-b", "rig-1")?.chipText())
        // A tile bound to the same preset but a different button still sees it.
        assertEquals("0/4", state.forTile("btn-other", "rig-1")?.chipText())
        assertEquals(3_000L, state.byPreset.getValue("rig-1").startedAtMillis)
    }

    @Test
    fun clearPresetRemovesOnlyThatRig() {
        var state = RigProgressStore.apply(
            RigProgressState(),
            frame("start", index = 0, total = 2, presetId = "rig-1", buttonId = "btn-a"),
            1_000L,
        )
        state = RigProgressStore.apply(
            state,
            frame("start", index = 0, total = 2, presetId = "rig-2", buttonId = "btn-b"),
            2_000L,
        )

        val cleared = RigProgressStore.clearPreset(state, "rig-1")
        assertNull(cleared.forTile("btn-a", "rig-1"))
        assertEquals("0/2", cleared.forTile("btn-b", "rig-2")?.chipText())
    }

    private fun frame(
        phase: String,
        index: Int,
        total: Int,
        presetId: String = "rig-1",
        buttonId: String? = null,
        status: String? = null,
        ok: Boolean? = null,
    ) = RigProgressDto(
        presetId = presetId,
        buttonId = buttonId,
        phase = phase,
        index = index,
        total = total,
        status = status,
        ok = ok,
    )
}
