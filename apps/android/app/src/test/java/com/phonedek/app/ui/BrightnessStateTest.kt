package com.phonedek.app.ui

import org.junit.Assert.assertNull
import org.junit.Test

class BrightnessStateTest {
    @Test
    fun phoneBrightnessDefaultsToSystemControl() {
        assertNull(UiState().phoneBrightness)
    }
}
