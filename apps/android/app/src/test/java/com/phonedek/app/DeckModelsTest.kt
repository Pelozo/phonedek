package com.phonedek.app

import com.phonedek.app.data.DeckJson
import com.phonedek.app.util.parseEndpoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
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
