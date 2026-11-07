package com.phonedek.app.net

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeckConnectionPressResultTest {
    @Test
    fun carriesOptionalSuccessMessage() {
        val payload = parsePressResult(
            buildJsonObject {
                put("requestId", "r-1")
                put("buttonId", "b-1")
                put("ok", true)
                put("message", "Screenshot saved to Desktop: shot.png")
            },
        )

        assertEquals("r-1", payload.requestId)
        assertEquals("b-1", payload.buttonId)
        assertTrue(payload.ok)
        assertNull(payload.error)
        assertEquals("Screenshot saved to Desktop: shot.png", payload.message)
    }

    @Test
    fun ordinaryPressesHaveNoMessage() {
        val payload = parsePressResult(
            buildJsonObject {
                put("requestId", "r-2")
                put("buttonId", "b-2")
                put("ok", true)
            },
        )

        assertTrue(payload.ok)
        assertNull(payload.message)
        assertNull(payload.error)
    }

    @Test
    fun errorsKeepTheirErrorAndOptionalMessage() {
        val payload = parsePressResult(
            buildJsonObject {
                put("requestId", "r-3")
                put("buttonId", "b-3")
                put("ok", false)
                put("error", "Could not capture the screen.")
                put("message", "ignored for failures")
            },
        )

        assertFalse(payload.ok)
        assertEquals("Could not capture the screen.", payload.error)
        assertEquals("ignored for failures", payload.message)
    }
}
