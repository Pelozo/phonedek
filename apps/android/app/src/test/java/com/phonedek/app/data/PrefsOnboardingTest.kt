package com.phonedek.app.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrefsOnboardingTest {
    @Test
    fun freshInstallWithoutStoredOrPairingShowsGuide() {
        assertFalse(resolveOnboardingSeen(storedValue = null, hasSavedPairing = false))
    }

    @Test
    fun existingPairedUserSkipsGuideWhenKeyIsAbsent() {
        assertTrue(resolveOnboardingSeen(storedValue = null, hasSavedPairing = true))
    }

    @Test
    fun explicitStoredValueWinsOverPairing() {
        assertTrue(resolveOnboardingSeen(storedValue = true, hasSavedPairing = false))
        assertFalse(resolveOnboardingSeen(storedValue = false, hasSavedPairing = true))
    }
}
