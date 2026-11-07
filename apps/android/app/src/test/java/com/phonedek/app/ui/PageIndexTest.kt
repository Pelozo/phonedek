package com.phonedek.app.ui

import com.phonedek.app.data.DeckPage
import org.junit.Assert.assertEquals
import org.junit.Test

class PageIndexTest {
    private val pages = listOf(
        DeckPage(id = "a", name = "A"),
        DeckPage(id = "b", name = "B"),
        DeckPage(id = "c", name = "C"),
    )

    @Test
    fun usesActivePageWhenPresent() {
        assertEquals(1, resolvePageIndex(pages, "b", "c"))
    }

    @Test
    fun fallsBackToDefaultPageWhenActiveIsGone() {
        assertEquals(2, resolvePageIndex(pages, "deleted", "c"))
    }

    @Test
    fun fallsBackToFirstPageWhenDefaultIsGone() {
        assertEquals(0, resolvePageIndex(pages, null, "deleted"))
    }

    @Test
    fun emptyPagesReturnZero() {
        assertEquals(0, resolvePageIndex(emptyList(), "a", "b"))
    }
}
