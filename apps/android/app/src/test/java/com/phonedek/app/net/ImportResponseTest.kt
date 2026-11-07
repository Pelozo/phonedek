package com.phonedek.app.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ImportResponseTest {
    @Test
    fun acceptsConfirmedImport() {
        assertTrue(parseImportResponse(200, """{"ok":true}""") is ImportResult.Success)
        assertTrue(parseImportResponse(204, """{"ok":true}""") is ImportResult.Success)
    }

    @Test
    fun mapsAuthAndCompatibilityFailures() {
        assertMessage(
            parseImportResponse(401, ""),
            "PIN rejected. Check the 4-digit PIN shown in PhoneDeck on your PC.",
        )
        assertMessage(
            parseImportResponse(403, ""),
            "PIN rejected. Check the 4-digit PIN shown in PhoneDeck on your PC.",
        )
        assertMessage(
            parseImportResponse(404, ""),
            "Update PhoneDeck on your PC to enable backup import.",
        )
        assertMessage(
            parseImportResponse(409, ""),
            "Another import is already waiting for approval on the PC.",
        )
        assertMessage(
            parseImportResponse(413, ""),
            "That backup is too large for this PC.",
        )
    }

    @Test
    fun usesServerErrorForInvalidBackup() {
        assertMessage(
            parseImportResponse(400, """{"ok":false,"error":"Missing phonedek-config.json"}"""),
            "Missing phonedek-config.json",
        )
        assertMessage(
            parseImportResponse(400, "not json"),
            "The backup ZIP is invalid or could not be read.",
        )
        assertMessage(
            parseImportResponse(200, """{"ok":false,"error":"Import cancelled"}"""),
            "Import cancelled",
        )
        assertMessage(
            parseImportResponse(200, "not json"),
            "The PC did not confirm the import.",
        )
    }

    @Test
    fun mapsOtherHttpFailures() {
        assertMessage(
            parseImportResponse(500, ""),
            "Backup import failed (HTTP 500).",
        )
    }

    private fun assertMessage(result: ImportResult, expected: String) {
        assertEquals(expected, (result as ImportResult.Failure).message)
    }
}
