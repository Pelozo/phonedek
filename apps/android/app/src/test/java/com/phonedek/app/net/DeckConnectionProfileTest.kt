package com.phonedek.app.net

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeckConnectionProfileTest {
    @Test
    fun parsesValidProfileSwitch() {
        assertEquals(
            "valorant-deck",
            parseProfileSwitch(
                buildJsonObject {
                    put("type", "profile")
                    put("profileId", "valorant-deck")
                },
            ),
        )
    }

    @Test
    fun trimsSurroundingWhitespace() {
        assertEquals(
            "wow",
            parseProfileSwitch(buildJsonObject { put("profileId", "  wow  ") }),
        )
    }

    @Test
    fun ignoresBlankMissingAndMalformedIds() {
        assertNull(parseProfileSwitch(buildJsonObject { }))
        assertNull(parseProfileSwitch(buildJsonObject { put("profileId", "") }))
        assertNull(parseProfileSwitch(buildJsonObject { put("profileId", "   ") }))
        assertNull(parseProfileSwitch(buildJsonObject { put("profileId", "-leading-dash") }))
        assertNull(parseProfileSwitch(buildJsonObject { put("profileId", "has space") }))
        assertNull(parseProfileSwitch(buildJsonObject { put("profileId", "a".repeat(65)) }))
        assertNull(parseProfileSwitch(buildJsonObject { put("profileId", 123) }))
    }
}
