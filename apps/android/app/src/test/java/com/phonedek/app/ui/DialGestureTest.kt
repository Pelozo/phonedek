package com.phonedek.app.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class DialGestureTest {
    @Test
    fun verticalDragFromTheTopScrubs() {
        // Touch above the hub, drag further up: radial, not a turn.
        assertEquals(
            DialGestureMode.VERTICAL,
            dialGestureMode(radiusX = 0f, radiusY = -50f, moveX = 0f, moveY = -10f),
        )
    }

    @Test
    fun verticalDragFromTheSideRotates() {
        // Touch at the right rim, drag up: that is along the ring.
        assertEquals(
            DialGestureMode.ROTATE,
            dialGestureMode(radiusX = 50f, radiusY = 0f, moveX = 0f, moveY = -10f),
        )
    }

    @Test
    fun circlingTheHubRotates() {
        assertEquals(
            DialGestureMode.ROTATE,
            dialGestureMode(radiusX = 40f, radiusY = 30f, moveX = -30f, moveY = 40f),
        )
    }

    @Test
    fun dragThroughTheHubScrubs() {
        assertEquals(
            DialGestureMode.VERTICAL,
            dialGestureMode(radiusX = 40f, radiusY = 30f, moveX = -40f, moveY = -30f),
        )
    }

    @Test
    fun horizontalDragTowardTheHubScrubs() {
        assertEquals(
            DialGestureMode.VERTICAL,
            dialGestureMode(radiusX = -50f, radiusY = 0f, moveX = 10f, moveY = 0f),
        )
    }

    @Test
    fun tapOnTheArcMapsStartMiddleAndEnd() {
        assertEquals(0f, dialArcFraction(135f)!!, 0.0001f)
        assertEquals(0.5f, dialArcFraction(270f)!!, 0.0001f)
        assertEquals(1f, dialArcFraction(45f)!!, 0.0001f)
    }

    @Test
    fun tapInTheBottomGapIsIgnored() {
        // 90° is straight down, inside the gauge gap.
        assertEquals(null, dialArcFraction(90f))
    }

    @Test
    fun knobDegreesInvertsTheArcFraction() {
        assertEquals(135f, dialKnobDegrees(0f), 0.0001f)
        assertEquals(270f, dialKnobDegrees(0.5f), 0.0001f)
        assertEquals(405f, dialKnobDegrees(1f), 0.0001f)
        assertEquals(135f, dialKnobDegrees(-1f), 0.0001f)
        assertEquals(405f, dialKnobDegrees(2f), 0.0001f)
    }

    @Test
    fun tapDirectionFollowsTheArcAndWrapsAtTheEnds() {
        assertEquals(1, dialTapDirection(tappedFraction = 0.6f, currentFraction = 0.5f))
        assertEquals(-1, dialTapDirection(tappedFraction = 0.4f, currentFraction = 0.5f))
        assertEquals(0, dialTapDirection(tappedFraction = 0.5f, currentFraction = 0.5f))
        // A scroll wheel at 90% tapping just past 0% should step forward, not back.
        assertEquals(1, dialTapDirection(tappedFraction = 0.05f, currentFraction = 0.9f))
        assertEquals(-1, dialTapDirection(tappedFraction = 0.95f, currentFraction = 0.05f))
    }
}
