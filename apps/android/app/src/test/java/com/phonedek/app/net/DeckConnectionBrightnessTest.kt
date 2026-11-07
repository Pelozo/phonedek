package com.phonedek.app.net

import com.phonedek.app.data.DeviceInfo
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeckConnectionBrightnessTest {
    @Test
    fun parsesFiniteLevelsInRange() {
        assertEquals(
            BrightnessMessage.Level(0f),
            parseBrightness(buildJsonObject { put("level", 0) }),
        )
        assertEquals(
            BrightnessMessage.Level(0.5f),
            parseBrightness(buildJsonObject { put("level", 0.5) }),
        )
        assertEquals(
            BrightnessMessage.Level(1f),
            parseBrightness(buildJsonObject { put("level", 1) }),
        )
    }

    @Test
    fun explicitNullMeansSystemBrightness() {
        assertEquals(
            BrightnessMessage.System,
            parseBrightness(buildJsonObject { put("level", JsonNull) }),
        )
    }

    @Test
    fun malformedLevelsAreIgnored() {
        assertEquals(BrightnessMessage.Invalid, parseBrightness(buildJsonObject { }))
        assertEquals(
            BrightnessMessage.Invalid,
            parseBrightness(buildJsonObject { put("level", -0.1) }),
        )
        assertEquals(
            BrightnessMessage.Invalid,
            parseBrightness(buildJsonObject { put("level", 1.1) }),
        )
        assertEquals(
            BrightnessMessage.Invalid,
            parseBrightness(buildJsonObject { put("level", "0.5") }),
        )
    }

    @Test
    fun helloAdvertisesInputAndBrightnessCapabilities() {
        val capabilities = parseCapabilities(
            buildHelloPayload(
                DeviceInfo(name = "Phone", model = "Android", appVersion = "test"),
            ),
        )

        assertTrue("input-v1" in capabilities)
        assertTrue("brightness-v1" in capabilities)
    }
}
