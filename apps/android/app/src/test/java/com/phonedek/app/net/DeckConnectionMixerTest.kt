package com.phonedek.app.net

import com.phonedek.app.data.DeviceInfo
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeckConnectionMixerTest {
    private fun json(raw: String): JsonObject =
        Json.parseToJsonElement(raw) as JsonObject

    private fun JsonObject.text(key: String): String? =
        (this[key] as? JsonPrimitive)?.contentOrNull

    @Test
    fun helloAdvertisesMixerCapability() {
        val capabilities = parseCapabilities(
            buildHelloPayload(
                DeviceInfo(name = "Phone", model = "Android", appVersion = "test"),
            ),
        )

        assertTrue("mixer-v1" in capabilities)
        // The client must not invent a newer mixer capability.
        assertFalse("mixer-v2" in capabilities)
    }

    @Test
    fun mixerPhasePayloadOnlyCarriesStartOrStop() {
        val start = buildMixerPhasePayload("start")
        assertEquals("mixer", start.text("type"))
        assertEquals("start", start.text("phase"))

        val stop = buildMixerPhasePayload("stop")
        assertEquals("stop", stop.text("phase"))

        // An unknown phase is normalized to the safe unsubscribe.
        assertEquals("stop", buildMixerPhasePayload("bogus").text("phase"))
    }

    @Test
    fun mixerCommandCarriesVolumeAndMute() {
        val payload = buildMixerCommandPayload(
            requestId = " r-1 ",
            sessionId = " session-1 ",
            volume = 42,
            muted = true,
        )

        assertNotNull(payload)
        payload!!
        assertEquals("mixerCommand", payload.text("type"))
        assertEquals("r-1", payload.text("requestId"))
        assertEquals("session-1", payload.text("sessionId"))
        assertEquals(42, (payload["volume"] as JsonPrimitive).int)
        assertTrue((payload["muted"] as JsonPrimitive).boolean)
    }

    @Test
    fun mixerCommandClampsVolumeAndAllowsMuteOnly() {
        val loud = buildMixerCommandPayload("r", "s", volume = 140, muted = null)
        assertEquals(100, (loud!!["volume"] as JsonPrimitive).int)

        val quiet = buildMixerCommandPayload("r", "s", volume = -20, muted = null)
        assertEquals(0, (quiet!!["volume"] as JsonPrimitive).int)

        val muteOnly = buildMixerCommandPayload("r", "s", volume = null, muted = false)
        assertNotNull(muteOnly)
        assertNull(muteOnly!!["volume"])
        assertFalse((muteOnly["muted"] as JsonPrimitive).boolean)
    }

    @Test
    fun mixerCommandRejectsUnusableIdsAndEmptyWrites() {
        assertNull(
            "at least one field is required",
            buildMixerCommandPayload("r", "s", volume = null, muted = null),
        )
        assertNull("blank request id", buildMixerCommandPayload(" ", "s", volume = 1, muted = null))
        assertNull("blank session id", buildMixerCommandPayload("r", " ", volume = 1, muted = null))
        assertNull(
            "request id too long",
            buildMixerCommandPayload("r".repeat(65), "s", volume = 1, muted = null),
        )
        assertNull(
            "session id too long",
            buildMixerCommandPayload("r", "s".repeat(513), volume = 1, muted = null),
        )
    }

    @Test
    fun parsesFullMixerState() {
        val state = parseMixerState(
            json(
                """
                    {
                      "type": "mixerState",
                      "available": true,
                      "reason": "  ",
                      "updatedAt": 1731600000000,
                      "sessions": [
                        {
                          "id": "sess-1",
                          "process": "chrome.exe",
                          "name": "Google Chrome",
                          "volume": 62,
                          "muted": false,
                          "available": true
                        },
                        {
                          "id": "sess-2",
                          "process": "Spotify.exe",
                          "name": "Spotify",
                          "volume": 18,
                          "muted": true
                        }
                      ]
                    }
                """.trimIndent(),
            ),
        )

        assertNotNull(state)
        state!!
        assertTrue(state.available)
        assertNull("blank reasons are dropped", state.reason)
        assertEquals(1731600000000L, state.updatedAt)
        assertEquals(2, state.sessions.size)

        val chrome = state.sessions.first()
        assertEquals("sess-1", chrome.id)
        assertEquals("chrome.exe", chrome.process)
        assertEquals("Google Chrome", chrome.name)
        assertEquals(62, chrome.volume)
        assertFalse(chrome.muted)
        assertTrue(chrome.available)

        // `available` is optional in the session shape; omitted means live.
        val spotify = state.sessions.last()
        assertTrue(spotify.available)
        assertTrue(spotify.muted)
    }

    @Test
    fun parsesUnavailableMixerReason() {
        val state = parseMixerState(
            json(
                """
                    {
                      "type": "mixerState",
                      "available": false,
                      "sessions": [],
                      "reason": "Per-app audio needs the Windows audio helper.",
                      "updatedAt": 12
                    }
                """.trimIndent(),
            ),
        )

        assertNotNull(state)
        assertFalse(state!!.available)
        assertTrue(state.sessions.isEmpty())
        assertEquals(
            "Per-app audio needs the Windows audio helper.",
            state.reason,
        )
    }

    @Test
    fun dropsMalformedSessionsWithoutLosingTheSnapshot() {
        val state = parseMixerState(
            json(
                """
                    {
                      "available": true,
                      "updatedAt": -5,
                      "sessions": [
                        {
                          "id": "good",
                          "process": "game.exe",
                          "name": "Game",
                          "volume": 40,
                          "muted": false
                        },
                        {
                          "id": "",
                          "process": "bad.exe",
                          "name": "Bad",
                          "volume": 40,
                          "muted": false
                        },
                        {
                          "id": "missing-volume",
                          "process": "bad.exe",
                          "name": "Bad",
                          "muted": false
                        },
                        {
                          "id": "string-volume",
                          "process": "bad.exe",
                          "name": "Bad",
                          "volume": "40",
                          "muted": false
                        },
                        {
                          "id": "out-of-range",
                          "process": "bad.exe",
                          "name": "Bad",
                          "volume": 140,
                          "muted": false
                        },
                        {
                          "id": "no-mute",
                          "process": "bad.exe",
                          "name": "Bad",
                          "volume": 40
                        },
                        "not-an-object"
                      ]
                    }
                """.trimIndent(),
            ),
        )

        assertNotNull(state)
        assertEquals(listOf("good"), state!!.sessions.map { it.id })
        assertEquals("negative timestamps clamp to 0", 0L, state.updatedAt)
    }

    @Test
    fun capsSessionsAtTheProtocolLimit() {
        val sessions = (0 until 140).joinToString(",") { index ->
            """
                {
                  "id": "s$index",
                  "process": "app$index.exe",
                  "name": "App $index",
                  "volume": 50,
                  "muted": false
                }
            """.trimIndent()
        }
        val state = parseMixerState(
            json("""{"available":true,"updatedAt":1,"sessions":[$sessions]}"""),
        )

        assertNotNull(state)
        assertEquals(MIXER_MAX_SESSIONS, state!!.sessions.size)
        assertEquals("s0", state.sessions.first().id)
        assertEquals("s127", state.sessions.last().id)
    }

    @Test
    fun rejectsInvalidMixerStateEnvelopes() {
        assertNull(parseMixerState(json("""{"sessions":[],"updatedAt":1}""")))
        assertNull(parseMixerState(json("""{"available":true,"updatedAt":1}""")))
        assertNull(
            parseMixerState(json("""{"available":true,"sessions":"nope","updatedAt":1}""")),
        )
        assertNull(parseMixerState(json("""{"available":"yes","sessions":[],"updatedAt":1}""")))

        // A missing sessions array is invalid, but an explicit empty one is a
        // valid "no apps are playing" snapshot.
        val empty = parseMixerState(json("""{"available":true,"sessions":[],"updatedAt":1}"""))
        assertNotNull(empty)
        assertTrue(empty!!.sessions.isEmpty())
    }

    @Test
    fun parsesMixerResultsIncludingErrors() {
        val ok = parseMixerResult(
            json("""{"type":"mixerResult","requestId":"r-1","ok":true}"""),
        )
        assertNotNull(ok)
        assertEquals("r-1", ok!!.requestId)
        assertTrue(ok.ok)
        assertNull(ok.error)

        val failed = parseMixerResult(
            json(
                """
                    {
                      "type": "mixerResult",
                      "requestId": "r-2",
                      "ok": false,
                      "error": "  No audio session  "
                    }
                """.trimIndent(),
            ),
        )
        assertNotNull(failed)
        assertFalse(failed!!.ok)
        assertEquals("No audio session", failed.error)

        assertNull(parseMixerResult(json("""{"ok":true}""")))
        assertNull(parseMixerResult(json("""{"requestId":"r","ok":"yes"}""")))
        assertNull(parseMixerResult(json("""{"requestId":12,"ok":true}""")))
    }

    @Test
    fun reasonIsTruncatedAndNonStringRejected() {
        val longReason = "x".repeat(MIXER_MAX_REASON + 40)
        val state = parseMixerState(
            json("""{"available":false,"sessions":[],"reason":"$longReason","updatedAt":1}"""),
        )
        assertEquals(MIXER_MAX_REASON, state!!.reason!!.length)

        val numeric = parseMixerState(
            json("""{"available":false,"sessions":[],"reason":7,"updatedAt":1}"""),
        )
        assertNull(numeric!!.reason)
    }

    @Test
    fun sessionArraysAreNotAffectedByOtherFields() {
        val state = parseMixerState(
            json(
                """
                    {
                      "available": true,
                      "updatedAt": 99,
                      "sessions": [
                        {
                          "id": "s",
                          "process": "a.exe",
                          "name": "A",
                          "volume": 1,
                          "muted": false,
                          "futureField": {"nested": true}
                        }
                      ],
                      "futureField": true
                    }
                """.trimIndent(),
            ),
        )
        assertEquals(1, state!!.sessions.size)
        assertEquals(1, state.sessions.single().volume)
    }

    @Test
    fun capabilitiesComeFromHello() {
        val capabilities = parseCapabilities(
            json("""{"type":"hello","capabilities":["mixer-v1","input-v1"]}"""),
        )
        assertTrue("mixer-v1" in capabilities)

        val oldServer = parseCapabilities(json("""{"type":"hello"}"""))
        assertFalse("mixer-v1" in oldServer)

        // A session list never implies capability; only hello does.
        assertEquals(
            emptySet<String>(),
            parseCapabilities(json("""{"sessions":[],"capabilities":[]}""")),
        )
    }
}
