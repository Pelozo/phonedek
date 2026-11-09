package com.phonedek.app.net

import com.phonedek.app.data.DeckJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeckConnectionControlStateTest {
    @Test
    fun parsesBatchedStateWithEveryField() {
        val message = DeckJson.parseControlState(
            """
                {
                  "type": "controlState",
                  "profileId": "p1",
                  "pageId": "pg1",
                  "states": [
                    {
                      "controlId": "btn-vol",
                      "revision": 12,
                      "value": 0.42,
                      "muted": true,
                      "available": true,
                      "detail": "42%",
                      "futureField": 1
                    },
                    {
                      "controlId": "btn-wheel",
                      "revision": 4,
                      "available": false,
                      "detail": "no device"
                    }
                  ]
                }
            """.trimIndent(),
        )

        assertNotNull(message)
        assertEquals("p1", message!!.profileId)
        assertEquals("pg1", message.pageId)
        assertEquals(2, message.states.size)
        val volume = message.states.first()
        assertEquals("btn-vol", volume.controlId)
        assertEquals(12, volume.revision)
        assertEquals(0.42f, volume.value!!, 0.0001f)
        assertTrue(volume.muted!!)
        assertTrue(volume.available)
        assertEquals("42%", volume.detail)

        val wheel = message.states.last()
        assertEquals("btn-wheel", wheel.controlId)
        assertNull(wheel.value)
        assertFalse(wheel.available)
    }

    @Test
    fun malformedEntriesAreDroppedWithoutLosingTheBatch() {
        val message = DeckJson.parseControlState(
            """
                {
                  "type": "controlState",
                  "profileId": "p1",
                  "pageId": "pg1",
                  "states": [
                    { "controlId": "good", "revision": 2, "available": true, "value": 0.5 },
                    { "controlId": "", "revision": 3, "available": true, "value": 0.6 },
                    { "controlId": "negative", "revision": -1, "available": true },
                    { "controlId": "out-of-range", "revision": 4, "available": true, "value": 1.5 }
                  ]
                }
            """.trimIndent(),
        )

        assertNotNull(message)
        assertEquals(listOf("good"), message!!.states.map { it.controlId })
    }

    @Test
    fun invalidMessagesAreIgnored() {
        assertNull(DeckJson.parseControlState("not json"))
        assertNull(
            DeckJson.parseControlState(
                """{"type":"controlState","pageId":"pg1","states":[]}""",
            ),
        )
        assertNull(
            DeckJson.parseControlState(
                """{"type":"controlState","profileId":"p1","states":[]}""",
            ),
        )
        assertNull(
            DeckJson.parseControlState(
                """{"type":"controlState","profileId":"p1","pageId":"pg1","states":"nope"}""",
            ),
        )
    }
}
