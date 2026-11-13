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
                      "active": true,
                      "futureField": 1
                    },
                    {
                      "controlId": "btn-wheel",
                      "revision": 4,
                      "available": false,
                      "detail": "no device",
                      "active": false
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
        assertTrue(volume.active!!)

        val wheel = message.states.last()
        assertEquals("btn-wheel", wheel.controlId)
        assertNull(wheel.value)
        assertFalse(wheel.available)
        assertFalse(wheel.active!!)
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
    fun parsesObsStatusActiveCuesAndSceneNames() {
        val message = DeckJson.parseControlState(
            """
                {
                  "type": "controlState",
                  "profileId": "p1",
                  "pageId": "pg1",
                  "states": [
                    {
                      "controlId": "btn-stream",
                      "revision": 20,
                      "available": true,
                      "detail": "LIVE",
                      "active": true
                    },
                    {
                      "controlId": "btn-record",
                      "revision": 21,
                      "available": true,
                      "detail": "OFF",
                      "active": false
                    },
                    {
                      "controlId": "btn-scene",
                      "revision": 22,
                      "available": true,
                      "detail": "Game",
                      "active": true
                    },
                    {
                      "controlId": "btn-mute",
                      "revision": 23,
                      "available": true,
                      "detail": "MUTED",
                      "muted": true,
                      "active": true
                    }
                  ]
                }
            """.trimIndent(),
        )

        assertNotNull(message)
        val states = message!!.states.associateBy { it.controlId }
        assertEquals(4, states.size)
        assertTrue(states.getValue("btn-stream").active!!)
        assertFalse(states.getValue("btn-record").active!!)
        assertEquals("Game", states.getValue("btn-scene").detail)
        assertTrue(states.getValue("btn-scene").active!!)
        assertTrue(states.getValue("btn-mute").muted!!)
        assertTrue(states.getValue("btn-mute").active!!)
    }

    @Test
    fun parsesMediaPlayheadTitleArtistAndPlaying() {
        val message = DeckJson.parseControlState(
            """
                {
                  "type": "controlState",
                  "profileId": "p1",
                  "pageId": "pg1",
                  "states": [
                    {
                      "controlId": "media",
                      "revision": 9,
                      "value": 0.37,
                      "available": true,
                      "detail": "1:23 / 3:45",
                      "positionMs": 83000,
                      "durationMs": 225000,
                      "playing": true,
                      "title": "  Midnight City  ",
                      "artist": "M83"
                    },
                    {
                      "controlId": "media-idle",
                      "revision": 4,
                      "available": false,
                      "detail": "NO PLAYER"
                    }
                  ]
                }
            """.trimIndent(),
        )

        assertNotNull(message)
        val states = message!!.states.associateBy { it.controlId }
        val media = states.getValue("media")
        assertEquals(0.37f, media.value!!, 0.0001f)
        assertEquals(83_000L, media.positionMs!!)
        assertEquals(225_000L, media.durationMs!!)
        assertTrue(media.playing!!)
        assertEquals("Midnight City", media.title)
        assertEquals("M83", media.artist)

        val missing = states.getValue("media-idle")
        assertFalse(missing.available)
        assertEquals("NO PLAYER", missing.detail)
        assertNull(missing.positionMs)
        assertNull(missing.durationMs)
        assertNull(missing.playing)
        assertNull(missing.title)
        assertNull(missing.artist)
    }

    @Test
    fun malformedMediaTimesAreDroppedNotTheEntry() {
        val message = DeckJson.parseControlState(
            """
                {
                  "type": "controlState",
                  "profileId": "p1",
                  "pageId": "pg1",
                  "states": [
                    {
                      "controlId": "media",
                      "revision": 2,
                      "value": 0.5,
                      "available": true,
                      "positionMs": -1,
                      "durationMs": -5,
                      "title": "   ",
                      "artist": ""
                    }
                  ]
                }
            """.trimIndent(),
        )

        val media = message!!.states.single()
        assertNull(media.positionMs)
        assertNull(media.durationMs)
        assertNull(media.title)
        assertNull(media.artist)
        assertEquals(0.5f, media.value!!, 0.0001f)
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
