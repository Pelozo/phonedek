package com.phonedek.app.ui

import android.view.Surface
import androidx.compose.runtime.staticCompositionLocalOf

/** Rotation applied to deck button icon/label content, not the tile itself. */
val LocalButtonContentRotation = staticCompositionLocalOf { 0f }

/**
 * Whether the locked landscape deck should counter-rotate button content.
 *
 * [physicalOrientation] is the sensor orientation in degrees (0 = natural
 * portrait, 90/270 = landscape). [displayRotation] is one of the
 * `Surface.ROTATION_*` constants. In Compose, positive `rotationZ` is clockwise.
 *
 * When the activity is landscape-locked, display rotation describes the already
 * applied clockwise rotation of the landscape graphics. Counter-rotating by the
 * opposite sign makes button content upright when the phone is physically
 * portrait again. Physical landscape returns 0 because the layout is already
 * oriented for the user.
 */
fun buttonContentRotation(
    physicalOrientation: Int,
    displayRotation: Int,
    lockLandscape: Boolean,
    enabled: Boolean,
): Float {
    if (!lockLandscape || !enabled) return 0f
    if (!isPhysicalPortrait(physicalOrientation)) return 0f
    return when (displayRotation) {
        Surface.ROTATION_90 -> -90f
        Surface.ROTATION_270 -> 90f
        else -> 0f
    }
}

private fun isPhysicalPortrait(orientation: Int): Boolean =
    orientation >= 0 &&
        (orientation < 45 || orientation >= 315 || orientation in 135..225)
