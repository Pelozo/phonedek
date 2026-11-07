package com.phonedek.app

import androidx.compose.ui.graphics.Color
import com.phonedek.app.data.BackgroundDto
import com.phonedek.app.data.DeckJson
import com.phonedek.app.data.Pairing
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
