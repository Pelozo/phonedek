package com.phonedek.app.ui

import kotlin.math.abs

/** How the first few dp of a wheel drag should be interpreted. */
internal enum class DialGestureMode { ROTATE, VERTICAL }

/**
 * Picks between turning the wheel and scrubbing it vertically.
 *
 * [radiusX]/[radiusY] point from the wheel hub to the touch-down position;
 * [moveX]/[moveY] are the accumulated drag from that point. Movement around
 * the hub (tangential) is a rotation; movement along/through the hub is a
 * straight drag, which a wheel should treat like a physical thumbwheel.
 *
 * Ties go to [DialGestureMode.VERTICAL] so a plain vertical drag always works.
 */
internal fun dialGestureMode(
    radiusX: Float,
    radiusY: Float,
    moveX: Float,
    moveY: Float,
): DialGestureMode {
    val radial = abs(moveX * radiusX + moveY * radiusY)
    val tangential = abs(moveX * radiusY - moveY * radiusX)
    return if (tangential > radial) DialGestureMode.ROTATE else DialGestureMode.VERTICAL
}
