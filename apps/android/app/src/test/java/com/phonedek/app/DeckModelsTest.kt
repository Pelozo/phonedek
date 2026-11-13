package com.phonedek.app

import androidx.compose.ui.graphics.Color
import com.phonedek.app.data.BackgroundDto
import com.phonedek.app.data.DeckJson
import com.phonedek.app.data.GridDto
import com.phonedek.app.data.GridSettings
import com.phonedek.app.data.Pairing
import com.phonedek.app.data.pageGrid
import com.phonedek.app.ui.BackgroundSpec
import com.phonedek.app.ui.backgroundSpec
import com.phonedek.app.util.parseEndpoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeckModelsTest {
    @Test
    fun parsesPartialConfigAndIgnoresUnknownFields() {
        val raw = """
            {
              "schemaVersion": 1,
              "serverName": "Desk",
              "defaultProfileId": "p1",
              "futureField": { "anything": true },
              "profiles": [{
                "id": "p1",
                "name": "Desk",
                "grid": { "columns": 2, "rows": 2, "gap": 8, "padding": 10 },
                "theme": { "textColor": "#abc", "fontSize": 14, "buttonRadius": 12 },
                "defaultPageId": "main",
                "pages": [{
                  "id": "main",
                  "name": "Main",
                  "buttons": [{
                    "id": "b1",
                    "slot": 3,
                    "label": "Copy",
                    "icon": "📋",
                    "background": { "type": "gradient", "from": "#065f46", "to": "#059669" },
                    "actions": [
                      { "type": "hotkey", "keys": ["CTRL", "C"], "holdMs": 50 },
                      { "type": "page", "direction": "next" }
                    ]
                  }]
                }]
              }]
            }
        """.trimIndent()

        val config = DeckJson.parse(raw)
        assertNotNull(config)
        val profile = config!!.profiles.single()
        assertEquals("p1", profile.id)
        assertEquals(2, profile.grid.columns)
        assertEquals(1, profile.pages.size)
        assertEquals("b1", profile.pages.single().buttons.single().id)
        assertEquals("page", profile.pages.single().buttons.single().actions[1].type)
        assertEquals(3, profile.pages.single().buttons.single().slot)
        assertEquals("📋", profile.pages.single().buttons.single().icon)
        assertNull(profile.pages.single().buttons.single().iconMedia)
        assertEquals("gradient", profile.pages.single().buttons.single().background?.type)
        assertNull(profile.pages.single().grid)
        assertEquals(profile.grid, pageGrid(profile, profile.pages.single()))
        assertNull(profile.pages.single().buttons.single().control)
        assertNull(profile.pages.single().buttons.single().state)
        assertNull(profile.pages.single().buttons.single().span)
    }

    @Test
    fun parsesSliderControlAndColumnSpan() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "grid": { "columns": 5, "rows": 3, "gap": 8, "padding": 10 },
                "pages": [{
                  "id": "page",
                  "buttons": [{
                    "id": "volume",
                    "slot": 0,
                    "label": "Volume",
                    "control": {
                      "kind": "slider",
                      "axis": "horizontal",
                      "emit": "delta",
                      "binding": { "type": "volume", "mode": "relative", "stepPercent": 3 },
                      "min": 0,
                      "max": 100,
                      "step": 5,
                      "initial": 40,
                      "unit": "%",
                      "haptics": false
                    },
                    "span": { "columns": 3, "rows": 1 }
                  }]
                }]
              }]
            }
        """.trimIndent()

        val button = DeckJson.parse(raw)!!.profiles.single().pages.single().buttons.single()
        val control = button.control!!
        assertEquals("slider", control.kind)
        assertEquals("horizontal", control.axis)
        assertEquals("delta", control.emit)
        assertEquals("volume", control.binding.type)
        assertEquals("relative", control.binding.mode)
        assertEquals(3, control.binding.stepPercent)
        assertEquals(0f, control.min!!, 0.001f)
        assertEquals(100f, control.max!!, 0.001f)
        assertEquals(5f, control.step!!, 0.001f)
        assertEquals(40f, control.initial!!, 0.001f)
        assertEquals("%", control.unit)
        assertFalse(control.haptics)
        assertEquals(3, button.span!!.columns)
        assertEquals(1, button.span!!.rows)
    }

    @Test
    fun parsesDialScrollControlWithDefaults() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [{
                    "id": "scroll",
                    "slot": 0,
                    "control": {
                      "kind": "dial",
                      "emit": "delta",
                      "binding": { "type": "scroll", "axis": "vertical", "invert": true }
                    }
                  }]
                }]
              }]
            }
        """.trimIndent()

        val control = DeckJson.parse(raw)!!.profiles.single().pages.single()
            .buttons.single().control!!
        assertEquals("dial", control.kind)
        assertEquals("scroll", control.binding.type)
        assertEquals("vertical", control.binding.axis)
        assertEquals(true, control.binding.invert)
        assertEquals(0f, control.min!!, 0.001f)
        assertEquals(100f, control.max!!, 0.001f)
        assertEquals(1f, control.step!!, 0.001f)
        assertEquals(50f, control.initial!!, 0.001f)
        assertTrue(control.haptics)
    }

    @Test
    fun parsesAbsoluteVolumeControlWithDefaults() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [{
                    "id": "absolute",
                    "slot": 0,
                    "label": "Volume",
                    "control": {
                      "kind": "slider",
                      "emit": "value",
                      "binding": { "type": "volume", "mode": "absolute" }
                    }
                  }]
                }]
              }]
            }
        """.trimIndent()

        val control = DeckJson.parse(raw)!!.profiles.single().pages.single()
            .buttons.single().control
        assertNotNull(control)
        assertEquals("slider", control!!.kind)
        assertEquals("value", control.emit)
        assertEquals("volume", control.binding.type)
        assertEquals("absolute", control.binding.mode)
        assertNull(control.binding.stepPercent)
        assertEquals(0f, control.min!!, 0.001f)
        assertEquals(100f, control.max!!, 0.001f)
        assertEquals(1f, control.step!!, 0.001f)
        assertEquals(50f, control.initial!!, 0.001f)
        assertEquals("%", control.unit)
    }

    @Test
    fun parsesMicGainControlWithDefaults() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [{
                    "id": "mic",
                    "slot": 0,
                    "label": "Mic",
                    "control": {
                      "kind": "slider",
                      "emit": "value",
                      "binding": { "type": "mic", "mode": "gain" },
                      "min": 0,
                      "max": 100,
                      "step": 1,
                      "initial": 50,
                      "unit": "%"
                    },
                    "actions": [{ "type": "mic", "action": "toggleMute" }]
                  }]
                }]
              }]
            }
        """.trimIndent()

        val button = DeckJson.parse(raw)!!.profiles.single().pages.single()
            .buttons.single()
        val control = button.control!!
        assertEquals("slider", control.kind)
        assertEquals("value", control.emit)
        assertEquals("mic", control.binding.type)
        assertEquals("gain", control.binding.mode)
        assertEquals(0f, control.min!!, 0.001f)
        assertEquals(100f, control.max!!, 0.001f)
        assertEquals(1f, control.step!!, 0.001f)
        assertEquals(50f, control.initial!!, 0.001f)
        assertEquals("%", control.unit)
        assertEquals("mic", button.actions.single().type)
        assertEquals("toggleMute", button.actions.single().action)
    }

    @Test
    fun micDefaultsPercentWhenUnitIsMissing() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [{
                    "id": "mic",
                    "slot": 0,
                    "control": {
                      "kind": "dial",
                      "emit": "value",
                      "binding": { "type": "mic", "mode": "gain" }
                    }
                  }]
                }]
              }]
            }
        """.trimIndent()

        val control = DeckJson.parse(raw)!!.profiles.single().pages.single()
            .buttons.single().control!!
        assertEquals("dial", control.kind)
        assertEquals("%", control.unit)
        assertEquals(50f, control.initial!!, 0.001f)
    }

    @Test
    fun micRequiresValueEmitAndGainMode() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [
                    {
                      "id": "delta",
                      "slot": 0,
                      "control": {
                        "kind": "slider",
                        "emit": "delta",
                        "binding": { "type": "mic", "mode": "gain" }
                      }
                    },
                    {
                      "id": "bad-mode",
                      "slot": 1,
                      "control": {
                        "kind": "slider",
                        "emit": "value",
                        "binding": { "type": "mic", "mode": "relative" }
                      }
                    }
                  ]
                }]
              }]
            }
        """.trimIndent()

        val buttons = DeckJson.parse(raw)!!.profiles.single().pages.single().buttons
        assertNull(buttons.first { it.id == "delta" }.control)
        assertNull(buttons.first { it.id == "bad-mode" }.control)
    }

    @Test
    fun absoluteVolumeRequiresValueEmit() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [{
                    "id": "bad",
                    "slot": 0,
                    "control": {
                      "kind": "slider",
                      "emit": "delta",
                      "binding": { "type": "volume", "mode": "absolute" }
                    }
                  }]
                }]
              }]
            }
        """.trimIndent()

        assertNull(
            DeckJson.parse(raw)!!.profiles.single().pages.single()
                .buttons.single().control,
        )
    }

    @Test
    fun parsesShortcutWheelWithChordsAndDefaults() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "grid": { "columns": 5, "rows": 3, "gap": 8, "padding": 10 },
                "pages": [{
                  "id": "page",
                  "buttons": [{
                    "id": "tabs",
                    "slot": 0,
                    "label": "Tabs",
                    "control": {
                      "kind": "slider",
                      "axis": "horizontal",
                      "emit": "delta",
                      "binding": {
                        "type": "shortcut",
                        "keys": ["TAB", "control"],
                        "reverseKeys": ["shift", "TAB"],
                        "holdKeys": ["option"],
                        "repeat": 2,
                        "travelSteps": 12
                      },
                      "unit": "%"
                    },
                    "span": { "columns": 3, "rows": 1 }
                  }]
                }]
              }]
            }
        """.trimIndent()

        val button = DeckJson.parse(raw)!!.profiles.single().pages.single().buttons.single()
        val control = button.control!!
        assertEquals("slider", control.kind)
        assertEquals("delta", control.emit)
        assertEquals("shortcut", control.binding.type)
        assertEquals(listOf("CTRL", "TAB"), control.binding.keys)
        assertEquals(listOf("SHIFT", "TAB"), control.binding.reverseKeys)
        assertEquals(listOf("ALT"), control.binding.holdKeys)
        assertEquals(2, control.binding.repeat)
        assertEquals(12, control.binding.travelSteps)
        assertEquals(0f, control.min!!, 0.001f)
        assertEquals(100f, control.max!!, 0.001f)
        assertEquals(1f, control.step!!, 0.001f)
        assertEquals(50f, control.initial!!, 0.001f)
        assertNull(control.unit)
        // A key wheel keeps its authored footprint; it must not collapse to 1x1.
        assertEquals(3, button.span!!.columns)
        assertEquals(1, button.span!!.rows)
    }

    @Test
    fun shortcutDialFillsOptionalDefaults() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [{
                    "id": "switcher",
                    "slot": 0,
                    "control": {
                      "kind": "dial",
                      "emit": "delta",
                      "binding": {
                        "type": "shortcut",
                        "keys": ["win", "TAB"]
                      }
                    }
                  }]
                }]
              }]
            }
        """.trimIndent()

        val control = DeckJson.parse(raw)!!.profiles.single().pages.single()
            .buttons.single().control!!
        assertEquals("dial", control.kind)
        assertEquals("shortcut", control.binding.type)
        assertEquals(listOf("WIN", "TAB"), control.binding.keys)
        assertTrue(control.binding.reverseKeys.isEmpty())
        assertTrue(control.binding.holdKeys.isEmpty())
        assertEquals(1, control.binding.repeat)
        assertEquals(20, control.binding.travelSteps)
        assertEquals(0f, control.min!!, 0.001f)
        assertEquals(100f, control.max!!, 0.001f)
        assertEquals(1f, control.step!!, 0.001f)
        assertEquals(50f, control.initial!!, 0.001f)
        assertEquals("", control.unit.orEmpty())
    }

    @Test
    fun shortcutRequiresDeltaEmitAndValidKeys() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [
                    {
                      "id": "bad-emit",
                      "slot": 0,
                      "control": {
                        "kind": "slider",
                        "emit": "value",
                        "binding": { "type": "shortcut", "keys": ["CTRL", "TAB"] }
                      }
                    },
                    {
                      "id": "missing-keys",
                      "slot": 1,
                      "control": {
                        "kind": "slider",
                        "emit": "delta",
                        "binding": { "type": "shortcut" }
                      }
                    },
                    {
                      "id": "bad-key",
                      "slot": 2,
                      "control": {
                        "kind": "dial",
                        "emit": "delta",
                        "binding": { "type": "shortcut", "keys": ["CTRL", "NOPE"] }
                      }
                    },
                    {
                      "id": "bad-reverse",
                      "slot": 3,
                      "control": {
                        "kind": "dial",
                        "emit": "delta",
                        "binding": {
                          "type": "shortcut",
                          "keys": ["CTRL", "TAB"],
                          "reverseKeys": ["BOGUS"]
                        }
                      }
                    },
                    {
                      "id": "bad-hold",
                      "slot": 4,
                      "control": {
                        "kind": "dial",
                        "emit": "delta",
                        "binding": {
                          "type": "shortcut",
                          "keys": ["CTRL", "TAB"],
                          "holdKeys": [""]
                        }
                      }
                    },
                    {
                      "id": "too-many-keys",
                      "slot": 5,
                      "control": {
                        "kind": "dial",
                        "emit": "delta",
                        "binding": {
                          "type": "shortcut",
                          "keys": ["A", "B", "C", "D", "E", "F", "G", "H", "I"]
                        }
                      }
                    }
                  ]
                }]
              }]
            }
        """.trimIndent()

        val buttons = DeckJson.parse(raw)!!.profiles.single().pages.single().buttons
        buttons.forEach { button ->
            assertNull("expected ${button.id} to be dropped", button.control)
        }
    }

    @Test
    fun parsesObsInputVolumeControl() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [{
                    "id": "obs",
                    "slot": 0,
                    "label": "Mic/Aux",
                    "control": {
                      "kind": "slider",
                      "axis": "horizontal",
                      "emit": "value",
                      "binding": {
                        "type": "obs",
                        "target": "inputVolume",
                        "input": "Mic/Aux"
                      },
                      "min": 0,
                      "max": 200,
                      "step": 1,
                      "initial": 100,
                      "unit": "%",
                      "haptics": true
                    },
                    "actions": [
                      { "type": "obs", "action": "toggleMute", "input": "Mic/Aux" }
                    ]
                  }]
                }]
              }]
            }
        """.trimIndent()

        val button = DeckJson.parse(raw)!!.profiles.single().pages.single()
            .buttons.single()
        val control = button.control!!
        assertEquals("slider", control.kind)
        assertEquals("value", control.emit)
        assertEquals("obs", control.binding.type)
        assertEquals("inputVolume", control.binding.target)
        assertEquals("Mic/Aux", control.binding.input)
        assertEquals(0f, control.min!!, 0.001f)
        assertEquals(200f, control.max!!, 0.001f)
        assertEquals(1f, control.step!!, 0.001f)
        assertEquals(100f, control.initial!!, 0.001f)
        assertEquals("%", control.unit)
        assertEquals("obs", button.actions.single().type)
        assertEquals("toggleMute", button.actions.single().action)
    }

    @Test
    fun obsDefaultsToUnityAndFullRangeWhenFieldsAreMissing() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [{
                    "id": "obs",
                    "slot": 0,
                    "control": {
                      "kind": "dial",
                      "emit": "value",
                      "binding": { "type": "obs", "target": "inputVolume" }
                    }
                  }]
                }]
              }]
            }
        """.trimIndent()

        val control = DeckJson.parse(raw)!!.profiles.single().pages.single()
            .buttons.single().control!!
        assertEquals("dial", control.kind)
        assertEquals(0f, control.min!!, 0.001f)
        assertEquals(200f, control.max!!, 0.001f)
        assertEquals(1f, control.step!!, 0.001f)
        assertEquals(100f, control.initial!!, 0.001f)
        assertEquals("%", control.unit)
        assertNull(control.binding.input)
    }

    @Test
    fun obsRequiresInputVolumeTargetValueEmitAndNoMode() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [
                    {
                      "id": "bad-target",
                      "slot": 0,
                      "control": {
                        "kind": "slider",
                        "emit": "value",
                        "binding": { "type": "obs", "target": "inputMute" }
                      }
                    },
                    {
                      "id": "bad-mode",
                      "slot": 1,
                      "control": {
                        "kind": "slider",
                        "emit": "value",
                        "binding": {
                          "type": "obs",
                          "target": "inputVolume",
                          "mode": "relative"
                        }
                      }
                    },
                    {
                      "id": "bad-emit",
                      "slot": 2,
                      "control": {
                        "kind": "slider",
                        "emit": "delta",
                        "binding": { "type": "obs", "target": "inputVolume" }
                      }
                    }
                  ]
                }]
              }]
            }
        """.trimIndent()

        val buttons = DeckJson.parse(raw)!!.profiles.single().pages.single().buttons
        assertNull(buttons.first { it.id == "bad-target" }.control)
        assertNull(buttons.first { it.id == "bad-mode" }.control)
        assertNull(buttons.first { it.id == "bad-emit" }.control)
    }

    @Test
    fun parsesEveryObsStateTargetOnPlainButtons() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [
                    { "id": "stream", "slot": 0, "label": "Stream", "state": { "type": "obs", "target": "streaming" } },
                    { "id": "record", "slot": 1, "state": { "type": "obs", "target": "recording" } },
                    { "id": "replay", "slot": 2, "state": { "type": "obs", "target": "replay" } },
                    { "id": "cam", "slot": 3, "state": { "type": "obs", "target": "virtualCam" } },
                    { "id": "scene", "slot": 4, "state": { "type": "obs", "target": "scene", "scene": "Game" } },
                    { "id": "mute", "slot": 5, "state": { "type": "obs", "target": "inputMute", "input": "Mic/Aux" } },
                    { "id": "volume", "slot": 6, "state": { "type": "obs", "target": "inputVolume", "input": "Desktop" } }
                  ]
                }]
              }]
            }
        """.trimIndent()

        val buttons = DeckJson.parse(raw)!!.profiles.single().pages.single().buttons
        assertEquals(
            listOf(
                "streaming",
                "recording",
                "replay",
                "virtualCam",
                "scene",
                "inputMute",
                "inputVolume",
            ),
            buttons.map { it.state!!.target },
        )
        assertTrue(buttons.all { it.state!!.type == "obs" })
        assertTrue(buttons.all { it.control == null })
        assertEquals("Game", buttons.first { it.id == "scene" }.state!!.scene)
        assertEquals("Mic/Aux", buttons.first { it.id == "mute" }.state!!.input)
        assertEquals("Desktop", buttons.first { it.id == "volume" }.state!!.input)
    }

    @Test
    fun rejectsUnknownObsStateTypesAndTargets() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [
                    { "id": "bad-type", "slot": 0, "label": "Keep", "state": { "type": "volume", "target": "streaming" } },
                    { "id": "bad-target", "slot": 1, "label": "Keep", "state": { "type": "obs", "target": "mic" } },
                    { "id": "empty", "slot": 2, "state": { "type": "", "target": "" } }
                  ]
                }]
              }]
            }
        """.trimIndent()

        val buttons = DeckJson.parse(raw)!!.profiles.single().pages.single().buttons
        assertEquals(3, buttons.size)
        buttons.forEach { button ->
            assertNull("expected ${button.id} state to be dropped", button.state)
        }
        assertEquals("Keep", buttons.first { it.id == "bad-type" }.label)
        assertEquals("Keep", buttons.first { it.id == "bad-target" }.label)
    }

    @Test
    fun parsesEveryTwitchStateTargetOnPlainButtons() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [
                    { "id": "live", "slot": 0, "label": "Live", "state": { "type": "twitch", "target": "live" } },
                    { "id": "viewers", "slot": 1, "state": { "type": "twitch", "target": "viewers" } },
                    { "id": "uptime", "slot": 2, "state": { "type": "twitch", "target": "uptime" } },
                    { "id": "title", "slot": 3, "state": { "type": "twitch", "target": "title", "scene": "ignored", "input": "ignored" } },
                    { "id": "game", "slot": 4, "state": { "type": "twitch", "target": "game" } }
                  ]
                }]
              }]
            }
        """.trimIndent()

        val buttons = DeckJson.parse(raw)!!.profiles.single().pages.single().buttons
        assertEquals(
            listOf("live", "viewers", "uptime", "title", "game"),
            buttons.map { it.state!!.target },
        )
        assertTrue(buttons.all { it.state!!.type == "twitch" })
        assertTrue(buttons.all { it.control == null })
        // Helix targets carry no OBS scene/input hints.
        assertTrue(buttons.all { it.state!!.scene == null && it.state!!.input == null })
    }

    @Test
    fun rejectsUnknownTwitchStateTargetsAndTypes() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [
                    { "id": "bad-target", "slot": 0, "label": "Keep", "state": { "type": "twitch", "target": "followers" } },
                    { "id": "obs-target", "slot": 1, "label": "Keep", "state": { "type": "twitch", "target": "streaming" } },
                    { "id": "bad-type", "slot": 2, "label": "Keep", "state": { "type": "youtube", "target": "live" } },
                    { "id": "empty", "slot": 3, "state": { "type": "twitch", "target": "" } }
                  ]
                }]
              }]
            }
        """.trimIndent()

        val buttons = DeckJson.parse(raw)!!.profiles.single().pages.single().buttons
        assertEquals(4, buttons.size)
        buttons.forEach { button ->
            assertNull("expected ${button.id} state to be dropped", button.state)
            // The rest of the tile is still valid and tappable.
            if (button.id != "empty") assertEquals("Keep", button.label)
            assertNull(button.control)
        }
    }

    @Test
    fun unsupportedControlFallsBackToATapTile() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [
                    {
                      "id": "absolute",
                      "slot": 0,
                      "icon": "🔊",
                      "control": {
                        "kind": "slider",
                        "emit": "value",
                        "binding": { "type": "volume", "mode": "relative" }
                      }
                    },
                    {
                      "id": "unknown",
                      "slot": 1,
                      "icon": "?",
                      "control": {
                        "kind": "dial",
                        "emit": "delta",
                        "binding": { "type": "brightness" }
                      }
                    }
                  ]
                }]
              }]
            }
        """.trimIndent()

        val buttons = DeckJson.parse(raw)!!.profiles.single().pages.single().buttons
        assertNull(buttons.first { it.id == "absolute" }.control)
        assertNull(buttons.first { it.id == "unknown" }.control)
        assertEquals("🔊", buttons.first { it.id == "absolute" }.icon)
    }

    @Test
    fun spanningButtonsOccupyTheirCellsAndRejectOverlaps() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "grid": { "columns": 4, "rows": 2, "gap": 4, "padding": 4 },
                "pages": [{
                  "id": "page",
                  "buttons": [
                    { "id": "wide", "slot": 0, "span": { "columns": 2, "rows": 2 } },
                    { "id": "overlap", "slot": 1 },
                    { "id": "below", "slot": 5 },
                    { "id": "free", "slot": 2 },
                    { "id": "out", "slot": 99 }
                  ]
                }]
              }]
            }
        """.trimIndent()

        val buttons = DeckJson.parse(raw)!!.profiles.single().pages.single().buttons
        assertEquals(listOf("wide", "free"), buttons.map { it.id })
        assertEquals(2, buttons.first().span!!.columns)
        assertEquals(2, buttons.first().span!!.rows)
    }

    @Test
    fun parsesPerPageGridOverride() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "grid": { "columns": 5, "rows": 3, "gap": 12, "padding": 14 },
                "pages": [{
                  "id": "page",
                  "grid": { "columns": 3, "rows": 4, "gap": 8, "padding": 10 }
                }]
              }]
            }
        """.trimIndent()

        val profile = DeckJson.parse(raw)!!.profiles.single()
        val page = profile.pages.single()
        assertEquals(GridDto(columns = 3, rows = 4, gap = 8, padding = 10), page.grid)
        assertEquals(GridSettings(columns = 3, rows = 4, gap = 8, padding = 10), pageGrid(profile, page))
    }

    @Test
    fun pageWithoutGridInheritsProfileGrid() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "grid": { "columns": 4, "rows": 2, "gap": 6, "padding": 9 },
                "pages": [{ "id": "page" }]
              }]
            }
        """.trimIndent()

        val profile = DeckJson.parse(raw)!!.profiles.single()
        val page = profile.pages.single()
        assertNull(page.grid)
        assertEquals(GridSettings(columns = 4, rows = 2, gap = 6, padding = 9), pageGrid(profile, page))
    }

    @Test
    fun pagesKeepIndependentGridsAndCapacity() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "grid": { "columns": 5, "rows": 3, "gap": 12, "padding": 14 },
                "pages": [
                  {
                    "id": "compact",
                    "grid": { "columns": 2, "rows": 2, "gap": 4, "padding": 6 },
                    "buttons": [
                      { "id": "a", "slot": 0 },
                      { "id": "b", "slot": 3 },
                      { "id": "lost", "slot": 4 }
                    ]
                  },
                  {
                    "id": "wide",
                    "grid": { "columns": 4, "rows": 3, "gap": 10, "padding": 12 },
                    "buttons": [
                      { "id": "c", "slot": 4 },
                      { "id": "d", "slot": 11 },
                      { "id": "lost2", "slot": 12 }
                    ]
                  }
                ]
              }]
            }
        """.trimIndent()

        val profile = DeckJson.parse(raw)!!.profiles.single()
        val compact = profile.pages.first { it.id == "compact" }
        val wide = profile.pages.first { it.id == "wide" }

        assertEquals(GridSettings(2, 2, 4, 6), pageGrid(profile, compact))
        assertEquals(GridSettings(4, 3, 10, 12), pageGrid(profile, wide))
        assertEquals(listOf("a", "b"), compact.buttons.map { it.id })
        assertEquals(listOf("c", "d"), wide.buttons.map { it.id })
    }

    @Test
    fun malformedPageGridFallsBackAndRepairsMissingFields() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "grid": { "columns": 4, "rows": 2, "gap": 8, "padding": 10 },
                "pages": [
                  {
                    "id": "bad",
                    "grid": { "columns": 0, "rows": 99, "gap": -5, "padding": 200 }
                  },
                  {
                    "id": "partial",
                    "grid": { "columns": 3 }
                  }
                ]
              }]
            }
        """.trimIndent()

        val profile = DeckJson.parse(raw)!!.profiles.single()
        val bad = profile.pages.first { it.id == "bad" }
        val partial = profile.pages.first { it.id == "partial" }

        assertEquals(GridSettings(4, 2, 8, 10), pageGrid(profile, bad))
        assertEquals(GridSettings(3, 2, 8, 10), pageGrid(profile, partial))
        assertEquals(GridDto(columns = 3, rows = 2, gap = 8, padding = 10), partial.grid)
    }

    @Test
    fun parsesVideoBackgroundFields() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "background": {
                    "type": "video",
                    "asset": "ambient.mp4",
                    "fit": "contain",
                    "loop": false,
                    "muted": false,
                    "autoplay": false,
                    "overlay": 0.4
                  }
                }]
              }]
            }
        """.trimIndent()

        val background = DeckJson.parse(raw)!!.profiles.single().pages.single().background!!
        assertEquals("video", background.type)
        assertEquals("ambient.mp4", background.asset)
        assertEquals("contain", background.fit)
        assertFalse(background.loop)
        assertFalse(background.muted)
        assertFalse(background.autoplay)
        assertEquals(0.4f, background.overlay!!, 0.001f)
    }

    @Test
    fun parsesImageAndVideoMediaIcons() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "buttons": [
                    {
                      "id": "gif",
                      "slot": 0,
                      "icon": "🖼",
                      "iconMedia": { "type": "image", "asset": "anim.gif", "fit": "contain" }
                    },
                    {
                      "id": "clip",
                      "slot": 1,
                      "icon": "🎬",
                      "iconMedia": {
                        "type": "video", "asset": "clip.mp4", "fit": "cover",
                        "loop": false, "muted": false
                      }
                    }
                  ]
                }]
              }]
            }
        """.trimIndent()

        val buttons = DeckJson.parse(raw)!!.profiles.single().pages.single().buttons
        val image = buttons.first { it.id == "gif" }.iconMedia!!
        val video = buttons.first { it.id == "clip" }.iconMedia!!
        assertEquals("image", image.type)
        assertEquals("anim.gif", image.asset)
        assertEquals("contain", image.fit)
        assertEquals("video", video.type)
        assertEquals("clip.mp4", video.asset)
        assertEquals("cover", video.fit)
        assertFalse(video.loop)
        assertFalse(video.muted)
    }

    @Test
    fun mediaDefaultsApplyWhenOptionalFieldsAreMissing() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "background": { "type": "video", "asset": "ambient.webm" },
                  "buttons": [{
                    "id": "clip",
                    "slot": 0,
                    "label": "Clip",
                    "iconMedia": { "type": "video", "asset": "clip.mp4" }
                  }]
                }]
              }]
            }
        """.trimIndent()

        val page = DeckJson.parse(raw)!!.profiles.single().pages.single()
        val background = page.background!!
        assertEquals("cover", background.fit)
        assertTrue(background.loop)
        assertTrue(background.muted)
        assertTrue(background.autoplay)

        val media = page.buttons.single().iconMedia!!
        assertEquals("cover", media.fit)
        assertTrue(media.loop)
        assertTrue(media.muted)
    }

    @Test
    fun unknownMediaAndBackgroundTypesFallBackSafely() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "pages": [{
                  "id": "page",
                  "background": { "type": "hologram", "color": "#123456" },
                  "buttons": [{
                    "id": "bad",
                    "slot": 0,
                    "icon": "❓",
                    "iconMedia": { "type": "audio", "asset": "sound.ogg" }
                  }]
                }]
              }]
            }
        """.trimIndent()

        val page = DeckJson.parse(raw)!!.profiles.single().pages.single()
        assertNull(page.buttons.single().iconMedia)
        assertEquals("❓", page.buttons.single().icon)
        assertTrue(backgroundSpec(page.background, null, Color.Black) is BackgroundSpec.Solid)

        val paired = Pairing("127.0.0.1", 47654, "1234", "Desk")
        val missingAsset = backgroundSpec(
            BackgroundDto(type = "video", asset = null),
            paired,
            Color.Black,
        )
        assertTrue(missingAsset is BackgroundSpec.Solid)
    }

    @Test
    fun dropsOutOfRangeAndDuplicateSlots() {
        val raw = """
            {
              "defaultProfileId": "p",
              "profiles": [{
                "id": "p",
                "defaultPageId": "page",
                "grid": { "columns": 2, "rows": 2, "gap": 0, "padding": 0 },
                "pages": [{
                  "id": "page",
                  "name": "Page",
                  "buttons": [
                    { "id": "a", "slot": 0, "label": "A", "actions": [] },
                    { "id": "b", "slot": 0, "label": "B", "actions": [] },
                    { "id": "c", "slot": 9, "label": "C", "actions": [] }
                  ]
                }]
              }]
            }
        """.trimIndent()

        val page = DeckJson.parse(raw)!!.profiles.single().pages.single()
        assertEquals(1, page.buttons.size)
        assertEquals("a", page.buttons.single().id)
    }

    @Test
    fun rejectsConfigWithoutProfiles() {
        assertNull(DeckJson.parse("""{"profiles":[]}"""))
        assertNull(DeckJson.parse("not json"))
    }

    @Test
    fun parsesTrackpadPointerControlAndDropsUnknownKinds() {
        val raw = """
            {
              "profiles": [{
                "id": "p",
                "grid": { "columns": 5, "rows": 3, "gap": 8, "padding": 10 },
                "pages": [{
                  "id": "page",
                  "buttons": [
                    {
                      "id": "pad",
                      "slot": 0,
                      "label": "Trackpad",
                      "control": {
                        "kind": "trackpad",
                        "emit": "delta",
                        "binding": {
                          "type": "pointer",
                          "mode": "fullscreen",
                          "sensitivity": 9,
                          "naturalScroll": false,
                          "tapToClick": false,
                          "dragLock": false
                        }
                      },
                      "span": { "columns": 3, "rows": 2 }
                    },
                    {
                      "id": "bad-binding",
                      "slot": 3,
                      "icon": "?",
                      "control": {
                        "kind": "trackpad",
                        "emit": "delta",
                        "binding": { "type": "volume", "mode": "relative" }
                      }
                    },
                    {
                      "id": "bad-emit",
                      "slot": 4,
                      "icon": "?",
                      "control": {
                        "kind": "trackpad",
                        "emit": "value",
                        "binding": { "type": "pointer" }
                      }
                    },
                    {
                      "id": "inline-default",
                      "slot": 9,
                      "control": {
                        "kind": "trackpad",
                        "emit": "delta",
                        "binding": { "type": "pointer" }
                      }
                    },
                    {
                      "id": "unknown",
                      "slot": 8,
                      "icon": "?",
                      "control": {
                        "kind": "knob",
                        "emit": "delta",
                        "binding": { "type": "pointer" }
                      }
                    }
                  ]
                }]
              }]
            }
        """.trimIndent()

        val buttons = DeckJson.parse(raw)!!.profiles.single().pages.single().buttons
        val pad = buttons.first { it.id == "pad" }
        val control = pad.control!!
        assertEquals("trackpad", control.kind)
        assertEquals("delta", control.emit)
        assertEquals("pointer", control.binding.type)
        assertEquals("fullscreen", control.binding.mode)
        assertEquals(
            "inline",
            buttons.first { it.id == "inline-default" }.control!!.binding.mode,
        )
        assertEquals(3f, control.binding.sensitivity!!, 0.001f)
        assertEquals(false, control.binding.naturalScroll)
        assertEquals(false, control.binding.tapToClick)
        assertEquals(false, control.binding.dragLock)
        assertEquals(3, pad.span!!.columns)
        assertEquals(2, pad.span!!.rows)

        assertNull(buttons.first { it.id == "bad-binding" }.control)
        assertNull(buttons.first { it.id == "bad-emit" }.control)
        assertNull(buttons.first { it.id == "unknown" }.control)
        assertEquals("?", buttons.first { it.id == "unknown" }.icon)
    }

    @Test
    fun endpointParserAcceptsCommonForms() {
        assertEquals(parseEndpoint("192.168.1.4")!!.port, 47654)
        assertEquals(parseEndpoint("192.168.1.4:5000")!!.port, 5000)
        assertEquals(parseEndpoint("http://desk.local:1234/api?x=1")!!.host, "desk.local")
        assertEquals(parseEndpoint("http://desk.local:1234/api?x=1")!!.port, 1234)
        assertEquals(parseEndpoint("[fe80::1]:9")!!.host, "fe80::1")
        assertNull(parseEndpoint(""))
        assertNull(parseEndpoint("host:notaport"))
    }
}
