package com.phonedek.app.net

import com.phonedek.app.data.DeckJson
import com.phonedek.app.data.DeviceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeckConnectionRigTest {
    @Test
    fun helloAdvertisesRigProgressSupport() {
        assertTrue("rig-v1" in CLIENT_CAPABILITIES)
        val payload = buildHelloPayload(
            DeviceInfo(name = "Phone", model = "Pixel", appVersion = "0.14.0"),
        )
        val capabilities = (payload["capabilities"] as kotlinx.serialization.json.JsonArray)
            .map { (it as kotlinx.serialization.json.JsonPrimitive).content }
        assertTrue("rig-v1" in capabilities)
    }

    @Test
    fun parsesStartStepAndDoneFrames() {
        val start = DeckJson.parseRigProgress(
            """
                {
                  "type": "rigProgress",
                  "phase": "start",
                  "presetId": "rig-1",
                  "buttonId": "btn-run",
                  "index": 0,
                  "total": 9,
                  "label": "Go live"
                }
            """.trimIndent(),
        )
        assertNotNull(start)
        assertEquals("rig-1", start!!.presetId)
        assertEquals("btn-run", start.buttonId)
        assertEquals("start", start.phase)
        assertEquals(0, start.index)
        assertEquals(9, start.total)
        assertEquals("Go live", start.label)

        val step = DeckJson.parseRigProgress(
            """
                {
                  "type": "rigProgress",
                  "phase": "step",
                  "presetId": "rig-1",
                  "index": 3,
                  "total": 9,
                  "label": "Start stream",
                  "ok": true,
                  "durationMs": 1250,
                  "futureField": { "anything": true }
                }
            """.trimIndent(),
        )
        assertNotNull(step)
        assertEquals("step", step!!.phase)
        assertEquals(3, step.index)
        assertEquals("Start stream", step.label)
        assertEquals(true, step.ok)
        assertEquals(1250L, step.durationMs)

        val done = DeckJson.parseRigProgress(
            """
                {
                  "type": "rigProgress",
                  "phase": "done",
                  "presetId": "rig-1",
                  "index": 9,
                  "total": 9,
                  "status": "partial",
                  "ok": false,
                  "error": "OBS refused one step",
                  "durationMs": 42000
                }
            """.trimIndent(),
        )
        assertNotNull(done)
        assertEquals("done", done!!.phase)
        assertEquals("partial", done.status)
        assertEquals(false, done.ok)
        assertEquals("OBS refused one step", done.error)
        assertEquals(42000L, done.durationMs)
    }

    @Test
    fun malformedFramesAreDropped() {
        val cases = listOf(
            "not json",
            // No preset id: the frame cannot be matched to any tile.
            """{"phase":"start","index":0,"total":3}""",
            """{"phase":"start","presetId":"  ","index":0,"total":3}""",
            // Unknown phase.
            """{"phase":"progress","presetId":"rig-1","index":0,"total":3}""",
            // Missing/negative/impossible step counters.
            """{"phase":"step","presetId":"rig-1","index":1}""",
            """{"phase":"step","presetId":"rig-1","total":3}""",
            """{"phase":"step","presetId":"rig-1","index":-1,"total":3}""",
            """{"phase":"step","presetId":"rig-1","index":0,"total":3}""",
            """{"phase":"done","presetId":"rig-1","index":4,"total":3}""",
            """{"phase":"start","presetId":"rig-1","index":0,"total":0}""",
            """{"phase":"start","presetId":"rig-1","index":2,"total":3}""",
            """{"phase":"start","presetId":"rig-1","index":0,"total":33}""",
        )
        cases.forEach { raw ->
            assertNull("expected frame to be dropped: $raw", DeckJson.parseRigProgress(raw))
        }
    }

    @Test
    fun unknownFieldsAndStatusAreTolerated() {
        val frame = DeckJson.parseRigProgress(
            """
                {
                  "type": "rigProgress",
                  "phase": "DONE",
                  "presetId": " rig-1 ",
                  "index": 3,
                  "total": 3,
                  "status": "future-status",
                  "futureField": "ignored"
                }
            """.trimIndent(),
        )
        assertNotNull(frame)
        assertEquals("rig-1", frame!!.presetId)
        assertEquals("done", frame.phase)
        assertNull(frame.status)
        assertFalse(frame.phase == "step")
    }
}
