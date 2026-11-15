package com.phonedek.app.ui

import com.phonedek.app.data.RigProgressDto

/**
 * One rig run as rendered on a deck tile. Runtime only: never persisted.
 *
 * Active runs show `index/total`; a finished run keeps its final status for a
 * short hold so the tile does not snap back to `RIG` before the user sees it.
 */
data class RigTileProgress(
    val presetId: String,
    val buttonId: String? = null,
    val phase: String = "start",
    val index: Int = 0,
    val total: Int = 0,
    val label: String? = null,
    val status: String? = null,
    val ok: Boolean? = null,
    val error: String? = null,
    val durationMs: Long? = null,
    val startedAtMillis: Long = 0L,
    val doneAtMillis: Long? = null,
) {
    val isActive: Boolean get() = phase != "done"

    /** Compact mono chip text for the tile. */
    fun chipText(): String {
        if (isActive) return "$index/$total"
        return when (status) {
            "ok" -> "OK"
            "partial" -> "PARTIAL"
            "failed" -> "FAILED"
            "blocked" -> "BLOCKED"
            "cancelled" -> "STOPPED"
            "timeout" -> "TIMEOUT"
            "busy" -> "BUSY"
            else -> "$index/$total"
        }
    }
}

/**
 * Latest run per button and per preset. A run started from a button is also
 * visible on every other tile bound to that preset; a new run replaces the
 * previous button entry (latest wins).
 */
data class RigProgressState(
    val byButton: Map<String, RigTileProgress> = emptyMap(),
    val byPreset: Map<String, RigTileProgress> = emptyMap(),
) {
    fun forTile(buttonId: String, presetId: String?): RigTileProgress? {
        byButton[buttonId]?.let { return it }
        return presetId
            ?.takeIf { it.isNotBlank() }
            ?.let(byPreset::get)
    }
}

/**
 * Pure reducer for `rigProgress`. Frames on one socket arrive in order, but a
 * reconnect or a late in-flight frame can duplicate or regress a step; never
 * let an older step rewrite a newer one.
 */
object RigProgressStore {
    /** How long a `done` chip stays on the tile before it reverts to `RIG`. */
    const val DONE_HOLD_MS = 800L

    fun apply(
        current: RigProgressState,
        frame: RigProgressDto,
        now: Long,
    ): RigProgressState {
        if (frame.presetId.isBlank()) return current
        val existing = current.byPreset[frame.presetId]
        if (frame.phase == "step" && existing != null) {
            // A duplicate or out-of-order step, or a step after the final frame.
            if (existing.phase == "done") return current
            if (frame.index <= existing.index) return current
        }
        // Do not restart the hold timer on a duplicated `done`.
        if (frame.phase == "done" && existing?.phase == "done") return current

        val startedAt = when {
            frame.phase == "start" -> now
            existing != null -> existing.startedAtMillis
            else -> now
        }
        val record = RigTileProgress(
            presetId = frame.presetId,
            buttonId = frame.buttonId ?: existing?.buttonId,
            phase = frame.phase,
            index = frame.index,
            total = frame.total,
            label = frame.label ?: existing?.label,
            status = when {
                frame.status != null -> frame.status
                frame.phase == "start" -> null
                else -> existing?.status
            },
            ok = frame.ok ?: existing?.ok,
            error = frame.error ?: existing?.error,
            durationMs = frame.durationMs ?: existing?.durationMs,
            startedAtMillis = startedAt,
            doneAtMillis = if (frame.phase == "done") now else null,
        )

        val byButton = current.byButton
            .filterValues { it.presetId != frame.presetId }
            .toMutableMap()
        record.buttonId?.let { byButton[it] = record }
        val byPreset = current.byPreset.toMutableMap()
        byPreset[frame.presetId] = record
        return RigProgressState(byButton = byButton, byPreset = byPreset)
    }

    /** Drops finished runs whose hold elapsed; active runs are untouched. */
    fun prune(current: RigProgressState, now: Long): RigProgressState {
        val kept = current.byPreset.filterValues { entry ->
            entry.doneAtMillis == null || now - entry.doneAtMillis < DONE_HOLD_MS
        }
        if (kept.size == current.byPreset.size) return current
        return fromPreset(kept)
    }

    /** Removes one preset (a `done` hold elapsed or a newer run replaced it). */
    fun clearPreset(current: RigProgressState, presetId: String): RigProgressState {
        if (current.byPreset[presetId] == null &&
            current.byButton.values.none { it.presetId == presetId }
        ) {
            return current
        }
        return fromPreset(current.byPreset - presetId)
    }

    /** Page/profile switch, disconnect or reconnect: all runtime runs are stale. */
    fun clear(): RigProgressState = RigProgressState()

    private fun fromPreset(
        byPreset: Map<String, RigTileProgress>,
    ): RigProgressState {
        val byButton = byPreset.values
            .mapNotNull { entry -> entry.buttonId?.let { it to entry } }
            .toMap()
        return RigProgressState(byButton = byButton, byPreset = byPreset)
    }
}
