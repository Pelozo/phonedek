package com.phonedek.app.data

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConfigCacheArchiveTest {
    @Test
    fun keepsNewestFiveArchivesAndLeavesUnrelatedFiles() {
        val directory = Files.createTempDirectory("phonedek-archives").toFile()
        try {
            repeat(7) { index ->
                File(directory, "cache-20260101-00000$index-000.json")
                    .writeText("archive-$index")
            }
            File(directory, "keep-me.txt").writeText("not an archive")

            val deleted = pruneCacheArchives(directory, keep = 5)

            assertEquals(2, deleted)
            val names = directory.listFiles().orEmpty().map { it.name }.toSet()
            assertEquals(5, names.count { it.startsWith("cache-") && it.endsWith(".json") })
            assertTrue("keep-me.txt" in names)
            assertFalse("cache-20260101-000000-000.json" in names)
            assertFalse("cache-20260101-000001-000.json" in names)
            assertTrue("cache-20260101-000002-000.json" in names)
            assertTrue("cache-20260101-000006-000.json" in names)
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test
    fun keepsAllArchivesWhenUnderTheLimit() {
        val directory = Files.createTempDirectory("phonedek-archives-small").toFile()
        try {
            repeat(3) { index ->
                File(directory, "cache-20260101-00000$index-000.json")
                    .writeText("archive-$index")
            }

            assertEquals(0, pruneCacheArchives(directory, keep = 5))
            assertEquals(3, directory.listFiles().orEmpty().size)
        } finally {
            directory.deleteRecursively()
        }
    }
}
