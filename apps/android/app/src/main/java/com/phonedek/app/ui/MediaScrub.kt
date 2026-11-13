package com.phonedek.app.ui

import com.phonedek.app.data.ControlStateDto
import kotlin.math.roundToLong

/**
 * Local preview for the media scrub.
 *
 * The desktop owns the real playhead and publishes it as `controlState`. While
 * a finger is on the track the preview must not be overwritten by the next
 * progress tick, or the thumb jumps back under the finger. [applyRemote] keeps
 * the preview and only refreshes the duration; the next update after
 * [release] is allowed through again.
 *
 * Media uses `commit: 'end'`, so the only wire value is the final fraction
 * returned by [fraction] after the finger lifts. Intermediate previews never
 * leave the phone.
 */
data class MediaScrubState(
    val durationMs: Long = 0L,
    val positionMs: Long = 0L,
    val dragging: Boolean = false,
    val previewMs: Long = 0L,
) {
    /** Position currently drawn: the finger preview while dragging. */
    val shownMs: Long get() = if (dragging) previewMs else positionMs

    /** Normalized 0..1 value for the current display position. */
    val fraction: Float get() = MediaScrub.fractionFor(shownMs, durationMs)

    /** Apply a remote playhead; suppressed while the user is dragging. */
    fun applyRemote(positionMs: Long, durationMs: Long): MediaScrubState {
        val safeDuration = durationMs.coerceAtLeast(0L)
        val safePosition = MediaScrub.clampPosition(positionMs, safeDuration)
        return if (dragging) {
            // A transient "unknown duration" (player buffering/stopping) must
            // not erase the finger preview mid-gesture.
            if (safeDuration <= 0L) {
                this
            } else {
                copy(
                    durationMs = safeDuration,
                    previewMs = previewMs.coerceIn(0L, safeDuration),
                )
            }
        } else {
            copy(durationMs = safeDuration, positionMs = safePosition)
        }
    }

    /** Begin a gesture at [fraction], jumping the preview to the touched point. */
    fun startDrag(fraction: Float): MediaScrubState =
        copy(dragging = true, previewMs = MediaScrub.previewFor(fraction, durationMs))

    /** Move the local preview; never sends anything. */
    fun drag(fraction: Float): MediaScrubState =
        if (dragging) {
            copy(previewMs = MediaScrub.previewFor(fraction, durationMs))
        } else {
            this
        }

    /**
     * Finish the gesture at [fraction]. The preview becomes the displayed
     * position until the desktop publishes the post-seek playhead.
     */
    fun release(fraction: Float): MediaScrubState {
        val preview = MediaScrub.previewFor(fraction, durationMs)
        return copy(dragging = false, previewMs = preview, positionMs = preview)
    }
}

/** Pure formatting and range rules shared by the media UI and its tests. */
object MediaScrub {
    const val NO_PLAYER = ControlStateStore.NO_PLAYER

    /** Text glyphs; the variation selector keeps them monochrome. */
    fun glyph(playing: Boolean): String = if (playing) "\u23F8\uFE0E" else "\u25B6\uFE0E"

    fun isAvailable(state: ControlStateDto?): Boolean = state?.available == true

    fun isPlaying(state: ControlStateDto?): Boolean = state?.playing == true

    /**
     * `m:ss`, or `h:mm:ss` for long media. Mirrors the desktop formatter so the
     * phone readout matches the PC's telemetry.
     */
    fun formatTime(positionMs: Long): String {
        val total = (positionMs.coerceAtLeast(0L).toDouble() / 1000.0).roundToLong()
        val hours = total / 3600L
        val minutes = (total % 3600L) / 60L
        val seconds = total % 60L
        val secondsText = seconds.toString().padStart(2, '0')
        if (hours > 0L) {
            return "$hours:${minutes.toString().padStart(2, '0')}:$secondsText"
        }
        return "$minutes:$secondsText"
    }

    /** `1:23 / 3:45`, or just the elapsed time when the duration is unknown. */
    fun formatRange(positionMs: Long, durationMs: Long): String {
        val elapsed = formatTime(positionMs)
        return if (durationMs > 0L) "$elapsed / ${formatTime(durationMs)}" else elapsed
    }

    /** Normalized playhead, 0 when there is no duration yet. */
    fun fractionFor(positionMs: Long, durationMs: Long): Float {
        if (durationMs <= 0L) return 0f
        return (positionMs.toDouble() / durationMs.toDouble())
            .coerceIn(0.0, 1.0)
            .toFloat()
    }

    /** Clamp a playhead to a known duration (or to zero while it is unknown). */
    fun clampPosition(positionMs: Long, durationMs: Long): Long {
        if (durationMs <= 0L) return 0L
        return positionMs.coerceIn(0L, durationMs)
    }

    /** Position represented by a 0..1 track fraction. */
    fun previewFor(fraction: Float, durationMs: Long): Long {
        if (durationMs <= 0L) return 0L
        val safe = fraction.takeIf { it.isFinite() }?.coerceIn(0f, 1f) ?: 0f
        return (safe.toDouble() * durationMs.toDouble())
            .roundToLong()
            .coerceIn(0L, durationMs)
    }

    /** Quiet text for a missing/broken player; the desktop detail wins. */
    fun unavailableText(state: ControlStateDto?): String =
        state?.detail?.trim()?.takeIf { it.isNotEmpty() } ?: NO_PLAYER

    /** Time readout, or the quiet unavailable reason when there is no player. */
    fun timeText(state: ControlStateDto?, shownMs: Long): String =
        if (!isAvailable(state)) {
            unavailableText(state)
        } else {
            formatRange(shownMs, state?.durationMs ?: 0L)
        }

    fun titleText(state: ControlStateDto?): String? =
        state?.title?.trim()?.takeIf { it.isNotEmpty() }

    fun artistText(state: ControlStateDto?): String? =
        state?.artist?.trim()?.takeIf { it.isNotEmpty() }
}
