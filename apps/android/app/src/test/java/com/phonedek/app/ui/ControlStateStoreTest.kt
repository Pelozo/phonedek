package com.phonedek.app.ui

import com.phonedek.app.data.ActionDto
import com.phonedek.app.data.ControlBindingDto
import com.phonedek.app.data.ControlDto
import com.phonedek.app.data.ControlStateEntryDto
import com.phonedek.app.data.DeckButton
import com.phonedek.app.data.DeckPage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ControlStateStoreTest {
    @Test
    fun mergeIgnoresStaleAndEqualRevisions() {
        val current = mapOf(
            "vol" to state("vol", revision = 5, value = 0.5f),
        )

        val equal = ControlStateStore.merge(
            current,
            listOf(state("vol", revision = 5, value = 0.9f)),
        )
        assertSame(current, equal)

        val older = ControlStateStore.merge(
            current,
            listOf(state("vol", revision = 4, value = 0.1f)),
        )
        assertSame(current, older)
    }

    @Test
    fun mergeAcceptsNewerRevisionsAndKeepsOtherControls() {
        val current = mapOf(
            "vol" to state("vol", revision = 5, value = 0.5f),
            "other" to state("other", revision = 1, value = 0.2f),
        )

        val merged = ControlStateStore.merge(
            current,
            listOf(
                state("vol", revision = 6, value = 0.7f),
                state("new", revision = 3, value = 0.3f),
            ),
        )

        assertEquals(0.7f, merged["vol"]!!.value!!, 0.0001f)
        assertEquals(6, merged["vol"]!!.revision)
        assertEquals(0.2f, merged["other"]!!.value!!, 0.0001f)
        assertEquals(0.3f, merged["new"]!!.value!!, 0.0001f)
    }

    @Test
    fun onlyAbsoluteVolumeMicGainAndObsControlsAreWatchable() {
        val page = DeckPage(
            id = "pg1",
            buttons = listOf(
                button("abs-slider"),
                button("abs-wheel", kind = "dial"),
                button("mic", type = "mic", mode = "gain"),
                button("obs", type = "obs", mode = null, target = "inputVolume"),
                button("relative", mode = "relative", emit = "delta"),
                button("scroll", type = "scroll", mode = null, emit = "delta"),
                button("pad", kind = "trackpad", type = "pointer", mode = null, emit = "delta"),
                button("bad-mic-mode", type = "mic", mode = "relative"),
                button("bad-obs-target", type = "obs", mode = null, target = "inputMute"),
                button(
                    "obs-delta",
                    type = "obs",
                    mode = null,
                    target = "inputVolume",
                    emit = "delta",
                ),
                button("plain", control = null),
                button("", control = null),
            ),
        )

        assertEquals(
            listOf("abs-slider", "abs-wheel", "mic", "obs"),
            ControlStateStore.statefulControlIds(page),
        )
    }

    @Test
    fun detectsObsValueControlsAndObsActions() {
        val obs = ControlDto(
            kind = "slider",
            emit = "value",
            binding = ControlBindingDto(type = "obs", target = "inputVolume"),
        )
        assertTrue(ControlStateStore.isObsValueControl(obs))
        assertFalse(ControlStateStore.isObsValueControl(obs.copy(emit = "delta")))
        assertFalse(
            ControlStateStore.isObsValueControl(
                obs.copy(binding = obs.binding.copy(target = "inputMute")),
            ),
        )
        assertFalse(ControlStateStore.isObsValueControl(null))

        assertTrue(
            ControlStateStore.hasObsAction(
                listOf(ActionDto(type = "obs", action = "toggleMute")),
            ),
        )
        assertFalse(
            ControlStateStore.hasObsAction(
                listOf(ActionDto(type = "mic", action = "toggleMute")),
            ),
        )
    }

    @Test
    fun obsDisplayTextUsesDesktopDetailStrings() {
        assertEquals(
            "150%",
            ControlStateStore.displayText(
                localText = "100%",
                statePresent = true,
                stateAvailable = true,
                stateMuted = false,
                stateDetail = "150%",
                interacting = false,
            ),
        )
        assertEquals(
            ControlStateStore.MUTED,
            ControlStateStore.displayText(
                localText = "100%",
                statePresent = true,
                stateAvailable = true,
                stateMuted = true,
                stateDetail = "MUTED",
                interacting = false,
            ),
        )
        // Older/desktop-only state may carry MUTED as detail without the flag.
        assertEquals(
            ControlStateStore.MUTED,
            ControlStateStore.displayText(
                localText = "100%",
                statePresent = true,
                stateAvailable = true,
                stateMuted = false,
                stateDetail = "MUTED",
                interacting = false,
            ),
        )
        assertEquals(
            ControlStateStore.NO_OBS,
            ControlStateStore.displayText(
                localText = "100%",
                statePresent = true,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = "NO OBS",
                interacting = false,
            ),
        )
        assertEquals(
            ControlStateStore.NO_INPUT,
            ControlStateStore.displayText(
                localText = "100%",
                statePresent = true,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = "NO INPUT",
                interacting = false,
            ),
        )
        assertEquals(
            ControlStateStore.SWITCHING,
            ControlStateStore.displayText(
                localText = "100%",
                statePresent = true,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = "SWITCHING",
                interacting = false,
            ),
        )
        // Dragging keeps the local readout even while OBS is unavailable.
        assertEquals(
            "175%",
            ControlStateStore.displayText(
                localText = "175%",
                statePresent = true,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = "NO OBS",
                interacting = true,
            ),
        )
    }

    @Test
    fun micDisplayTextShowsDesktopDetailMuteAndUnavailable() {
        assertEquals(
            "42%",
            ControlStateStore.displayText(
                localText = "50%",
                statePresent = true,
                stateAvailable = true,
                stateMuted = false,
                stateDetail = "42%",
                interacting = false,
            ),
        )
        assertEquals(
            ControlStateStore.MUTED,
            ControlStateStore.displayText(
                localText = "50%",
                statePresent = true,
                stateAvailable = true,
                stateMuted = true,
                stateDetail = null,
                interacting = false,
            ),
        )
        assertEquals(
            ControlStateStore.NO_INPUT,
            ControlStateStore.displayText(
                localText = "50%",
                statePresent = true,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = "Unavailable",
                interacting = false,
            ),
        )
        // The local value remains authoritative while dragging and when there
        // is no state entry at all (old desktop or non-mic control).
        assertEquals(
            "73%",
            ControlStateStore.displayText(
                localText = "73%",
                statePresent = true,
                stateAvailable = true,
                stateMuted = true,
                stateDetail = "MUTED",
                interacting = true,
            ),
        )
        assertEquals(
            "73%",
            ControlStateStore.displayText(
                localText = "73%",
                statePresent = false,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = null,
                interacting = false,
            ),
        )
    }

    @Test
    fun normalizedStateMapsToTheControlRangeAndStep() {
        assertEquals(
            42f,
            ControlStateStore.valueFromNormalized(0.42f, 0f, 100f, 1f),
            0.0001f,
        )
        assertEquals(
            40f,
            ControlStateStore.valueFromNormalized(0.42f, 0f, 100f, 5f),
            0.0001f,
        )
        assertEquals(
            0f,
            ControlStateStore.valueFromNormalized(-1f, 0f, 100f, 1f),
            0.0001f,
        )
        assertEquals(
            1f,
            ControlStateStore.valueFromNormalized(2f, 0f, 1f, 0.1f),
            0.0001f,
        )
        // OBS uses a 0..200 % range; 100 % is unity, not the midpoint.
        assertEquals(
            150f,
            ControlStateStore.valueFromNormalized(0.75f, 0f, 200f, 1f),
            0.0001f,
        )
        assertEquals(
            100f,
            ControlStateStore.valueFromNormalized(0.5f, 0f, 200f, 1f),
            0.0001f,
        )
    }

    @Test
    fun snappingClampsAndGuardsInvalidSteps() {
        assertEquals(
            100f,
            ControlStateStore.snapControlValue(180f, 0f, 100f, 1f),
            0.0001f,
        )
        assertEquals(
            200f,
            ControlStateStore.snapControlValue(280f, 0f, 200f, 1f),
            0.0001f,
        )
        assertEquals(
            13.4f,
            ControlStateStore.snapControlValue(13.4f, 0f, 100f, 0f),
            0.0001f,
        )
        assertTrue(ControlStateStore.statefulControlIds(DeckPage()).isEmpty())
    }

    private fun state(
        id: String,
        revision: Int,
        value: Float? = null,
        available: Boolean = true,
    ) = ControlStateEntryDto(
        controlId = id,
        revision = revision,
        value = value,
        muted = false,
        available = available,
        detail = value?.let { "${(it * 100).toInt()}%" },
    )

    private fun button(
        id: String,
        kind: String = "slider",
        type: String = "volume",
        mode: String? = "absolute",
        target: String? = null,
        emit: String = "value",
        control: ControlDto? = ControlDto(
            kind = kind,
            emit = emit,
            binding = ControlBindingDto(type = type, mode = mode, target = target),
        ),
    ) = DeckButton(id = id, control = control)
}
