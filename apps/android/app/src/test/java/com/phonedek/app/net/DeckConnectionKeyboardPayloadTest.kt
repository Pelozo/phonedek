package com.phonedek.app.net

import com.phonedek.app.data.DeviceInfo
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeckConnectionKeyboardPayloadTest {
    @Test
    fun helloAdvertisesKeyboardCapability() {
        val capabilities = parseCapabilities(
            buildHelloPayload(
                DeviceInfo(name = "Phone", model = "Android", appVersion = "test"),
            ),
        )

        assertTrue("keyboard-v1" in capabilities)
        assertTrue("pointer-v1" in capabilities)
    }

    @Test
    fun startCarriesOnlyIds() {
        val payload = buildKeyboardPayload(
            seq = 70,
            phase = "start",
            profileId = "p1",
            pageId = "pg1",
            controlId = "btn-kbd",
            text = "ignored",
            keys = listOf("A"),
            repeat = 4,
        )

        assertEquals("keyboard", payload.text("type"))
        assertEquals(70L, payload.long("seq"))
        assertEquals("start", payload.text("phase"))
        assertEquals("p1", payload.text("profileId"))
        assertEquals("pg1", payload.text("pageId"))
        assertEquals("btn-kbd", payload.text("controlId"))
        assertNull(payload["text"])
        assertNull(payload["keys"])
        assertNull(payload["repeat"])
    }

    @Test
    fun textCarriesNoIdsKeysOrRepeat() {
        val payload = buildKeyboardPayload(
            seq = 71,
            phase = "text",
            profileId = "p1",
            pageId = "pg1",
            controlId = "btn-kbd",
            text = "Hello world\n",
            keys = listOf("A"),
            repeat = 2,
        )

        assertEquals("text", payload.text("phase"))
        assertEquals("Hello world\n", payload.text("text"))
        assertNull(payload["profileId"])
        assertNull(payload["pageId"])
        assertNull(payload["controlId"])
        assertNull(payload["keys"])
        assertNull(payload["repeat"])
    }

    @Test
    fun textIsBoundedTo4096UnitsWithoutSplittingSurrogates() {
        val ascii = buildKeyboardPayload(seq = 1, phase = "text", text = "a".repeat(5000))
        assertEquals(4096, ascii.text("text")!!.length)

        // 4095 ASCII units then an emoji (a surrogate pair) straddling the cap.
        val prefix = "a".repeat(4095)
        val emoji = "\uD83D\uDE00"
        val clipped = boundedKeyboardText(prefix + emoji)
        assertEquals(4095, clipped.length)
        assertEquals(prefix, clipped)
        assertEquals("complete text is untouched", "ok", boundedKeyboardText("ok"))
    }

    @Test
    fun keyCarriesClampedKeysAndRepeat() {
        val payload = buildKeyboardPayload(
            seq = 72,
            phase = "key",
            profileId = "p1",
            text = "ignored",
            keys = listOf(
                "ctrl",
                "c",
                "C",
                "alt",
                "shift",
                "win",
                "tab",
                "esc",
                "left",
            ),
            repeat = 500,
        )

        assertEquals("key", payload.text("phase"))
        assertNull(payload["text"])
        assertNull(payload["profileId"])
        val keys = payload["keys"] as JsonArray
        assertEquals(8, keys.size)
        assertEquals("CTRL", (keys[0] as JsonPrimitive).content)
        assertEquals("C", (keys[1] as JsonPrimitive).content)
        assertEquals("ALT", (keys[2] as JsonPrimitive).content)
        assertEquals("SHIFT", (keys[3] as JsonPrimitive).content)
        assertEquals("WIN", (keys[4] as JsonPrimitive).content)
        assertEquals(100, payload.int("repeat"))
    }

    @Test
    fun keyRepeatIsAtLeastOneAndOmittedWhenNotGiven() {
        val low = buildKeyboardPayload(
            seq = 73,
            phase = "key",
            keys = listOf("BACKSPACE"),
            repeat = 0,
        )
        assertEquals("BACKSPACE", ((low["keys"] as JsonArray)[0] as JsonPrimitive).content)
        assertEquals(1, low.int("repeat"))

        val none = buildKeyboardPayload(seq = 74, phase = "key", keys = listOf("TAB"))
        assertNull(none["repeat"])
    }

    @Test
    fun emptyOrInvalidKeysAreDropped() {
        val payload = buildKeyboardPayload(
            seq = 75,
            phase = "key",
            keys = listOf("   ", "x".repeat(30)),
        )
        assertNull(payload["keys"])
    }

    @Test
    fun simplePhasesCarryNoPayload() {
        for (phase in listOf("release", "end", "cancel")) {
            val payload = buildKeyboardPayload(
                seq = 76,
                phase = phase,
                profileId = "p1",
                pageId = "pg1",
                controlId = "btn-kbd",
                text = "leak",
                keys = listOf("A"),
                repeat = 3,
            )
            assertEquals(phase, payload.text("phase"))
            assertEquals(76L, payload.long("seq"))
            assertNull(payload["profileId"])
            assertNull(payload["pageId"])
            assertNull(payload["controlId"])
            assertNull(payload["text"])
            assertNull(payload["keys"])
            assertNull(payload["repeat"])
        }
    }

    @Test
    fun invalidPhaseFallsBackToCancel() {
        val payload = buildKeyboardPayload(seq = 1, phase = "type", text = "ignored")
        assertEquals("cancel", payload.text("phase"))
        assertNull(payload["text"])
    }

    @Test
    fun negativeSeqIsClamped() {
        val payload = buildKeyboardPayload(seq = -9, phase = "release")
        assertEquals(0L, payload.long("seq"))
    }

    @Test
    fun parsesKeyboardResult() {
        val failure = parseKeyboardResult(
            buildJsonObject {
                put("seq", 71)
                put("ok", false)
                put("error", "Keyboard control is suspended while a dialog is open on the PC.")
            },
        )
        assertEquals(71L, failure.seq)
        assertFalse(failure.ok)
        assertEquals(
            "Keyboard control is suspended while a dialog is open on the PC.",
            failure.error,
        )

        val success = parseKeyboardResult(
            buildJsonObject {
                put("seq", 70)
                put("ok", true)
            },
        )
        assertEquals(70L, success.seq)
        assertTrue(success.ok)
        assertNull(success.error)
    }

    private fun JsonObject.text(key: String): String? =
        (this[key] as? JsonPrimitive)?.contentOrNull

    private fun JsonObject.long(key: String): Long? =
        (this[key] as? JsonPrimitive)?.long

    private fun JsonObject.int(key: String): Int? =
        (this[key] as? JsonPrimitive)?.int
}
