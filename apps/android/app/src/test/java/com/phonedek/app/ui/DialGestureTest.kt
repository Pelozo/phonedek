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
}
