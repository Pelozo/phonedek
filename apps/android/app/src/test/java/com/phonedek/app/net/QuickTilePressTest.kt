package com.phonedek.app.net

import com.phonedek.app.data.QuickTileFavorite
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class QuickTilePressTest {
    private val favorite = QuickTileFavorite(
        profileId = "p1",
        pageId = "pg1",
        buttonId = "btn-live",
        label = "Go live",
    )

    @Test
    fun requestUsesTheExistingPressEndpointAndBearerToken() {
        val request = buildQuickTilePressRequest(
            host = "192.168.1.42",
            port = 47654,
            token = "secret-token",
            favorite = favorite,
            requestId = "qs-1",
        )!!

        assertEquals("http://192.168.1.42:47654/api/press", request.url.toString())
        assertEquals("POST", request.method)
        assertEquals("Bearer secret-token", request.header("Authorization"))
        assertEquals("application/json", request.header("Accept"))
        assertEquals("PhoneDeck-Android", request.header("User-Agent"))
    }

    @Test
    fun requestBodyMatchesTheWebSocketPressPayload() {
        val request = buildQuickTilePressRequest(
            host = "192.168.1.42",
            port = 47654,
            token = "secret-token",
            favorite = favorite,
            requestId = "qs-1",
        )!!
        val buffer = Buffer()
        request.body!!.writeTo(buffer)
        val json = com.phonedek.app.data.DeckJson.format
            .parseToJsonElement(buffer.readUtf8()) as JsonObject

        assertEquals("press", (json["type"] as JsonPrimitive).contentOrNull)
        assertEquals("qs-1", (json["requestId"] as JsonPrimitive).contentOrNull)
        assertEquals("p1", (json["profileId"] as JsonPrimitive).contentOrNull)
        assertEquals("pg1", (json["pageId"] as JsonPrimitive).contentOrNull)
        assertEquals("btn-live", (json["buttonId"] as JsonPrimitive).contentOrNull)
    }

    @Test
    fun requestRejectsBlankTokenAndInvalidIds() {
        assertNull(
            buildQuickTilePressRequest("192.168.1.42", 47654, " ", favorite, "qs-1"),
        )
        assertNull(
            buildQuickTilePressRequest("192.168.1.42", 47654, "token", favorite, ""),
        )
        assertNull(
            buildQuickTilePressRequest(
                "192.168.1.42",
                47654,
                "token",
                favorite.copy(buttonId = "bad id"),
                "qs-1",
            ),
        )
        assertNotNull(
            buildQuickTilePressRequest("192.168.1.42", 47654, "token", favorite, "qs-1"),
        )
    }

    @Test
    fun successResponseKeepsOptionalDesktopMessage() {
        val result = mapQuickTilePressResponse(
            200,
            """{"ok":true,"requestId":"qs-1","buttonId":"btn-live","message":"Screenshot saved on PC"}""",
        )

        assertEquals(QuickTilePressOutcome.SUCCESS, result.outcome)
        assertEquals("Screenshot saved on PC", result.detail)
        assertEquals("Pressed Go live", quickTileDescriptionAfterPress(result, "Go live"))
    }

    @Test
    fun responseStatusesMapToUnderstandableOutcomes() {
        assertEquals(
            QuickTilePressOutcome.UNAUTHORIZED,
            mapQuickTilePressResponse(401, """{"ok":false,"error":"Pairing PIN required"}""").outcome,
        )
        assertEquals(
            QuickTilePressOutcome.BUTTON_MISSING,
            mapQuickTilePressResponse(404, """{"ok":false,"error":"Button not found"}""").outcome,
        )
        assertEquals(
            QuickTilePressOutcome.RATE_LIMITED,
            mapQuickTilePressResponse(429, "").outcome,
        )
        assertEquals(
            QuickTilePressOutcome.SERVER_ERROR,
            mapQuickTilePressResponse(500, """{"ok":false,"error":"Action failed"}""").outcome,
        )
        assertEquals(
            QuickTilePressOutcome.SERVER_ERROR,
            mapQuickTilePressResponse(200, """{"ok":false,"error":"No macro target"}""").outcome,
        )
    }

    @Test
    fun nonJsonBodiesFallBackToHttpStatusText() {
        val result = mapQuickTilePressResponse(503, "<html>down</html>")

        assertEquals(QuickTilePressOutcome.SERVER_ERROR, result.outcome)
        assertEquals("The PC rejected the press (HTTP 503).", result.detail)
    }

    @Test
    fun debounceRejectsRapidDoubleTapsForOneSecond() {
        val debounce = QuickTileDebounce(intervalMs = 1_000L)

        assertEquals(true, debounce.tryPress(10_000L))
        assertEquals(false, debounce.tryPress(10_400L))
        assertEquals(false, debounce.tryPress(10_999L))
        assertEquals(true, debounce.tryPress(11_000L))
        assertEquals(false, debounce.tryPress(11_500L))
    }

    @Test
    fun failureDescriptionsAreShortAndActionable() {
        assertEquals(
            "Pair again",
            quickTileDescriptionAfterPress(
                QuickTilePressResult(QuickTilePressOutcome.UNAUTHORIZED),
                "Go live",
            ),
        )
        assertEquals(
            "Choose again",
            quickTileDescriptionAfterPress(
                QuickTilePressResult(QuickTilePressOutcome.BUTTON_MISSING),
                "Go live",
            ),
        )
        assertEquals(
            "PC unreachable",
            quickTileDescriptionAfterPress(
                QuickTilePressResult(QuickTilePressOutcome.UNREACHABLE),
                "Go live",
            ),
        )
    }
}
