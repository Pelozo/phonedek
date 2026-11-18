package com.phonedek.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickTileFavoriteTest {
    private val config = DeckJson.parse(
        """
            {
              "profiles": [{
                "id": "p1",
                "name": "Gaming",
                "pages": [
                  {
                    "id": "pg1",
                    "name": "Main",
                    "buttons": [
                      {
                        "id": "btn-live",
                        "slot": 0,
                        "label": "Go live",
                        "actions": [{ "type": "rig", "action": "run", "presetId": "rig-1" }]
                      },
                      {
                        "id": "btn-mute",
                        "slot": 1,
                        "label": "Mute",
                        "actions": [{ "type": "media", "key": "mute" }]
                      },
                      {
                        "id": "btn-keyboard",
                        "slot": 2,
                        "label": "Keyboard",
                        "actions": [{ "type": "keyboard", "action": "open" }]
                      },
                      {
                        "id": "btn-page",
                        "slot": 3,
                        "label": "Next page",
                        "actions": [{ "type": "page", "action": "next" }]
                      },
                      { "id": "btn-empty", "slot": 4, "label": "Empty", "actions": [] }
                    ]
                  },
                  {
                    "id": "pg2",
                    "name": "Audio",
                    "buttons": [{
                      "id": "btn-mic",
                      "slot": 0,
                      "label": "Mic",
                      "actions": [{ "type": "hotkey", "keys": ["CTRL", "M"] }]
                    }]
                  }
                ]
              }]
            }
        """.trimIndent(),
    )!!

    @Test
    fun normalizationTrimsAndValidatesIds() {
        val favorite = normalizeQuickTileFavorite(
            profileId = " p1 ",
            pageId = "pg1",
            buttonId = " btn-live ",
            label = "  Go live  ",
        )!!

        assertEquals("p1", favorite.profileId)
        assertEquals("pg1", favorite.pageId)
        assertEquals("btn-live", favorite.buttonId)
        assertEquals("Go live", favorite.label)
    }

    @Test
    fun normalizationRejectsBlankMalformedOrOversizedIds() {
        assertNull(normalizeQuickTileFavorite("", "pg1", "btn"))
        assertNull(normalizeQuickTileFavorite("p 1", "pg1", "btn"))
        assertNull(normalizeQuickTileFavorite("p1", "__bad", "btn"))
        assertNull(normalizeQuickTileFavorite("p1", "pg1", "x".repeat(65)))
        assertNull(normalizeQuickTileFavorite(null, "pg1", "btn"))
    }

    @Test
    fun pickerListsEveryPressableCachedButtonWithProfileAndPage() {
        val entries = quickTileEntries(config)

        assertEquals(listOf("Gaming \u203a Main \u203a Go live", "Gaming \u203a Main \u203a Mute",
            "Gaming \u203a Audio \u203a Mic"), entries.map { it.path })
        assertTrue(entries.first().isRig)
        assertFalse(entries[1].isRig)
        assertEquals("Go live", entries.first().favorite.label)

        // Phone-local launchers, page navigation and empty buttons are not
        // actionable through the HTTP press endpoint.
        val page = config.profiles[0]!!.pages[0]!!
        assertFalse(page.buttons.first { it.id == "btn-keyboard" }.isQuickTilePressable())
        assertFalse(page.buttons.first { it.id == "btn-page" }.isQuickTilePressable())
        assertFalse(page.buttons.first { it.id == "btn-empty" }.isQuickTilePressable())
    }

    @Test
    fun aFavoriteThatBecamePhoneOnlyReportsMissing() {
        val favorite = normalizeQuickTileFavorite("p1", "pg1", "btn-keyboard", "Keyboard")!!
        assertNull(resolveQuickTileTarget(config, favorite))
        assertEquals(QuickTileFavoriteStatus.Missing, quickTileFavoriteStatus(config, favorite))
    }

    @Test
    fun cachedLookupResolvesARigButton() {
        val favorite = normalizeQuickTileFavorite("p1", "pg1", "btn-live", "Go live")!!

        assertEquals(QuickTileFavoriteStatus.Ready(
            QuickTileTarget(
                profile = config.profiles.single(),
                page = config.profiles.single().pages.first(),
                button = config.profiles.single().pages.first().buttons.first(),
            ),
        ), quickTileFavoriteStatus(config, favorite))
    }

    @Test
    fun disappearedButtonReportsMissingInsteadOfAStaleTarget() {
        val favorite = normalizeQuickTileFavorite("p1", "pg1", "btn-gone", "Gone")!!

        assertNull(resolveQuickTileTarget(config, favorite))
        assertEquals(QuickTileFavoriteStatus.Missing, quickTileFavoriteStatus(config, favorite))
    }

    @Test
    fun refreshKeepsAFavoriteThatStillExists() {
        val favorite = normalizeQuickTileFavorite("p1", "pg2", "btn-mic", "Mic")!!
        val refreshed = DeckJson.parse(
            """
                {
                  "profiles": [{
                    "id": "p1",
                    "name": "Gaming",
                    "pages": [{
                      "id": "pg2",
                      "name": "Audio",
                      "buttons": [{
                        "id": "btn-mic",
                        "slot": 0,
                        "label": "Microphone",
                        "actions": [{ "type": "hotkey", "keys": ["CTRL", "M"] }]
                      }]
                    }]
                  }]
                }
            """.trimIndent(),
        )!!

        val target = resolveQuickTileTarget(refreshed, favorite)!!
        assertEquals("Microphone", target.buttonLabel)
        assertEquals("Mic", favorite.label)
    }

    @Test
    fun noFavoriteIsNotConfigured() {
        assertEquals(
            QuickTileFavoriteStatus.NotConfigured,
            quickTileFavoriteStatus(config, null),
        )
    }
}
