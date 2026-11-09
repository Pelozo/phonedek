package com.phonedek.app.net

import com.phonedek.app.data.DeckJson
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import org.junit.Assert.assertEquals
import org.junit.Test

class DeckConnectionPressPayloadTest {
    @Test
    fun micActionTilePressesByIdSoTheDesktopResolvesTheAction() {
        val button = DeckJson.parse(
            """
                {
                  "profiles": [{
                    "id": "p1",
                    "pages": [{
                      "id": "pg1",
                      "buttons": [{
                        "id": "btn-mic",
                        "slot": 0,
                        "label": "Mic",
                        "actions": [{ "type": "mic", "action": "toggleMute" }]
                      }]
                    }]
                  }]
                }
            """.trimIndent(),
        )!!.profiles.single().pages.single().buttons.single()

        // The phone never executes the mic action itself; it forwards the tile
        // id and the desktop reads toggleMute from its own config.
        assertEquals("mic", button.actions.single().type)
        assertEquals("toggleMute", button.actions.single().action)

        val payload = buildPressPayload(
            requestId = "r-1",
            profileId = "p1",
            pageId = "pg1",
            buttonId = button.id,
        )

        assertEquals("press", (payload["type"] as JsonPrimitive).contentOrNull)
        assertEquals("r-1", (payload["requestId"] as JsonPrimitive).contentOrNull)
        assertEquals("p1", (payload["profileId"] as JsonPrimitive).contentOrNull)
        assertEquals("pg1", (payload["pageId"] as JsonPrimitive).contentOrNull)
        assertEquals("btn-mic", (payload["buttonId"] as JsonPrimitive).contentOrNull)
    }
}
