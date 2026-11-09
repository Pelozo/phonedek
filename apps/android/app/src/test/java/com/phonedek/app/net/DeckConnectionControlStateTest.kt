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
    fun parsesMicMuteAndNoInputStates() {
        val message = DeckJson.parseControlState(
            """
                {
                  "type": "controlState",
                  "profileId": "p1",
                  "pageId": "pg1",
                  "states": [
                    {
                      "controlId": "btn-mic",
                      "revision": 7,
                      "value": 0.35,
                      "muted": true,
                      "available": true,
                      "detail": "MUTED"
                    },
                    {
                      "controlId": "btn-mic2",
                      "revision": 8,
                      "available": false,
                      "detail": "Unavailable"
                    }
                  ]
                }
            """.trimIndent(),
        )

        assertNotNull(message)
        val mutedMic = message!!.states.first()
        assertEquals("btn-mic", mutedMic.controlId)
        assertTrue(mutedMic.muted!!)
        assertTrue(mutedMic.available)
        assertEquals(0.35f, mutedMic.value!!, 0.0001f)
        assertEquals("MUTED", mutedMic.detail)

        val unavailable = message.states.last()
        assertEquals("btn-mic2", unavailable.controlId)
        assertNull(unavailable.muted)
        assertFalse(unavailable.available)
        assertNull(unavailable.value)
    }

    @Test
    fun parsesObsVolumeMuteAndUnavailableStates() {
        val message = DeckJson.parseControlState(
            """
                {
                  "type": "controlState",
                  "profileId": "p1",
                  "pageId": "pg1",
                  "states": [
                    {
                      "controlId": "obs-live",
                      "revision": 11,
                      "value": 0.75,
                      "muted": false,
                      "available": true,
                      "detail": "150%"
                    },
                    {
                      "controlId": "obs-muted",
                      "revision": 12,
                      "value": 1.0,
                      "muted": true,
                      "available": true,
                      "detail": "MUTED"
                    },
                    {
                      "controlId": "obs-closed",
                      "revision": 13,
                      "available": false,
                      "detail": "NO OBS"
                    },
                    {
                      "controlId": "obs-missing",
                      "revision": 14,
                      "available": false,
                      "detail": "NO INPUT"
                    },
                    {
                      "controlId": "obs-switching",
                      "revision": 15,
                      "available": false,
                      "detail": "SWITCHING"
                    }
                  ]
                }
            """.trimIndent(),
        )

        assertNotNull(message)
        val states = message!!.states.associateBy { it.controlId }
        assertEquals(5, states.size)

        val live = states.getValue("obs-live")
        assertEquals(0.75f, live.value!!, 0.0001f)
        assertFalse(live.muted!!)
        assertTrue(live.available)
        assertEquals("150%", live.detail)

        val muted = states.getValue("obs-muted")
        assertTrue(muted.muted!!)
        assertEquals("MUTED", muted.detail)

        assertFalse(states.getValue("obs-closed").available)
        assertEquals("NO OBS", states.getValue("obs-closed").detail)
        assertFalse(states.getValue("obs-missing").available)
        assertEquals("NO INPUT", states.getValue("obs-missing").detail)
        assertFalse(states.getValue("obs-switching").available)
        assertEquals("SWITCHING", states.getValue("obs-switching").detail)
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
