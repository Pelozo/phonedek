package com.phonedek.app.ui

import com.phonedek.app.data.PointerButtonEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PointerGestureTest {
    private fun gesture(
        naturalScroll: Boolean = true,
        tapToClick: Boolean = true,
        dragLock: Boolean = true,
    ) = PointerGesture(
        padHeightPx = 1000f,
        tapSlopPx = 10f,
        scrollSlopPx = 10f,
        notchPx = 40f,
        tapMaxMs = 300,
        longPressMs = 400,
        naturalScroll = naturalScroll,
        tapToClick = tapToClick,
        dragLock = dragLock,
    )

    private fun point(x: Float, y: Float, timeMs: Long) = PadPoint(x, y, timeMs)

    private fun buttons(frame: PointerGestureFrame) =
        frame.buttons.map { it.button to it.action }

    @Test
    fun tapBelowSlopClicksOnLift() {
        val pad = gesture()
        pad.onDown(point(100f, 100f, 0))
        val frame = pad.onUp(point(104f, 103f, 120))

        assertEquals(listOf("left" to "click"), buttons(frame))
        assertEquals(PointerHaptic.TAP, frame.haptic)
        assertEquals(0f, frame.dx, 0.0001f)
        assertEquals(0f, frame.dy, 0.0001f)
    }

    @Test
    fun dragPastSlopMovesAndDoesNotClick() {
        val pad = gesture()
        pad.onDown(point(100f, 100f, 0))
        val move = pad.onMove(point(150f, 100f, 50))
        val up = pad.onUp(point(150f, 100f, 80))

        assertEquals(0.05f, move.dx, 0.0001f)
        assertEquals(0f, move.dy, 0.0001f)
        assertTrue(buttons(up).isEmpty())
    }

    @Test
    fun holdLongerThanTapWindowDoesNotClick() {
        val pad = gesture()
        pad.onDown(point(100f, 100f, 0))
        val frame = pad.onUp(point(100f, 100f, 350))

        assertTrue(buttons(frame).isEmpty())
    }

    @Test
    fun longPressSendsLeftDownAndLocksTheDrag() {
        val pad = gesture()
        pad.onDown(point(100f, 100f, 0))
        val pressed = pad.onTick(450)

        assertEquals(listOf("left" to "down"), buttons(pressed))
        assertEquals(PointerHaptic.DRAG_LOCK, pressed.haptic)
        assertTrue(pad.isDragLocked)

        val move = pad.onMove(point(140f, 100f, 500))
        assertEquals(0.04f, move.dx, 0.0001f)
        val lift = pad.onUp(point(140f, 100f, 560))
        assertTrue(buttons(lift).isEmpty())
        assertTrue("drag lock survives the lift", pad.isDragLocked)
    }

    @Test
    fun tapWhileDragLockedReleasesTheButton() {
        val pad = gesture()
        pad.onDown(point(100f, 100f, 0))
        pad.onTick(450)
        pad.onUp(point(100f, 100f, 500))
        assertTrue(pad.isDragLocked)

        pad.onDown(point(120f, 120f, 700))
        val release = pad.onUp(point(121f, 120f, 760))

        assertEquals(listOf("left" to "up"), buttons(release))
        assertFalse(pad.isDragLocked)
    }

    @Test
    fun twoFingerTapRightClicks() {
        val pad = gesture()
        pad.onDown(point(100f, 100f, 0))
        pad.onSecondDown(point(110f, 100f, 20))
        val frame = pad.onUp(point(110f, 100f, 120))

        assertEquals(listOf("right" to "click"), buttons(frame))
        assertEquals(PointerHaptic.RIGHT_CLICK, frame.haptic)
    }

    @Test
    fun twoFingerDragScrollsInNaturalDirection() {
        val pad = gesture(naturalScroll = true)
        pad.onDown(point(100f, 100f, 0))
        pad.onSecondDown(point(100f, 100f, 10))
        val frame = pad.onMove(point(130f, 100f, 100))

        assertEquals(0.75f, frame.scrollX, 0.0001f)
        assertEquals(0f, frame.scrollY, 0.0001f)
        assertEquals(0f, frame.dx, 0.0001f)
    }

    @Test
    fun twoFingerDragCanInvertScroll() {
        val pad = gesture(naturalScroll = false)
        pad.onDown(point(100f, 100f, 0))
        pad.onSecondDown(point(100f, 100f, 10))
        val frame = pad.onMove(point(100f, 140f, 100))

        assertEquals(-1f, frame.scrollY, 0.0001f)
    }

    @Test
    fun secondFingerDuringMoveDoesNotTeleport() {
        val pad = gesture()
        pad.onDown(point(100f, 100f, 0))
        pad.onMove(point(150f, 100f, 50))
        val rebase = pad.onSecondDown(point(400f, 500f, 60))
        val move = pad.onMove(point(410f, 500f, 80))

        assertFalse(rebase.hasPayload)
        assertEquals(0.01f, move.dx, 0.0001f)
        assertEquals(0f, move.dy, 0.0001f)
    }

    @Test
    fun cancelDropsStateAndClearsTheLock() {
        val pad = gesture()
        pad.onDown(point(100f, 100f, 0))
        pad.onMove(point(160f, 100f, 40))
        val cancelled = pad.onCancel()
        assertTrue(cancelled.cancelled)
        assertFalse(pad.isDragLocked)

        pad.onDown(point(20f, 20f, 500))
        val tap = pad.onUp(point(20f, 20f, 560))
        assertEquals(listOf("left" to "click"), buttons(tap))
    }

    @Test
    fun tapToClickCanBeDisabled() {
        val pad = gesture(tapToClick = false)
        pad.onDown(point(100f, 100f, 0))
        val frame = pad.onUp(point(100f, 100f, 100))

        assertTrue(buttons(frame).isEmpty())
    }

    @Test
    fun nonLockingLongPressReleasesOnLift() {
        val pad = gesture(dragLock = false)
        pad.onDown(point(100f, 100f, 0))
        val pressed = pad.onTick(450)
        val lift = pad.onUp(point(100f, 100f, 520))

        assertEquals(listOf("left" to "down"), buttons(pressed))
        assertEquals(listOf("left" to "up"), buttons(lift))
        assertFalse(pad.isDragLocked)
    }

    @Test
    fun historicalSamplesAreSummed() {
        val accumulator = PointerAccumulator()
        accumulator.addMovePath(
            points = listOf(
                point(0f, 0f, 0),
                point(10f, 5f, 4),
                point(20f, 10f, 8),
                point(40f, 20f, 12),
            ),
            padHeightPx = 1000f,
        )
        val frame = accumulator.take()

        assertEquals(0.04f, frame.dx, 0.0001f)
        assertEquals(0.02f, frame.dy, 0.0001f)
    }

    @Test
    fun accumulatorSumsAndClampsOneWindow() {
        val accumulator = PointerAccumulator()
        accumulator.addMove(1.5f, -1.8f)
        accumulator.addMove(1.2f, -1.0f)
        accumulator.addScroll(7f, -12f)

        assertTrue(accumulator.isPending)
        val frame = accumulator.take()
        assertEquals(2f, frame.dx, 0.0001f)
        assertEquals(-2f, frame.dy, 0.0001f)
        assertEquals(7f, frame.scrollX, 0.0001f)
        assertEquals(-10f, frame.scrollY, 0.0001f)
        assertFalse(accumulator.isPending)
        assertTrue(
            accumulator.take() == PointerAccumulated(),
        )
    }

    @Test
    fun buttonEventsAreWireShaped() {
        val event = PointerButtonEvent(button = "left", action = "click")
        assertEquals("left", event.button)
        assertEquals("click", event.action)
    }

    @Test
    fun rotatePointerDeltaIsIdentityAtZero() {
        val (dx, dy) = rotatePointerDelta(3f, -4f, 0f)
        assertEquals(3f, dx, 0.0001f)
        assertEquals(-4f, dy, 0.0001f)
    }

    @Test
    fun rotatePointerDeltaUndoesNinetyDegreeContentRotation() {
        // Content is clockwise-rotated by 90°, so a raw screen-right drag must
        // become "up" for the user-facing content.
        val (dx, dy) = rotatePointerDelta(10f, 0f, 90f)
        assertEquals(0f, dx, 0.0001f)
        assertEquals(-10f, dy, 0.0001f)
    }

    @Test
    fun rotatePointerDeltaUndoesNegativeNinetyDegreeContentRotation() {
        val (dx, dy) = rotatePointerDelta(10f, 0f, -90f)
        assertEquals(0f, dx, 0.0001f)
        assertEquals(10f, dy, 0.0001f)
    }

    @Test
    fun rotatePointerDeltaOneEightyFlipsBothAxes() {
        val (dx, dy) = rotatePointerDelta(10f, -6f, 180f)
        assertEquals(-10f, dx, 0.0001f)
        assertEquals(6f, dy, 0.0001f)
    }

    @Test
    fun rotatePointerDeltaPreservesMagnitude() {
        val angles = listOf(0f, 90f, -90f, 180f, 37f)
        for (angle in angles) {
            val (dx, dy) = rotatePointerDelta(3f, 4f, angle)
            assertEquals(5f, kotlin.math.hypot(dx, dy), 0.0001f)
        }
    }

    @Test
    fun frameRotationMovesBothMovementAndScrollAndKeepsButtons() {
        val frame = PointerGestureFrame(
            dx = 1f,
            dy = 0f,
            scrollX = 0f,
            scrollY = 2f,
            buttons = listOf(PointerButtonEvent("left", "down")),
            haptic = PointerHaptic.DRAG_LOCK,
            cancelled = true,
        )

        val rotated = frame.rotated(90f)

        assertEquals(0f, rotated.dx, 0.0001f)
        assertEquals(-1f, rotated.dy, 0.0001f)
        assertEquals(2f, rotated.scrollX, 0.0001f)
        assertEquals(0f, rotated.scrollY, 0.0001f)
        assertEquals(listOf("left" to "down"), buttons(rotated))
        assertEquals(PointerHaptic.DRAG_LOCK, rotated.haptic)
        assertTrue(rotated.cancelled)
    }
}
