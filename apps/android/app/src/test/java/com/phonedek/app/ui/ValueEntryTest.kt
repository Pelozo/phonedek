package com.phonedek.app.ui

import com.phonedek.app.data.ControlBindingDto
import com.phonedek.app.data.ControlDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ValueEntryTest {
    @Test
    fun onlyAbsoluteSlidersAndDialsSupportEntry() {
        assertTrue(ValueEntry.supports(absolute(kind = "slider")))
        assertTrue(ValueEntry.supports(absolute(kind = "dial")))
        // Relative volume/scroll must keep delta semantics.
        assertFalse(ValueEntry.supports(absolute(kind = "slider").copy(emit = "delta")))
        assertFalse(ValueEntry.supports(absolute(kind = "dial").copy(emit = "delta")))
        assertFalse(
            ValueEntry.supports(
                ControlDto(kind = "trackpad", emit = "value"),
            ),
        )
        // Key wheels are delta-only and never open exact value entry.
        assertFalse(
            ValueEntry.supports(
                ControlDto(
                    kind = "slider",
                    emit = "delta",
                    binding = ControlBindingDto(
                        type = "shortcut",
                        keys = listOf("CTRL", "TAB"),
                    ),
                ),
            ),
        )
        assertFalse(
            ValueEntry.supports(
                ControlDto(
                    kind = "dial",
                    emit = "delta",
                    binding = ControlBindingDto(
                        type = "shortcut",
                        keys = listOf("WIN", "TAB"),
                    ),
                ),
            ),
        )
        // A media scrub shows time, not a typed normalized value.
        assertFalse(
            ValueEntry.supports(
                ControlDto(
                    kind = "slider",
                    emit = "value",
                    binding = ControlBindingDto(type = "media", target = "position"),
                ),
            ),
        )
        assertFalse(ValueEntry.supports(null))
    }

    @Test
    fun validEntryIsUsedAsIs() {
        val parsed = ValueEntry.parse("42", minValue = 0f, maxValue = 100f, step = 1f)

        assertEquals(42f, parsed.value!!, 0.0001f)
        assertEquals(42f, parsed.requested!!, 0.0001f)
        assertTrue(parsed.canSet)
        assertFalse(parsed.invalid)
        assertFalse(parsed.adjusts)
    }

    @Test
    fun belowMinIsClamped() {
        val parsed = ValueEntry.parse("-5", minValue = 0f, maxValue = 100f, step = 1f)

        assertEquals(0f, parsed.value!!, 0.0001f)
        assertTrue(parsed.adjusts)
    }

    @Test
    fun aboveMaxIsClampedIncludingTheObsRange() {
        val volume = ValueEntry.parse("150", minValue = 0f, maxValue = 100f, step = 1f)
        val obs = ValueEntry.parse("250", minValue = 0f, maxValue = 200f, step = 1f)

        assertEquals(100f, volume.value!!, 0.0001f)
        assertEquals(200f, obs.value!!, 0.0001f)
        assertTrue(volume.adjusts)
        assertTrue(obs.adjusts)
    }

    @Test
    fun entrySnapsToTheControlStep() {
        assertEquals(
            40f,
            ValueEntry.parse("42", 0f, 100f, 5f).value!!,
            0.0001f,
        )
        assertEquals(
            45f,
            ValueEntry.parse("43", 0f, 100f, 5f).value!!,
            0.0001f,
        )
        assertEquals(
            37.5f,
            ValueEntry.parse("37.5", 0f, 100f, 0.5f).value!!,
            0.0001f,
        )
    }

    @Test
    fun percentSuffixAndCommaDecimalAreAccepted() {
        val parsed = ValueEntry.parse("37,5 %", 0f, 100f, 0.5f)

        assertEquals(37.5f, parsed.value!!, 0.0001f)
        assertFalse(parsed.invalid)
    }

    @Test
    fun nonNumericTextIsInvalidAndDisablesSet() {
        listOf("abc", "1.2.3", "5x", "NaN", "Infinity").forEach { text ->
            val parsed = ValueEntry.parse(text, 0f, 100f, 1f)
            assertNull("expected null for '$text'", parsed.value)
            assertTrue("expected invalid for '$text'", parsed.invalid)
            assertFalse(parsed.canSet)
        }
    }

    @Test
    fun emptyOrWhitespaceOnlyDisablesSetWithoutAnError() {
        listOf("", "   ").forEach { text ->
            val parsed = ValueEntry.parse(text, 0f, 100f, 1f)
            assertNull(parsed.value)
            assertFalse(parsed.invalid)
            assertFalse(parsed.canSet)
        }
    }

    @Test
    fun invalidStepFallsBackToClampingOnly() {
        val parsed = ValueEntry.parse("42.3", 0f, 100f, step = 0f)

        assertEquals(42.3f, parsed.value!!, 0.0001f)
    }

    @Test
    fun lightTemperatureEntryClampsToTheMiredRange() {
        // Elgato white balance: 143 (coolest) .. 344 (warmest), step 1.
        assertEquals(250f, ValueEntry.parse("250", 143f, 344f, 1f).value!!, 0.0001f)
        assertEquals(143f, ValueEntry.parse("100", 143f, 344f, 1f).value!!, 0.0001f)
        assertEquals(344f, ValueEntry.parse("999", 143f, 344f, 1f).value!!, 0.0001f)
        assertEquals(143f, ValueEntry.parse("-20", 143f, 344f, 1f).value!!, 0.0001f)
        assertEquals(344f, ValueEntry.parse("344.4", 143f, 344f, 1f).value!!, 0.0001f)
        val below = ValueEntry.parse("100", 143f, 344f, 1f)
        val above = ValueEntry.parse("999", 143f, 344f, 1f)
        assertTrue(below.adjusts)
        assertTrue(above.adjusts)
    }

    @Test
    fun lightPowerEntrySnapsToOffOrOn() {
        assertEquals(0f, ValueEntry.parse("49", 0f, 100f, 100f).value!!, 0.0001f)
        assertEquals(100f, ValueEntry.parse("50", 0f, 100f, 100f).value!!, 0.0001f)
        assertEquals(100f, ValueEntry.parse("100", 0f, 100f, 100f).value!!, 0.0001f)
    }

    @Test
    fun rangeTextShowsRangeAndUnit() {
        assertEquals("0–100 %", ValueEntry.rangeText(0f, 100f, "%"))
        assertEquals("0–200 %", ValueEntry.rangeText(0f, 200f, "%"))
        assertEquals("143–344 mired", ValueEntry.rangeText(143f, 344f, "mired"))
        assertEquals("0–1", ValueEntry.rangeText(0f, 1f, ""))
    }

    @Test
    fun numbersFormatCompactlyForTheReadoutAndField() {
        assertEquals("42", ValueEntry.formatNumber(42f))
        assertEquals("42.5", ValueEntry.formatNumber(42.5f))
        assertEquals("42.25", ValueEntry.formatNumber(42.25f))
        assertEquals("42%", ValueEntry.formatValue(42f, "%"))
        assertEquals("42.5%", ValueEntry.formatValue(42.5f, "%"))
        assertEquals("250 mired", ValueEntry.formatValue(250f, "mired"))
    }

    private fun absolute(kind: String) = ControlDto(
        kind = kind,
        emit = "value",
        binding = ControlBindingDto(type = "volume", mode = "absolute"),
    )
}
