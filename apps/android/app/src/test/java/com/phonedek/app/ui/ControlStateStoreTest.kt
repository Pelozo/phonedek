package com.phonedek.app.ui

import com.phonedek.app.data.ControlBindingDto
import com.phonedek.app.data.ControlDto
import com.phonedek.app.data.ControlStateEntryDto
import com.phonedek.app.data.DeckButton
import com.phonedek.app.data.DeckPage
import org.junit.Assert.assertEquals
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
    fun onlyAbsoluteVolumeControlsAreWatchable() {
        val page = DeckPage(
            id = "pg1",
            buttons = listOf(
                button("abs-slider"),
                button("abs-wheel", kind = "dial"),
                button("relative", mode = "relative", emit = "delta"),
                button("scroll", type = "scroll", mode = null, emit = "delta"),
                button("pad", kind = "trackpad", type = "pointer", mode = null, emit = "delta"),
                button("plain", control = null),
                button("", control = null),
            ),
        )

        assertEquals(
            listOf("abs-slider", "abs-wheel"),
            ControlStateStore.absoluteVolumeControlIds(page),
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
    }

    @Test
    fun snappingClampsAndGuardsInvalidSteps() {
        assertEquals(
            100f,
            ControlStateStore.snapControlValue(180f, 0f, 100f, 1f),
            0.0001f,
        )
        assertEquals(
            13.4f,
            ControlStateStore.snapControlValue(13.4f, 0f, 100f, 0f),
            0.0001f,
        )
        assertTrue(ControlStateStore.absoluteVolumeControlIds(DeckPage()).isEmpty())
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
        emit: String = "value",
        control: ControlDto? = ControlDto(
            kind = kind,
            emit = emit,
            binding = ControlBindingDto(type = type, mode = mode),
        ),
    ) = DeckButton(id = id, control = control)
}
