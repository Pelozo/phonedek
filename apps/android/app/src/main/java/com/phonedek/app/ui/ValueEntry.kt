package com.phonedek.app.ui

import com.phonedek.app.data.ControlDto
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Pure parsing and formatting for the exact-value plate (B7).
 *
 * The plate is only offered for absolute controls: relative volume/scroll
 * controls keep their delta semantics and have nothing exact to type.
 */
object ValueEntry {
    /** Result of parsing one text field entry. */
    data class Parsed(
        /** Clamped and snapped value, or null when the entry cannot be used. */
        val value: Float?,
        /** The number the user typed before clamping/snapping, when finite. */
        val requested: Float? = null,
        /** True for a non-empty entry that is not a number. */
        val invalid: Boolean = false,
    ) {
        val canSet: Boolean get() = value != null

        /** True when clamping or snapping will change the typed value. */
        val adjusts: Boolean
            get() {
                val final = value ?: return false
                val typed = requested ?: return false
                return abs(final - typed) > 0.0005f
            }
    }

    /** Numeric entry applies to any absolute slider/dial, never a trackpad or key wheel. */
    fun supports(control: ControlDto?): Boolean =
        control != null &&
            control.kind != "trackpad" &&
            control.binding.type != "shortcut" &&
            control.emit == "value"

    /**
     * Parses a typed value, then clamps it to [minValue]..[maxValue] and snaps
     * it to [step]. An empty field is "not ready" (Set stays disabled) rather
     * than an error; non-numeric text is an explicit error.
     */
    fun parse(
        text: String,
        minValue: Float,
        maxValue: Float,
        step: Float,
    ): Parsed {
        val cleaned = text.trim()
            .removeSuffix("%")
            .trim()
            .replace(',', '.')
        if (cleaned.isEmpty()) return Parsed(null)
        val raw = cleaned.toFloatOrNull()
            ?: return Parsed(null, invalid = true)
        if (!raw.isFinite()) return Parsed(null, invalid = true)
        return Parsed(
            value = ControlStateStore.snapControlValue(raw, minValue, maxValue, step),
            requested = raw,
        )
    }

    /** Readout text such as `42%` or `250 mired` (word units take a space). */
    fun formatValue(value: Float, unit: String): String {
        val number = formatNumber(value)
        val separator = if (unit.isNotEmpty() && unit.first().isLetter()) " " else ""
        return number + separator + unit
    }

    /** Range line such as `0–100 %` or `0–200 %`. */
    fun rangeText(minValue: Float, maxValue: Float, unit: String): String {
        val range = "${formatNumber(minValue)}–${formatNumber(maxValue)}"
        return if (unit.isBlank()) range else "$range $unit"
    }

    /** Compact number for fields and readouts; at most two decimals. */
    fun formatNumber(value: Float): String {
        if (!value.isFinite()) return "0"
        val rounded = value.roundToInt()
        if (abs(value - rounded) < 0.0005f) return rounded.toString()
        val tenths = (value * 10f).roundToInt()
        if (abs(value * 10f - tenths) < 0.005f) {
            return String.format(Locale.US, "%.1f", value)
        }
        return String.format(Locale.US, "%.2f", value)
            .trimEnd('0')
            .trimEnd('.')
    }
}
