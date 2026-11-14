package com.phonedek.app.ui

import com.phonedek.app.data.DeckConfig
import com.phonedek.app.data.DeckPage
import com.phonedek.app.data.DeckProfile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfileSwitchTest {
    private val config = DeckConfig(
        defaultProfileId = "desk",
        profiles = listOf(
            DeckProfile(
                id = "desk",
                defaultPageId = "main",
                pages = listOf(DeckPage(id = "main"), DeckPage(id = "media")),
            ),
            DeckProfile(
                id = "game",
                defaultPageId = "game",
                pages = listOf(DeckPage(id = "intro"), DeckPage(id = "game")),
            ),
            DeckProfile(
                id = "no-default",
                pages = listOf(DeckPage(id = "first"), DeckPage(id = "second")),
            ),
            DeckProfile(id = "empty", pages = emptyList()),
        ),
    )

    @Test
    fun validSwitchLandsOnNewProfileDefaultPageAndPersistsIt() {
        val persisted = mutableListOf<Pair<String, String>>()

        val target = resolveAndPersistProfileSwitch(config, "game") { profileId, pageId ->
            persisted += profileId to pageId
        }

        assertEquals(ProfileSwitchTarget(profileId = "game", pageId = "game"), target)
        assertEquals(listOf("game" to "game"), persisted)
    }

    @Test
    fun missingDefaultPageFallsBackToTheFirstPage() {
        val persisted = mutableListOf<Pair<String, String>>()

        val target = resolveAndPersistProfileSwitch(config, "no-default") { profileId, pageId ->
            persisted += profileId to pageId
        }

        assertEquals(ProfileSwitchTarget(profileId = "no-default", pageId = "first"), target)
        assertEquals(listOf("no-default" to "first"), persisted)
    }

    @Test
    fun trimsTheRequestedId() {
        assertEquals(
            ProfileSwitchTarget(profileId = "game", pageId = "game"),
            resolveProfileSwitch(config, "  game  "),
        )
    }

    @Test
    fun unknownDeletedOrBlankIdsAreIgnoredWithoutPersisting() {
        val persisted = mutableListOf<Pair<String, String>>()
        val persist: (String, String) -> Unit = { profileId, pageId ->
            persisted += profileId to pageId
        }

        assertNull(resolveAndPersistProfileSwitch(config, "deleted", persist))
        assertNull(resolveAndPersistProfileSwitch(config, "", persist))
        assertNull(resolveAndPersistProfileSwitch(config, "   ", persist))
        assertNull(resolveAndPersistProfileSwitch(config, null, persist))
        assertNull(resolveAndPersistProfileSwitch(null, "game", persist))
        assertNull(resolveAndPersistProfileSwitch(config, "empty", persist))
        assertTrue(persisted.isEmpty())
    }

    @Test
    fun malformedIdsNeverReachTheConfigLookup() {
        assertNull(resolveProfileSwitch(config, "-game"))
        assertNull(resolveProfileSwitch(config, "game deck"))
        assertNull(resolveProfileSwitch(config, "a".repeat(65)))
    }
}
