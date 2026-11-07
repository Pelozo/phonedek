package com.phonedek.app.ui

import android.view.Surface
import org.junit.Assert.assertEquals
import org.junit.Test

class ContentRotationTest {
    @Test
    fun portraitWithDisplayRotation90RotatesCounterClockwise() {
        assertEquals(
            -90f,
            buttonContentRotation(
                physicalOrientation = 0,
                displayRotation = Surface.ROTATION_90,
                lockLandscape = true,
                enabled = true,
            ),
            0f,
        )
    }

    @Test
    fun portraitWithDisplayRotation270RotatesClockwise() {
        assertEquals(
            90f,
            buttonContentRotation(
                physicalOrientation = 0,
                displayRotation = Surface.ROTATION_270,
                lockLandscape = true,
                enabled = true,
            ),
            0f,
        )
    }

    @Test
    fun invertedPortraitAddsAHalfTurn() {
        assertEquals(
            90f,
            buttonContentRotation(180, Surface.ROTATION_90, true, true),
            0f,
        )
        assertEquals(
            -90f,
            buttonContentRotation(180, Surface.ROTATION_270, true, true),
            0f,
        )
    }

    @Test
    fun physicalLandscapeDoesNotRotateContent() {
        assertEquals(
            0f,
            buttonContentRotation(90, Surface.ROTATION_90, true, true),
            0f,
        )
        assertEquals(
            0f,
            buttonContentRotation(270, Surface.ROTATION_270, true, true),
            0f,
        )
    }

    @Test
    fun disabledPreferenceDoesNotRotateContent() {
        assertEquals(
            0f,
            buttonContentRotation(0, Surface.ROTATION_90, true, false),
            0f,
        )
    }

    @Test
    fun landscapeLockOffDoesNotRotateContent() {
        assertEquals(
            0f,
            buttonContentRotation(0, Surface.ROTATION_90, false, true),
            0f,
        )
    }

    @Test
    fun unknownOrientationAndUnsupportedDisplayRotationDoNotRotate() {
        assertEquals(0f, buttonContentRotation(-1, Surface.ROTATION_90, true, true), 0f)
        assertEquals(0f, buttonContentRotation(0, Surface.ROTATION_0, true, true), 0f)
        assertEquals(0f, buttonContentRotation(0, Surface.ROTATION_180, true, true), 0f)
    }
}
