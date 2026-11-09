package com.phonedek.app.ui

import com.phonedek.app.data.ControlStateDto
import com.phonedek.app.data.DeckPage
import kotlin.math.roundToInt

/**
 * Pure helpers for live control state. The ViewModel owns the subscription
 * lifecycle; this file only decides which controls are watchable and how a
 * revisioned batch is merged.
 */
object ControlStateStore {
    /**
     * Absolute volume is the only subscribable producer in the MVP. Relative
     * volume and scroll stay open-loop, and a trackpad is never a value.
     */
    fun absoluteVolumeControlIds(page: DeckPage): List<String> =
        page.buttons
            .asSequence()
            .filter { button ->
                val control = button.control ?: return@filter false
                control.kind != "trackpad" &&
                    control.emit == "value" &&
                    control.binding.type == "volume" &&
                    control.binding.mode == "absolute"
            }
            .map { it.id }
            .filter { it.isNotBlank() }
            .distinct()
            .take(32)
            .toList()

    /**
     * Merges a new batch into the current map, ignoring stale revisions
     * (including equal ones). The stored state always moves forward.
     */
    fun merge(
        current: Map<String, ControlStateDto>,
        incoming: Collection<ControlStateDto>,
    ): Map<String, ControlStateDto> {
        if (incoming.isEmpty()) return current
        val next = current.toMutableMap()
        var changed = false
        incoming.forEach { entry ->
            if (entry.controlId.isBlank() || entry.revision < 0) return@forEach
            val previous = next[entry.controlId]
            if (previous != null && entry.revision <= previous.revision) return@forEach
            next[entry.controlId] = entry
            changed = true
        }
        return if (changed) next else current
    }

    /** Snaps a raw control value to the control's step grid, clamped to range. */
    fun snapControlValue(
        raw: Float,
        minValue: Float,
        maxValue: Float,
        step: Float,
    ): Float {
        val clamped = raw.coerceIn(minValue, maxValue)
        if (!step.isFinite() || step <= 0f) return clamped
        val steps = ((clamped - minValue) / step).roundToInt()
        return (minValue + steps * step).coerceIn(minValue, maxValue)
    }

    /**
     * Converts the normalized 0..1 state value into the control's configured
     * min..max range and snaps it to the step grid.
     */
    fun valueFromNormalized(
        normalized: Float,
        minValue: Float,
        maxValue: Float,
        step: Float,
    ): Float {
        val range = (maxValue - minValue).takeIf { it > 0f } ?: 1f
        return snapControlValue(
            raw = minValue + normalized.coerceIn(0f, 1f) * range,
            minValue = minValue,
            maxValue = maxValue,
            step = step,
        )
    }
}
