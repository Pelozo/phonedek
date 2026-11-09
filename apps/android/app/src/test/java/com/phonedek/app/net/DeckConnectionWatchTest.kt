package com.phonedek.app.net

import com.phonedek.app.data.DeviceInfo
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeckConnectionWatchTest {
    @Test
    fun helloAdvertisesControlStateCapability() {
        val capabilities = parseCapabilities(
            buildHelloPayload(
                DeviceInfo(name = "Phone", model = "Android", appVersion = "test"),
            ),
        )

        assertTrue("control-state-v1" in capabilities)
        assertTrue("input-v1" in capabilities)
    }

    @Test
    fun watchCarriesProfilePageIdsAndInterval() {
        val payload = buildWatchPayload(
            profileId = "p1",
            pageId = "pg1",
            controlIds = listOf("btn-vol", "btn-wheel"),
            intervalMs = 2000,
        )

        assertEquals("watch", payload.text("type"))
        assertEquals("p1", payload.text("profileId"))
        assertEquals("pg1", payload.text("pageId"))
        assertEquals(2000, (payload["intervalMs"] as JsonPrimitive).int)
        val ids = payload["controlIds"] as JsonArray
        assertEquals(2, ids.size)
        assertEquals("btn-vol", (ids[0] as JsonPrimitive).contentOrNull)
        assertEquals("btn-wheel", (ids[1] as JsonPrimitive).contentOrNull)
    }

    @Test
    fun emptyIdsAreAnExplicitUnsubscribe() {
        val payload = buildWatchPayload(
            profileId = "p1",
            pageId = "pg1",
            controlIds = emptyList(),
        )

        val ids = payload["controlIds"] as JsonArray
        assertTrue(ids.isEmpty())
        assertEquals(1000, (payload["intervalMs"] as JsonPrimitive).int)
    }

    @Test
    fun intervalIsClampedAndIdsAreSanitizedAndCapped() {
        val tooFast = buildWatchPayload("p", "pg", emptyList(), intervalMs = 10)
        assertEquals(500, (tooFast["intervalMs"] as JsonPrimitive).int)

        val tooSlow = buildWatchPayload("p", "pg", emptyList(), intervalMs = 99_000)
        assertEquals(5000, (tooSlow["intervalMs"] as JsonPrimitive).int)

        val payload = buildWatchPayload(
            profileId = "p",
            pageId = "pg",
            controlIds = listOf(" a ", "", "a", "b") + (1..40).map { "c$it" },
        )
        val ids = payload["controlIds"] as JsonArray
        assertEquals(32, ids.size)
        assertEquals("a", (ids[0] as JsonPrimitive).contentOrNull)
        assertEquals("b", (ids[1] as JsonPrimitive).contentOrNull)
        assertEquals("c1", (ids[2] as JsonPrimitive).contentOrNull)
    }

    private fun JsonObject.text(key: String): String? =
        (this[key] as? JsonPrimitive)?.contentOrNull
}
