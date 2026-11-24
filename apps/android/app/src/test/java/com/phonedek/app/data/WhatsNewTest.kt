package com.phonedek.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WhatsNewTest {
    @Test
    fun firstInstallDoesNotPrompt() {
        assertFalse(
            shouldShowWhatsNew(
                lastSeenVersion = null,
                currentVersion = "0.13.0",
                hasPriorUse = false,
            ),
        )
    }

    @Test
    fun upgradeFromBuildWithoutStoredVersionPrompts() {
        assertTrue(
            shouldShowWhatsNew(
                lastSeenVersion = null,
                currentVersion = "0.13.1",
                hasPriorUse = true,
            ),
        )
    }

    @Test
    fun blankStoredVersionDoesNotPromptOnFreshInstall() {
        assertFalse(shouldShowWhatsNew(lastSeenVersion = "", currentVersion = "0.13.0"))
        assertFalse(shouldShowWhatsNew(lastSeenVersion = "   ", currentVersion = "0.13.0"))
    }

    @Test
    fun blankStoredVersionStillPromptsForPriorUse() {
        assertTrue(
            shouldShowWhatsNew(
                lastSeenVersion = "",
                currentVersion = "0.13.0",
                hasPriorUse = true,
            ),
        )
    }

    @Test
    fun sameVersionDoesNotPromptEvenWithPriorUse() {
        assertFalse(
            shouldShowWhatsNew(
                lastSeenVersion = "0.13.0",
                currentVersion = "0.13.0",
                hasPriorUse = true,
            ),
        )
    }

    @Test
    fun changedVersionPrompts() {
        assertTrue(shouldShowWhatsNew(lastSeenVersion = "0.12.0", currentVersion = "0.13.0"))
    }

    @Test
    fun multipleVersionJumpPrompts() {
        assertTrue(shouldShowWhatsNew(lastSeenVersion = "0.9.0", currentVersion = "0.13.0"))
    }

    @Test
    fun vPrefixAndWhitespaceAreNormalized() {
        assertFalse(shouldShowWhatsNew(lastSeenVersion = " v0.13.0 ", currentVersion = "0.13.0"))
        assertFalse(shouldShowWhatsNew(lastSeenVersion = "V0.13.0", currentVersion = "v0.13.0"))
    }

    @Test
    fun curatedEntryForCurrentVersion() {
        val entry = whatsNewFor("0.13.0")
        assertEquals("Auto-profile return", entry.title)
        assertTrue(entry.highlights.any { it.contains("profile", ignoreCase = true) })
    }

    @Test
    fun curatedMapCoversRecentReleases() {
        listOf("0.21.0", "0.20.1", "0.20.0", "0.19.1", "0.19.0", "0.18.0", "0.17.0", "0.16.2", "0.16.1", "0.16.0", "0.15.0", "0.14.0", "0.13.2", "0.13.1", "0.13.0", "0.12.0", "0.11.0", "0.10.0", "0.9.0").forEach { version ->
            assertNotEquals(
                "Version $version should have a curated entry",
                "Fixes and improvements",
                whatsNewFor(version).title,
            )
        }
        assertTrue(whatsNewFor("0.12.0").highlights.any { it.contains("Ctrl") })
    }

    @Test
    fun vPrefixedVersionUsesCuratedEntry() {
        assertEquals("Hue and Nanoleaf lights", whatsNewFor("v0.11.0").title)
    }

    @Test
    fun unknownVersionUsesGenericFallback() {
        val entry = whatsNewFor("99.0.0")
        assertEquals("Fixes and improvements", entry.title)
        assertTrue(entry.highlights.isNotEmpty())
    }

    @Test
    fun emptyVersionUsesGenericFallback() {
        assertEquals("Fixes and improvements", whatsNewFor("").title)
    }

    @Test
    fun normalizedVersionDropsPrefixAndWhitespace() {
        assertEquals("0.13.0", normalizeVersion(" v0.13.0 "))
    }
}
