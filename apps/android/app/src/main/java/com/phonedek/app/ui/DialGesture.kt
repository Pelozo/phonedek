package com.phonedek.app.ui

import kotlin.math.abs

/** How the first few dp of a wheel drag should be interpreted. */
internal enum class DialGestureMode { ROTATE, VERTICAL }

// Compose angles: 0° is 3 o'clock and positive turns clockwise. Starting at
// 135° and sweeping 270° puts the gauge gap at the bottom, which reads as a
// complete wheel; a -135° start puts the gap on the left and looks clipped.
internal const val DIAL_ARC_START = 135f
internal const val DIAL_ARC_SWEEP = 270f

/**
 * Position of [angleDegrees] on the dial arc as 0..1, or null when the angle
 * falls in the bottom gap. Used for tap-to-set.
 */
internal fun dialArcFraction(angleDegrees: Float): Float? {
    val fromStart = ((angleDegrees - DIAL_ARC_START) % 360f + 360f) % 360f
    if (fromStart > DIAL_ARC_SWEEP) return null
    return fromStart / DIAL_ARC_SWEEP
}

/** Inverse of [dialArcFraction]: the knob angle for a 0..1 value fraction. */
internal fun dialKnobDegrees(fraction: Float): Float =
    DIAL_ARC_START + DIAL_ARC_SWEEP * fraction.coerceIn(0f, 1f)

/**
 * One-step direction for a tap on the arc: +1 when the tap is clockwise of
 * the knob, -1 counter-clockwise, 0 within the dead zone. Wraps around the
 * arc ends so a scroll wheel at 99% still steps forward on a tap past 0%.
 */
internal fun dialTapDirection(tappedFraction: Float, currentFraction: Float): Int {
    var diff = (tappedFraction - currentFraction) * DIAL_ARC_SWEEP
    while (diff > DIAL_ARC_SWEEP / 2f) diff -= DIAL_ARC_SWEEP
    while (diff < -DIAL_ARC_SWEEP / 2f) diff += DIAL_ARC_SWEEP
    return when {
        diff > 10f -> 1
        diff < -10f -> -1
        else -> 0
    }
}

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
