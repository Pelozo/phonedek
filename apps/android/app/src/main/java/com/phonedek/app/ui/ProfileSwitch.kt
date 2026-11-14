package com.phonedek.app.ui

import com.phonedek.app.data.DeckConfig
import com.phonedek.app.data.normalizeProfileId

/** Profile and page the phone must show after a server `profile` message. */
internal data class ProfileSwitchTarget(
    val profileId: String,
    val pageId: String,
)

/**
 * Resolves an auto-profile switch against the cached config.
 *
 * The target page is always the requested profile's default page (falling
 * back to its first page), so a game launch lands on a predictable page even
 * when the user was last on a page of a different profile. Unknown or deleted
 * profile ids, blank ids and profiles without pages return null; callers must
 * ignore those messages quietly rather than surfacing an error.
 */
internal fun resolveProfileSwitch(
    config: DeckConfig?,
    requestedProfileId: String?,
): ProfileSwitchTarget? {
    val id = normalizeProfileId(requestedProfileId) ?: return null
    val profile = config?.profiles?.firstOrNull { it.id == id } ?: return null
    val page = profile.pages.firstOrNull { it.id == profile.defaultPageId }
        ?: profile.pages.firstOrNull()
        ?: return null
    return ProfileSwitchTarget(profileId = profile.id, pageId = page.id)
}

/**
 * Resolves [requestedProfileId] and hands the accepted ids to [persist].
 *
 * Keeping the persistence side effect behind this helper makes the "persist
 * the active profile/page" contract unit-testable without an Android runtime.
 * Nothing is persisted when the switch is invalid, so a stale rule cannot
 * move the saved page for the deck that is currently showing.
 */
internal fun resolveAndPersistProfileSwitch(
    config: DeckConfig?,
    requestedProfileId: String?,
    persist: (profileId: String, pageId: String) -> Unit,
): ProfileSwitchTarget? {
    val target = resolveProfileSwitch(config, requestedProfileId) ?: return null
    persist(target.profileId, target.pageId)
    return target
}
