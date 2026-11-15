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
    const val NO_TWITCH = "NO TWITCH"
    const val NO_LIGHT = "NO LIGHT"
    const val NO_PLAYER = "NO PLAYER"
    const val NO_SESSION = "NO SESSION"
    const val NO_RIG = "NO RIG"
    const val UNSUPPORTED = "UNSUPPORTED"
    const val NO_MIXER = "NO MIXER"
    const val OFFLINE = "OFFLINE"
    const val MUTED = "MUTED"
    const val SWITCHING = "SWITCHING"
    const val NO_STATE = "—"

    private const val LIGHT_TEMPERATURE_MIN = 143f
    private const val LIGHT_TEMPERATURE_MAX = 344f

    private val unavailableDetails = setOf(
        NO_INPUT,
        NO_OBS,
        NO_LIGHT,
        NO_PLAYER,
        NO_SESSION,
        NO_RIG,
        UNSUPPORTED,
        NO_MIXER,
        OFFLINE,
        SWITCHING,
        "NO SCENE",
        "NO SOURCE",
    )

    /**
     * Text shown in a control header. The local value stays usable while the
     * desktop reports that no capture/OBS/light source exists, and a muted
     * source is always explicit even if the desktop omits its detail string.
     *
     * [unavailableText] is the fallback when the entry is unavailable and the
     * desktop did not send one of the known short details (light uses
     * `NO LIGHT`; everything else keeps the historical `NO INPUT`).
     */
    fun displayText(
        localText: String,
        statePresent: Boolean,
        stateAvailable: Boolean,
        stateMuted: Boolean,
        stateDetail: String?,
        interacting: Boolean,
        unavailableText: String = NO_INPUT,
    ): String {
        if (interacting || !statePresent) return localText
        val detail = stateDetail?.trim()?.takeIf { it.isNotEmpty() }
        // OBS distinguishes a missing input from a closed socket and a scene
        // collection switch. Preserve those exact strings instead of folding
        // every unavailable source into NO INPUT.
        if (detail != null && detail in unavailableDetails) return detail
        if (stateMuted || detail == MUTED) return MUTED
        if (!stateAvailable) return unavailableText
        return detail ?: localText
    }

    /** True for a local-light value control (slider or dial). */
    fun isLightValueControl(control: ControlDto?): Boolean =
        control != null &&
            control.kind != "trackpad" &&
            control.emit == "value" &&
            control.binding.type == "light"

    /** True when a button carries a local-light action (power on/off/toggle). */
    fun hasLightAction(actions: List<ActionDto>): Boolean =
        actions.any { it.type.trim().lowercase() == "light" }

    /** True for a normal tile with a read-only local-light status binding. */
    fun hasLightStateBinding(button: DeckButton?): Boolean =
        button?.state?.type == "light"

    /** True for an OBS input-volume value control (slider or dial). */
    fun isObsValueControl(control: ControlDto?): Boolean =
        control != null &&
            control.kind != "trackpad" &&
            control.emit == "value" &&
            control.binding.type == "obs" &&
            control.binding.target == "inputVolume"

    /** True for a media position value control (slider or dial). */
    fun isMediaValueControl(control: ControlDto?): Boolean =
        control != null &&
            control.kind != "trackpad" &&
            control.emit == "value" &&
            control.binding.type == "media" &&
            control.binding.target == "position"

    /**
     * True for a per-app volume value control (slider or dial).
     *
     * Per-app state rides the existing `control-state-v1` watch channel.
     * `mixer-v1` only advertises the desktop's full mixer snapshot on
     * Windows/Linux and is deliberately not required here.
     */
    fun isAppVolumeValueControl(control: ControlDto?): Boolean =
        control != null &&
            control.kind != "trackpad" &&
            control.emit == "value" &&
            control.binding.type == "appVolume" &&
            control.binding.target == "volume"

    /** True when a button carries a per-app action (tap-to-mute). */
    fun hasAppVolumeAction(actions: List<ActionDto>): Boolean =
        actions.any { it.type.trim().lowercase() == "appvolume" }

    /** True for a normal tile with a read-only per-app volume/mute binding. */
    fun hasAppVolumeStateBinding(button: DeckButton?): Boolean =
        button?.state?.type == "appVolume"

    /** True when a button carries an OBS action (e.g. tap-to-mute). */
    fun hasObsAction(actions: List<ActionDto>): Boolean =
        actions.any { it.type.trim().lowercase() == "obs" }

    /** True for a normal tile with a read-only OBS status binding. */
    fun hasObsStateBinding(button: DeckButton?): Boolean =
        button?.state?.type == "obs"

    /** True for a normal tile with a read-only Twitch status binding. */
    fun hasTwitchStateBinding(button: DeckButton?): Boolean =
        button?.state?.type == "twitch"

    /** True when a button carries a Twitch action (chat/marker/title/game). */
    fun hasTwitchAction(actions: List<ActionDto>): Boolean =
        actions.any { it.type.trim().lowercase() == "twitch" }

    /**
     * Preset id of the first well-formed rig run action, or null. The phone
     * only needs it to match `rigProgress`/last-run state to the tile; the
     * desktop resolves the actual preset from its own config on press.
     */
    fun rigActionPreset(actions: List<ActionDto>): String? =
        actions.asSequence()
            .mapNotNull { action ->
                if (action.type.trim().lowercase() != "rig") return@mapNotNull null
                val verb = action.action?.trim()?.lowercase()
                if (verb != null && verb.isNotEmpty() && verb != "run") {
                    return@mapNotNull null
                }
                action.presetId?.trim()?.take(128)?.takeIf { it.isNotEmpty() }
            }
            .firstOrNull()

    /** True when a button carries a rig run action. */
    fun hasRigAction(button: DeckButton?): Boolean =
        rigActionPreset(button?.actions.orEmpty()) != null

    /** True for a normal tile with a read-only rig last-run binding. */
    fun hasRigStateBinding(button: DeckButton?): Boolean =
        button?.state?.type == "rig"

    /**
     * Chip text for a non-control tile with a state binding. The desktop's
     * `detail` already carries the short form (`LIVE`, `REC`, `OFF`, `42%`,
     * a scene name, a viewer count, uptime, title or game); `active` is only a
     * fallback for sparse updates. `null` means there is nothing to show yet
     * (or the desktop has no live-state capability, as with an older desktop).
     */
    fun stateTileText(
        binding: StateBindingDto?,
        state: ControlStateDto?,
        stateCapable: Boolean,
    ): String? = when (binding?.type) {
        "obs" -> obsStateTileText(binding, state, stateCapable)
        "twitch" -> twitchStateTileText(binding, state, stateCapable)
        "light" -> lightStateTileText(binding, state, stateCapable)
        "appVolume" -> appVolumeStateTileText(binding, state, stateCapable)
        "rig" -> rigStateTileText(binding, state, stateCapable)
        else -> null
    }

    private fun obsStateTileText(
        binding: StateBindingDto,
        state: ControlStateDto?,
        stateCapable: Boolean,
    ): String? {
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

    /**
     * Twitch tiles are detail-driven: the desktop already formats `LIVE`,
     * `OFF`, a viewer count, `1:23:45`, the title or the category. `NO TWITCH`
     * and `TWITCH OFF` arrive as unavailable details and are shown quietly
     * (the active treatment requires `available`), never as a toast.
     */
    private fun twitchStateTileText(
        binding: StateBindingDto,
        state: ControlStateDto?,
        stateCapable: Boolean,
    ): String? {
        if (state == null) return if (stateCapable) NO_STATE else null
        val detail = state.detail?.trim()?.takeIf { it.isNotEmpty() }
        if (!state.available) return detail ?: NO_TWITCH
        if (detail != null) return detail
        // Sparse live update without a detail: `active` is the only live cue.
        if (binding.target == "live") {
            return when (state.active) {
                true -> "LIVE"
                false -> "OFF"
                null -> null
            }
        }
        return null
    }

    /**
     * Local-light tiles are detail-driven like Twitch: the desktop sends
     * `ON`/`OFF` for power, `42%` for brightness and `250` for temperature
     * (mired). `NO LIGHT` (nothing configured) and `OFFLINE` (unreachable)
     * arrive as unavailable details and are shown quietly; the accent only
     * applies while the light is on.
     */
    private fun lightStateTileText(
        binding: StateBindingDto,
        state: ControlStateDto?,
        stateCapable: Boolean,
    ): String? {
        if (state == null) return if (stateCapable) NO_STATE else null
        val detail = state.detail?.trim()?.takeIf { it.isNotEmpty() }
        if (!state.available) return detail ?: NO_LIGHT
        if (detail != null) return detail
        // Sparse update without a detail: derive the same short form from the
        // normalized value, or fall back to the on/off cue.
        return when (binding.target) {
            "power" -> when (state.active) {
                true -> "ON"
                false -> "OFF"
                null -> null
            }

            "brightness" -> state.value?.let { value ->
                "${(value.coerceIn(0f, 1f) * 100).roundToInt()}%"
            } ?: when (state.active) {
                false -> "OFF"
                else -> null
            }

            "temperature" -> state.value?.let { value ->
                val raw = LIGHT_TEMPERATURE_MIN +
                    value.coerceIn(0f, 1f) * (LIGHT_TEMPERATURE_MAX - LIGHT_TEMPERATURE_MIN)
                raw.roundToInt().toString()
            } ?: when (state.active) {
                false -> "OFF"
                else -> null
            }

            else -> null
        }
    }

    /**
     * Per-app tiles follow the same detail-first rule as OBS/light. The
     * desktop sends `42%` for volume, `LIVE`/`MUTED` for mute, and
     * `NO SESSION`/`UNSUPPORTED` when the process is missing or the host has
     * no mixer. Missing sessions stay quiet (chip text, never a toast).
     */
    private fun appVolumeStateTileText(
        binding: StateBindingDto,
        state: ControlStateDto?,
        stateCapable: Boolean,
    ): String? {
        if (state == null) return if (stateCapable) NO_STATE else null
        val detail = state.detail?.trim()?.takeIf { it.isNotEmpty() }
        if (!state.available) return detail ?: NO_SESSION
        if (state.muted == true || detail == MUTED) return MUTED
        if (detail != null) return detail
        // Sparse update without a detail: derive the same short form from the
        // normalized value or the mute cue.
        return when (binding.target) {
            "volume" -> state.value?.let { value ->
                "${(value.coerceIn(0f, 1f) * 100).roundToInt()}%"
            }

            "mute" -> when (state.active) {
                true -> "LIVE"
                false -> MUTED
                null -> null
            }

            else -> null
        }
    }

    /**
     * Rig tiles are detail-first: the desktop formats `READY`, `3/9`,
     * `RUN 2m`, `PARTIAL`, `FAILED`, `BLOCKED`, `STOPPED`, `TIMEOUT` and
     * `NO RIG` (all ≤12 chars). A missing state is quiet placeholder text,
     * never a toast; `active` only carries the accent while the runner owns
     * the preset.
     */
    private fun rigStateTileText(
        binding: StateBindingDto,
        state: ControlStateDto?,
        stateCapable: Boolean,
    ): String? {
        if (binding.presetId.isNullOrBlank()) return null
        if (state == null) return if (stateCapable) NO_STATE else null
        val detail = state.detail?.trim()?.takeIf { it.isNotEmpty() }
        if (!state.available) return detail ?: NO_RIG
        if (detail != null) return detail
        if (state.active == true) return "RUN"
        return NO_STATE
    }

    /** True when the state chip should use the active/accent treatment. */
    fun stateTileActive(state: ControlStateDto?): Boolean =
        state?.available == true && state.active == true

    /**
     * Ids with a desktop live-state producer: absolute output volume,
     * microphone gain, OBS input volume, local-light controls, per-app volume,
     * media position, and normal buttons with an OBS/Twitch/light/app/rig
     * read-only `state` binding. Relative volume, scroll and trackpads stay
     * open-loop.
     */
    fun statefulControlIds(page: DeckPage): List<String> =
        page.buttons
            .asSequence()
            .filter { button ->
                // A status tile uses the same channel, even without a control.
                val stateType = button.state?.type
                if (stateType == "obs" || stateType == "twitch" ||
                    stateType == "light" || stateType == "appVolume" ||
                    stateType == "rig"
                ) {
                    return@filter true
                }
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
                    "light" -> true
                    "appVolume" -> control.binding.target == "volume"
                    "media" -> control.binding.target == "position"
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
