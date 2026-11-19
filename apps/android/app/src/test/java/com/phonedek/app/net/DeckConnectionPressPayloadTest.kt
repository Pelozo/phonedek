package com.phonedek.app.net

import com.phonedek.app.data.DeckJson
import com.phonedek.app.ui.ControlStateStore
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeckConnectionPressPayloadTest {
    @Test
    fun rigActionTilePressesByIdSoTheDesktopRunsThePreset() {
        val button = DeckJson.parse(
            """
                {
                  "profiles": [{
                    "id": "p1",
                    "pages": [{
                      "id": "pg1",
                      "buttons": [{
                        "id": "btn-rig",
                        "slot": 0,
                        "label": "Go live",
                        "actions": [{ "type": "rig", "action": "run", "presetId": "rig-1" }]
                      }]
                    }]
                  }]
                }
            """.trimIndent(),
        )!!.profiles.single().pages.single().buttons.single()

        // A rig button is an ordinary tap tile: the phone forwards the button
        // id and the desktop resolves the preset from its own config.
        assertTrue(ControlStateStore.hasRigAction(button))
        assertEquals("rig-1", ControlStateStore.rigActionPreset(button.actions))

        val payload = buildPressPayload(
            requestId = "r-rig",
            profileId = "p1",
            pageId = "pg1",
            buttonId = button.id,
        )

        assertEquals("press", (payload["type"] as JsonPrimitive).contentOrNull)
        assertEquals("r-rig", (payload["requestId"] as JsonPrimitive).contentOrNull)
        assertEquals("p1", (payload["profileId"] as JsonPrimitive).contentOrNull)
        assertEquals("pg1", (payload["pageId"] as JsonPrimitive).contentOrNull)
        assertEquals("btn-rig", (payload["buttonId"] as JsonPrimitive).contentOrNull)
    }

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

    @Test
    fun audioDeviceActionTilePressesByIdSoTheDesktopSwitchesTheDevice() {
        val button = DeckJson.parse(
            """
                {
                  "profiles": [{
                    "id": "p1",
                    "pages": [{
                      "id": "pg1",
                      "buttons": [{
                        "id": "btn-audio",
                        "slot": 0,
                        "label": "Headset",
                        "actions": [{
                          "type": "audioDevice",
                          "action": "set",
                          "kind": "output",
                          "device": { "id": "a1b2c3d4", "name": "HyperX Cloud II" }
                        }]
                      }]
                    }]
                  }]
                }
            """.trimIndent(),
        )!!.profiles.single().pages.single().buttons.single()

        // The phone never talks to its own AudioManager; it forwards the tile
        // id and the desktop resolves the configured target.
        assertEquals("audioDevice", button.actions.single().type)
        assertEquals("set", button.actions.single().action)
        assertEquals("output", button.actions.single().kind)
        assertTrue(ControlStateStore.hasAudioDeviceAction(button.actions))

        val payload = buildPressPayload(
            requestId = "r-audio",
            profileId = "p1",
            pageId = "pg1",
            buttonId = button.id,
        )

        assertEquals("press", (payload["type"] as JsonPrimitive).contentOrNull)
        assertEquals("r-audio", (payload["requestId"] as JsonPrimitive).contentOrNull)
        assertEquals("p1", (payload["profileId"] as JsonPrimitive).contentOrNull)
        assertEquals("pg1", (payload["pageId"] as JsonPrimitive).contentOrNull)
        assertEquals("btn-audio", (payload["buttonId"] as JsonPrimitive).contentOrNull)
    }
}
