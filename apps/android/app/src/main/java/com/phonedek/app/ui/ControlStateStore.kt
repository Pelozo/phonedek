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
    const val NO_INPUT = "NO INPUT"
    const val MUTED = "MUTED"

    /**
     * Text shown in a control header. The local value stays usable while the
     * desktop reports that no capture device exists, and a muted mic is always
     * explicit even if the desktop omits its detail string.
     */
    fun displayText(
        localText: String,
        statePresent: Boolean,
        stateAvailable: Boolean,
        stateMuted: Boolean,
        stateDetail: String?,
        interacting: Boolean,
    ): String {
        if (interacting || !statePresent) return localText
        if (!stateAvailable) return NO_INPUT
        if (stateMuted) return MUTED
        return stateDetail?.trim()?.takeIf { it.isNotEmpty() } ?: localText
    }

    /**
     * Controls with a desktop live-state producer: absolute output volume and
     * microphone gain. Relative volume, scroll and trackpads stay open-loop.
     */
    fun absoluteVolumeControlIds(page: DeckPage): List<String> =
        page.buttons
            .asSequence()
            .filter { button ->
                val control = button.control ?: return@filter false
                if (control.kind == "trackpad" || control.emit != "value") {
                    return@filter false
                }
                when (control.binding.type) {
                    "volume" -> control.binding.mode == "absolute"
                    "mic" -> control.binding.mode == "gain"
                    else -> false
                }
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
