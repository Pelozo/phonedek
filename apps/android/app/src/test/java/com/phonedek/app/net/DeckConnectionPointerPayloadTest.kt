package com.phonedek.app.net

import com.phonedek.app.data.DeviceInfo
import com.phonedek.app.data.PointerButtonEvent
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.float
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeckConnectionPointerPayloadTest {
    @Test
    fun helloAdvertisesPointerCapability() {
        val capabilities = parseCapabilities(
            buildHelloPayload(
                DeviceInfo(name = "Phone", model = "Android", appVersion = "test"),
            ),
        )

        assertTrue("pointer-v1" in capabilities)
        assertTrue("input-v1" in capabilities)
    }

    @Test
    fun startCarriesIdsAndNothingElse() {
        val payload = buildPointerPayload(
            seq = 41,
            phase = "start",
            profileId = "p1",
            pageId = "pg1",
            controlId = "btn-pad",
            dx = 0.4f,
            buttons = listOf(PointerButtonEvent("left", "down")),
        )

        assertEquals("pointer", payload.text("type"))
        assertEquals(41L, payload.long("seq"))
        assertEquals("start", payload.text("phase"))
        assertEquals("p1", payload.text("profileId"))
        assertEquals("pg1", payload.text("pageId"))
        assertEquals("btn-pad", payload.text("controlId"))
        assertNull(payload["dx"])
        assertNull(payload["buttons"])
    }

    @Test
    fun moveCarriesClampedDeltasAndButtons() {
        val payload = buildPointerPayload(
            seq = 42,
            phase = "move",
            dx = 3f,
            dy = -0.012f,
            scrollX = -15f,
            scrollY = 0.75f,
            buttons = listOf(
                PointerButtonEvent("left", "down"),
                PointerButtonEvent("right", "click"),
            ),
        )

        assertEquals(2f, payload.float("dx")!!, 0.0001f)
        assertEquals(-0.012f, payload.float("dy")!!, 0.0001f)
        assertEquals(-10f, payload.float("scrollX")!!, 0.0001f)
        assertEquals(0.75f, payload.float("scrollY")!!, 0.0001f)
        assertNull(payload["profileId"])
        assertNull(payload["controlId"])

        val buttons = payload["buttons"] as JsonArray
        assertEquals(2, buttons.size)
        assertEquals("left", (buttons[0] as JsonObject).text("button"))
        assertEquals("down", (buttons[0] as JsonObject).text("action"))
        assertEquals("right", (buttons[1] as JsonObject).text("button"))
        assertEquals("click", (buttons[1] as JsonObject).text("action"))
    }

    @Test
    fun buttonsAreValidatedAndLimitedToFour() {
        val payload = buildPointerPayload(
            seq = 43,
            phase = "end",
            buttons = listOf(
                PointerButtonEvent("left", "down"),
                PointerButtonEvent("middle", "up"),
                PointerButtonEvent("wheel", "down"),
                PointerButtonEvent("right", "explode"),
                PointerButtonEvent("right", "doubleclick"),
                PointerButtonEvent("middle", "click"),
            ),
        )

        val buttons = payload["buttons"] as JsonArray
        assertEquals(4, buttons.size)
        assertEquals("left", (buttons[0] as JsonObject).text("button"))
        assertEquals("middle", (buttons[1] as JsonObject).text("button"))
        assertEquals("up", (buttons[1] as JsonObject).text("action"))
        assertEquals("right", (buttons[2] as JsonObject).text("button"))
        assertEquals("doubleclick", (buttons[2] as JsonObject).text("action"))
        assertEquals("middle", (buttons[3] as JsonObject).text("button"))
        assertEquals("click", (buttons[3] as JsonObject).text("action"))
    }

    @Test
    fun cancelCarriesOnlySeq() {
        val payload = buildPointerPayload(
            seq = 46,
            phase = "cancel",
            profileId = "p1",
            controlId = "btn-pad",
            dx = 1f,
            dy = 1f,
            buttons = listOf(PointerButtonEvent("left", "up")),
        )

        assertEquals("cancel", payload.text("phase"))
        assertEquals(46L, payload.long("seq"))
        assertNull(payload["profileId"])
        assertNull(payload["dx"])
        assertNull(payload["dy"])
        assertNull(payload["buttons"])
    }

    @Test
    fun invalidPhaseFallsBackToCancel() {
        val payload = buildPointerPayload(seq = 1, phase = "explode", dx = 1f)
        assertEquals("cancel", payload.text("phase"))
    }

    @Test
    fun parsesPointerResult() {
        val failure = parsePointerResult(
            buildJsonObject {
                put("seq", 42)
                put("ok", false)
                put("error", "Trackpad is not supported on this desktop.")
            },
        )
        assertEquals(42L, failure.seq)
        assertFalse(failure.ok)
        assertEquals("Trackpad is not supported on this desktop.", failure.error)

        val success = parsePointerResult(
            buildJsonObject {
                put("seq", 45)
                put("ok", true)
            },
        )
        assertTrue(success.ok)
        assertNull(success.error)
    }

    private fun JsonObject.text(key: String): String? =
        (this[key] as? JsonPrimitive)?.contentOrNull

    private fun JsonObject.long(key: String): Long? =
        (this[key] as? JsonPrimitive)?.long

    private fun JsonObject.float(key: String): Float? =
        (this[key] as? JsonPrimitive)?.float
}
