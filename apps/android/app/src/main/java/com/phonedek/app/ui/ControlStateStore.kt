package com.phonedek.app.ui

import com.phonedek.app.data.ActionDto
import com.phonedek.app.data.ControlDto
import com.phonedek.app.data.ControlStateDto
import com.phonedek.app.data.DeckButton
import com.phonedek.app.data.DeckPage
import com.phonedek.app.data.StateBindingDto
import kotlin.math.roundToInt

/**
 * Pure helpers for live control state. The ViewModel owns the subscription
 * lifecycle; this file only decides which controls are watchable and how a
 * revisioned batch is merged.
 */
object ControlStateStore {
    const val NO_INPUT = "NO INPUT"
    const val NO_OBS = "NO OBS"
    const val MUTED = "MUTED"
    const val SWITCHING = "SWITCHING"
    const val NO_STATE = "—"

    private val unavailableDetails = setOf(NO_INPUT, NO_OBS, SWITCHING, "NO SCENE", "NO SOURCE")

    /**
     * Text shown in a control header. The local value stays usable while the
     * desktop reports that no capture/OBS source exists, and a muted source is
     * always explicit even if the desktop omits its detail string.
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
        val detail = stateDetail?.trim()?.takeIf { it.isNotEmpty() }
        // OBS distinguishes a missing input from a closed socket and a scene
        // collection switch. Preserve those exact strings instead of folding
        // every unavailable source into NO INPUT.
        if (detail != null && detail in unavailableDetails) return detail
        if (stateMuted || detail == MUTED) return MUTED
        if (!stateAvailable) return NO_INPUT
        return detail ?: localText
    }

    /** True for an OBS input-volume value control (slider or dial). */
    fun isObsValueControl(control: ControlDto?): Boolean =
        control != null &&
            control.kind != "trackpad" &&
            control.emit == "value" &&
            control.binding.type == "obs" &&
            control.binding.target == "inputVolume"

    /** True when a button carries an OBS action (e.g. tap-to-mute). */
    fun hasObsAction(actions: List<ActionDto>): Boolean =
        actions.any { it.type.trim().lowercase() == "obs" }

    /** True for a normal tile with a read-only OBS status binding. */
    fun hasObsStateBinding(button: DeckButton?): Boolean =
        button?.state?.type == "obs"

    /**
     * Chip text for a non-control tile with a state binding. The desktop's
     * `detail` already carries the short form (`LIVE`, `REC`, `OFF`, `42%`,
     * a scene name); `active` is only a fallback for sparse updates. `null`
     * means there is nothing to show yet (or the desktop has no live-state
     * capability, as with an older desktop).
     */
    fun stateTileText(
        binding: StateBindingDto?,
        state: ControlStateDto?,
        stateCapable: Boolean,
    ): String? {
        if (binding?.type != "obs") return null
        if (state == null) return if (stateCapable) NO_STATE else null
        val detail = state.detail?.trim()?.takeIf { it.isNotEmpty() }
        // NO OBS / NO INPUT / SWITCHING are status text, not toasts. Show the
        // exact desktop detail so a missing OBS is visible on the tile.
        if (!state.available) return detail ?: NO_OBS
        if (state.muted == true || detail == MUTED) return MUTED
        if (binding.target == "scene") {
            return when {
                detail == null -> if (state.active == false) "OFF" else null
                detail == "NO SCENE" -> detail
                else -> "SCENE: $detail"
            }
        }
        if (detail != null) return detail
        // Volume updates normally carry a detail percentage; fall back to the
        // normalized value for a desktop that only sends the value.
        if (binding.target == "inputVolume") {
            state.value?.let { return "${(it.coerceIn(0f, 1f) * 100).roundToInt()}%" }
        }
        val active = state.active ?: return null
        if (!active) return "OFF"
        return when (binding.target) {
            "streaming" -> "LIVE"
            "recording" -> "REC"
            "replay" -> "REPLAY"
            "virtualCam" -> "VCAM"
            "inputMute" -> MUTED
            else -> "ON"
        }
    }

    /** True when the state chip should use the active/accent treatment. */
    fun stateTileActive(state: ControlStateDto?): Boolean =
        state?.available == true && state.active == true

    /**
     * Ids with a desktop live-state producer: absolute output volume,
     * microphone gain, OBS input volume, and normal buttons with an OBS
     * read-only `state` binding. Relative volume, scroll and trackpads stay
     * open-loop.
     */
    fun statefulControlIds(page: DeckPage): List<String> =
        page.buttons
            .asSequence()
            .filter { button ->
                // A status tile uses the same channel, even without a control.
                if (button.state?.type == "obs") return@filter true
                val control = button.control ?: return@filter false
                if (control.kind == "trackpad" || control.emit != "value") {
                    return@filter false
                }
                // Shortcut wheels are delta-only; the desktop has no live value
                // to report for them.
                if (control.binding.type == "shortcut") return@filter false
                when (control.binding.type) {
                    "volume" -> control.binding.mode == "absolute"
                    "mic" -> control.binding.mode == "gain"
                    "obs" -> control.binding.target == "inputVolume"
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
