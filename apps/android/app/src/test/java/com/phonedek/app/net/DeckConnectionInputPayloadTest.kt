package com.phonedek.app.net

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.float
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeckConnectionInputPayloadTest {
    @Test
    fun absoluteInputCarriesNormalizedValueAndNoDelta() {
        val payload = buildInputPayload(
            requestId = "r-1",
            profileId = "profile",
            pageId = "page",
            controlId = "volume",
            phase = "move",
            delta = null,
            value = 0.42f,
        )

        assertEquals("input", (payload["type"] as JsonPrimitive).contentOrNull)
        assertEquals("volume", (payload["controlId"] as JsonPrimitive).contentOrNull)
        assertEquals("move", (payload["phase"] as JsonPrimitive).contentOrNull)
        assertEquals(0.42f, (payload["value"] as JsonPrimitive).float, 0.001f)
        assertNull(payload["delta"])
    }

    @Test
    fun relativeInputCarriesDeltaAndNoValue() {
        val payload = buildInputPayload(
            requestId = "r-2",
            profileId = "profile",
            pageId = "page",
            controlId = "scroll",
            phase = "move",
            delta = 2.5f,
            value = null,
        )

        assertEquals(2.5f, (payload["delta"] as JsonPrimitive).float, 0.001f)
        assertNull(payload["value"])
    }

    @Test
    fun valuesAndDeltasAreClamped() {
        val valuePayload = buildInputPayload(
            requestId = "r-3",
            profileId = "p",
            pageId = "page",
            controlId = "volume",
            phase = "end",
            delta = null,
            value = 1.7f,
        )
        assertEquals(1f, (valuePayload["value"] as JsonPrimitive).float, 0.001f)

        val deltaPayload = buildInputPayload(
            requestId = "r-4",
            profileId = "p",
            pageId = "page",
            controlId = "volume",
            phase = "move",
            delta = 150f,
            value = null,
        )
        assertEquals(100f, (deltaPayload["delta"] as JsonPrimitive).float, 0.001f)
    }
}
