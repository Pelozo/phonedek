package com.phonedek.app.ui

import com.phonedek.app.data.PointerButtonEvent
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/**
 * Pure, unit-testable gesture state machine for the full-screen pointer pad.
 *
 * Compose supplies positions in pixels and a pad height; this class converts
 * finger travel to the protocol's normalized deltas (fractions of pad height)
 * and scroll notches. It never touches Android or Compose APIs.
 *
 * The drag-lock state survives across gestures: a long-press emits `left down`,
 * then a later tap (no movement) emits `left up`, matching how a physical
 * trackpad holds a drag.
 */
internal const val POINTER_TAP_SLOP_DP = 10f
internal const val POINTER_SCROLL_SLOP_DP = 9f
internal const val POINTER_TAP_MAX_MS = 300L
internal const val POINTER_LONG_PRESS_MS = 400L
internal const val POINTER_SCROLL_NOTCH_DP = 36f

internal data class PadPoint(
    val x: Float,
    val y: Float,
    val timeMs: Long,
)

internal enum class PointerHaptic { TAP, RIGHT_CLICK, DRAG_LOCK }

/**
 * Maps a screen-space pointer delta into the direction the user perceives.
 *
 * [rotationDegrees] is the clockwise rotation already applied to the tile
 * content via [LocalButtonContentRotation]. Touch positions arrive in screen
 * space, so an upright-looking deck that is counter-rotated by -90° produces
 * raw deltas rotated by -90°; undo that rotation before sending the frame.
 * Positive angles follow Compose's `graphicsLayer.rotationZ` convention.
 */
internal fun rotatePointerDelta(
    dx: Float,
    dy: Float,
    rotationDegrees: Float,
): Pair<Float, Float> {
    if (dx == 0f && dy == 0f) return dx to dy
    val degrees = rotationDegrees % 360f
    if (degrees == 0f) return dx to dy
    val radians = Math.toRadians(degrees.toDouble())
    val cosValue = cos(radians).toFloat()
    val sinValue = sin(radians).toFloat()
    // Inverse rotation (R(-θ)): [cos sin; -sin cos].
    return (dx * cosValue + dy * sinValue) to (-dx * sinValue + dy * cosValue)
}

internal data class PointerGestureFrame(
    val dx: Float = 0f,
    val dy: Float = 0f,
    val scrollX: Float = 0f,
    val scrollY: Float = 0f,
    val buttons: List<PointerButtonEvent> = emptyList(),
    val haptic: PointerHaptic? = null,
    val cancelled: Boolean = false,
) {
    val hasPayload: Boolean
        get() = dx != 0f ||
            dy != 0f ||
            scrollX != 0f ||
            scrollY != 0f ||
            buttons.isNotEmpty()

    fun merge(other: PointerGestureFrame): PointerGestureFrame = PointerGestureFrame(
        dx = dx + other.dx,
        dy = dy + other.dy,
        scrollX = scrollX + other.scrollX,
        scrollY = scrollY + other.scrollY,
        buttons = buttons + other.buttons,
        haptic = other.haptic ?: haptic,
        cancelled = cancelled || other.cancelled,
    )

    /**
     * Counter-rotates movement and scroll so a physical drag matches the deck
     * content the user sees. Buttons, haptics and cancel state are untouched.
     */
    fun rotated(rotationDegrees: Float): PointerGestureFrame {
        if (rotationDegrees % 360f == 0f) return this
        val (rotatedDx, rotatedDy) = rotatePointerDelta(dx, dy, rotationDegrees)
        val (rotatedScrollX, rotatedScrollY) =
            rotatePointerDelta(scrollX, scrollY, rotationDegrees)
        return copy(
            dx = rotatedDx,
            dy = rotatedDy,
            scrollX = rotatedScrollX,
            scrollY = rotatedScrollY,
        )
    }
}

private enum class Mode {
    IDLE,
    PENDING_ONE,
    PENDING_TWO,
    MOVE,
    SCROLL,
    HELD,
    LOCKED,
}

/**
 * Gesture classifier for one pad surface.
 *
 * [tapSlopPx], [scrollSlopPx] and [notchPx] are in screen pixels; PointerPad
 * converts the dp constants with the current density.
 */
internal class PointerGesture(
    private val padHeightPx: Float,
    private val tapSlopPx: Float,
    private val scrollSlopPx: Float,
    private val notchPx: Float,
    tapMaxMs: Long = POINTER_TAP_MAX_MS,
    longPressMs: Long = POINTER_LONG_PRESS_MS,
    private val naturalScroll: Boolean = true,
    private val tapToClick: Boolean = true,
    private val dragLock: Boolean = true,
) {
    private val safeHeight = padHeightPx.coerceAtLeast(1f)
    private val safeNotch = notchPx.coerceAtLeast(1f)
    private val tapMax = tapMaxMs.coerceAtLeast(1L)
    private val longPress = longPressMs.coerceAtLeast(1L)

    private var mode = Mode.IDLE
    private var active = false
    private var buttonLocked = false

    private var downX = 0f
    private var downY = 0f
    private var downTime = 0L
    private var lastX = 0f
    private var lastY = 0f
    private var lastTime = 0L
    private var moved = false
    private var longPressFired = false

    val canLongPress: Boolean
        get() = active && !buttonLocked && mode == Mode.PENDING_ONE

    val longPressDeadlineMs: Long
        get() = downTime + longPress

    val isDragLocked: Boolean
        get() = buttonLocked

    fun onDown(point: PadPoint): PointerGestureFrame {
        active = true
        moved = false
        longPressFired = false
        downX = point.x
        downY = point.y
        downTime = point.timeMs
        lastX = point.x
        lastY = point.y
        lastTime = point.timeMs
        mode = if (buttonLocked) Mode.LOCKED else Mode.PENDING_ONE
        return PointerGestureFrame()
    }

    /** Second finger arrived. Rebase so the centroid change is not a jump. */
    fun onSecondDown(point: PadPoint): PointerGestureFrame {
        lastX = point.x
        lastY = point.y
        lastTime = point.timeMs
        if (mode == Mode.PENDING_ONE) {
            // Classify scroll against the two-finger centroid, not the first finger.
            downX = point.x
            downY = point.y
            mode = Mode.PENDING_TWO
        }
        // A second finger during an active move continues moving (no teleport).
        return PointerGestureFrame()
    }

    /** One of two fingers lifted. Keep the two-finger classification until lift. */
    fun onSecondUp(point: PadPoint): PointerGestureFrame {
        lastX = point.x
        lastY = point.y
        lastTime = point.timeMs
        return PointerGestureFrame()
    }

    fun onMove(current: PadPoint, historical: List<PadPoint> = emptyList()): PointerGestureFrame {
        if (!active) return PointerGestureFrame()
        val path = buildList {
            historical
                .filter { it.timeMs >= lastTime }
                .sortedBy { it.timeMs }
                .forEach(::add)
            add(current)
        }
        var frame = PointerGestureFrame()
        for (point in path) {
            frame = frame.merge(processPoint(point))
        }
        return frame
    }

    /** Called by a timer while the finger is still down. */
    fun onTick(nowMs: Long): PointerGestureFrame {
        if (!canLongPress) return PointerGestureFrame()
        if (nowMs - downTime < longPress) return PointerGestureFrame()
        if (hypot(lastX - downX, lastY - downY) > tapSlopPx) return PointerGestureFrame()

        mode = if (dragLock) Mode.LOCKED else Mode.HELD
        buttonLocked = dragLock
        moved = false
        longPressFired = true
        return PointerGestureFrame(
            buttons = listOf(PointerButtonEvent(button = "left", action = "down")),
            haptic = PointerHaptic.DRAG_LOCK,
        )
    }

    fun onUp(point: PadPoint): PointerGestureFrame {
        if (!active) return PointerGestureFrame()
        var frame = processPoint(point)
        val elapsed = (point.timeMs - downTime).coerceAtLeast(0L)

        frame = when (mode) {
            Mode.PENDING_ONE -> {
                if (!moved && elapsed <= tapMax && tapToClick) {
                    frame.merge(
                        PointerGestureFrame(
                            buttons = listOf(PointerButtonEvent("left", "click")),
                            haptic = PointerHaptic.TAP,
                        ),
                    )
                } else {
                    frame
                }
            }

            Mode.PENDING_TWO -> {
                if (!moved && elapsed <= tapMax) {
                    frame.merge(
                        PointerGestureFrame(
                            buttons = listOf(PointerButtonEvent("right", "click")),
                            haptic = PointerHaptic.RIGHT_CLICK,
                        ),
                    )
                } else {
                    frame
                }
            }

            Mode.LOCKED -> {
                // The lift that ends the long-press keeps the lock; a later
                // contact tap (no movement, no long press) releases it.
                if (!moved && !longPressFired) {
                    buttonLocked = false
                    frame.merge(
                        PointerGestureFrame(
                            buttons = listOf(PointerButtonEvent("left", "up")),
                        ),
                    )
                } else {
                    frame
                }
            }

            Mode.HELD -> {
                buttonLocked = false
                frame.merge(
                    PointerGestureFrame(
                        buttons = listOf(PointerButtonEvent("left", "up")),
                    ),
                )
            }

            Mode.MOVE, Mode.SCROLL, Mode.IDLE -> frame
        }

        reset()
        return frame
    }

    /** System gesture/back: drop local state. The VM sends `cancel` to the desktop. */
    fun onCancel(): PointerGestureFrame {
        val wasActive = active
        reset()
        buttonLocked = false
        return PointerGestureFrame(cancelled = wasActive)
    }

    private fun processPoint(point: PadPoint): PointerGestureFrame {
        if (point.timeMs == lastTime && point.x == lastX && point.y == lastY) {
            return PointerGestureFrame()
        }
        val stepX = point.x - lastX
        val stepY = point.y - lastY
        lastX = point.x
        lastY = point.y
        lastTime = point.timeMs

        val totalX = point.x - downX
        val totalY = point.y - downY
        val distance = hypot(totalX, totalY)

        return when (mode) {
            Mode.PENDING_ONE -> {
                if (distance > tapSlopPx) {
                    mode = Mode.MOVE
                    moved = true
                    moveFrame(totalX, totalY)
                } else {
                    PointerGestureFrame()
                }
            }

            Mode.PENDING_TWO -> {
                if (distance > scrollSlopPx) {
                    mode = Mode.SCROLL
                    moved = true
                    scrollFrame(totalX, totalY)
                } else {
                    PointerGestureFrame()
                }
            }

            Mode.MOVE -> {
                if (stepX != 0f || stepY != 0f) moved = true
                moveFrame(stepX, stepY)
            }

            Mode.SCROLL -> scrollFrame(stepX, stepY)

            Mode.LOCKED, Mode.HELD -> {
                if (distance > tapSlopPx) moved = true
                moveFrame(stepX, stepY)
            }

            Mode.IDLE -> PointerGestureFrame()
        }
    }

    private fun moveFrame(dxPx: Float, dyPx: Float): PointerGestureFrame {
        if (dxPx == 0f && dyPx == 0f) return PointerGestureFrame()
        return PointerGestureFrame(
            dx = (dxPx / safeHeight).coerceIn(-2f, 2f),
            dy = (dyPx / safeHeight).coerceIn(-2f, 2f),
        )
    }

    private fun scrollFrame(dxPx: Float, dyPx: Float): PointerGestureFrame {
        if (dxPx == 0f && dyPx == 0f) return PointerGestureFrame()
        val sign = if (naturalScroll) 1f else -1f
        return PointerGestureFrame(
            scrollX = (sign * dxPx / safeNotch).coerceIn(-10f, 10f),
            scrollY = (sign * dyPx / safeNotch).coerceIn(-10f, 10f),
        )
    }

    private fun reset() {
        active = false
        mode = Mode.IDLE
        moved = false
        longPressFired = false
    }
}

internal data class PointerAccumulated(
    val dx: Float = 0f,
    val dy: Float = 0f,
    val scrollX: Float = 0f,
    val scrollY: Float = 0f,
) {
    val hasDelta: Boolean
        get() = dx != 0f || dy != 0f || scrollX != 0f || scrollY != 0f
}

/**
 * Sums one 16 ms window of pointer movement and clamps the emitted frame.
 * Relative motion is summed (not latest-wins) so quick flicks are not lost.
 */
internal class PointerAccumulator {
    private var dx = 0f
    private var dy = 0f
    private var scrollX = 0f
    private var scrollY = 0f

    val isPending: Boolean
        get() = dx != 0f || dy != 0f || scrollX != 0f || scrollY != 0f

    fun addMove(dxDelta: Float, dyDelta: Float) {
        if (!dxDelta.isFinite() || !dyDelta.isFinite()) return
        dx += dxDelta
        dy += dyDelta
    }

    fun addScroll(xNotches: Float, yNotches: Float) {
        if (!xNotches.isFinite() || !yNotches.isFinite()) return
        scrollX += xNotches
        scrollY += yNotches
    }

    /**
     * Adds the deltas between successive positions. Callers pass historical
     * samples followed by the current position so sub-frame movement is not
     * dropped when a frame carries several coalesced touch samples.
     */
    fun addMovePath(points: List<PadPoint>, padHeightPx: Float) {
        if (padHeightPx <= 0f || points.size < 2) return
        for (index in 1 until points.size) {
            val previous = points[index - 1]
            val current = points[index]
            addMove(
                dxDelta = (current.x - previous.x) / padHeightPx,
                dyDelta = (current.y - previous.y) / padHeightPx,
            )
        }
    }

    /** Returns the clamped frame and clears the window. */
    fun take(): PointerAccumulated {
        val frame = PointerAccumulated(
            dx = dx.coerceIn(-2f, 2f),
            dy = dy.coerceIn(-2f, 2f),
            scrollX = scrollX.coerceIn(-10f, 10f),
            scrollY = scrollY.coerceIn(-10f, 10f),
        )
        clear()
        return frame
    }

    fun clear() {
        dx = 0f
        dy = 0f
        scrollX = 0f
        scrollY = 0f
    }
}
