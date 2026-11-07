package com.phonedek.app.ui

import com.phonedek.app.data.DeckPage

/**
 * Resolves the pager index for [pageId], falling back to [defaultPageId] and
 * then to the first page. Always returns an in-range index for a non-empty
 * list (0 for an empty one) so it can be passed straight to a pager state.
 */
fun resolvePageIndex(
    pages: List<DeckPage>,
    pageId: String?,
    defaultPageId: String? = null,
): Int {
    if (pages.isEmpty()) return 0
    val active = pages.indexOfFirst { it.id == pageId }
    if (active >= 0) return active
    val fallback = pages.indexOfFirst { it.id == defaultPageId }
    return if (fallback >= 0) fallback else 0
}
