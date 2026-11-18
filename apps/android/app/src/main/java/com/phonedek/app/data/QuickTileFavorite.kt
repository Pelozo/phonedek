package com.phonedek.app.data

/**
 * One deck button chosen for the Android Quick Settings tile.
 *
 * The favorite is stored independently from the cached config so it survives
 * config refreshes. IDs use the same wire rules as the desktop schema: 1..64
 * characters, starting with a letter or digit, then letters/digits/`-`/`_`.
 */
data class QuickTileFavorite(
    val profileId: String,
    val pageId: String,
    val buttonId: String,
    val label: String = "",
)

private val QUICK_TILE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9_-]*$")
private const val MAX_QUICK_TILE_ID = 64
private const val MAX_QUICK_TILE_LABEL = 60

/**
 * Trims and validates a favorite read from preferences or built by the picker.
 * Returns null when any id is unusable; callers must then ask the user to choose
 * again instead of running a stale id.
 */
fun normalizeQuickTileFavorite(
    profileId: String?,
    pageId: String?,
    buttonId: String?,
    label: String? = null,
): QuickTileFavorite? {
    fun id(raw: String?): String? {
        val value = raw?.trim() ?: return null
        if (value.length !in 1..MAX_QUICK_TILE_ID) return null
        return value.takeIf(QUICK_TILE_ID::matches)
    }

    val profile = id(profileId) ?: return null
    val page = id(pageId) ?: return null
    val button = id(buttonId) ?: return null
    return QuickTileFavorite(
        profileId = profile,
        pageId = page,
        buttonId = button,
        label = label?.trim()?.take(MAX_QUICK_TILE_LABEL).orEmpty(),
    )
}

fun QuickTileFavorite.sameQuickTileButton(other: QuickTileFavorite?): Boolean =
    other != null &&
        profileId == other.profileId &&
        pageId == other.pageId &&
        buttonId == other.buttonId

private val QUICK_TILE_PHONE_ONLY_ACTIONS = setOf("page", "keyboard", "mixer")

/**
 * True when a host HTTP press would actually do something for this button.
 *
 * Phone-local launchers and continuous controls cannot be driven by
 * `POST /api/press`; a Quick Settings tile must not offer them. Rigs and all
 * host actions are pressable.
 */
fun DeckButton.isQuickTilePressable(): Boolean {
    if (control != null) return false
    return actions.any { action ->
        action.type.trim().lowercase() !in QUICK_TILE_PHONE_ONLY_ACTIONS
    }
}

/** Resolved favorite: the live config objects plus a display path. */
data class QuickTileTarget(
    val profile: DeckProfile,
    val page: DeckPage,
    val button: DeckButton,
) {
    val profileName: String get() = profile.name.ifBlank { "Deck" }
    val pageName: String get() = page.name.ifBlank { "Page" }
    val buttonLabel: String
        get() = button.label.trim().takeIf { it.isNotEmpty() } ?: "Button ${button.slot + 1}"
    val path: String get() = "$profileName \u203a $pageName \u203a $buttonLabel"
}

sealed interface QuickTileFavoriteStatus {
    /** No button has been chosen yet. */
    data object NotConfigured : QuickTileFavoriteStatus

    /** The stored button is not in the current cached config. */
    data object Missing : QuickTileFavoriteStatus

    data class Ready(val target: QuickTileTarget) : QuickTileFavoriteStatus
}

/** Looks up the stored button by id; null means it is gone from this config. */
fun resolveQuickTileTarget(
    config: DeckConfig?,
    favorite: QuickTileFavorite?,
): QuickTileTarget? {
    if (config == null || favorite == null) return null
    val profile = config.profiles.firstOrNull { it.id == favorite.profileId } ?: return null
    val page = profile.pages.firstOrNull { it.id == favorite.pageId } ?: return null
    val button = page.buttons.firstOrNull { it.id == favorite.buttonId } ?: return null
    if (!button.isQuickTilePressable()) return null
    return QuickTileTarget(profile = profile, page = page, button = button)
}

fun quickTileFavoriteStatus(
    config: DeckConfig?,
    favorite: QuickTileFavorite?,
): QuickTileFavoriteStatus {
    if (favorite == null) return QuickTileFavoriteStatus.NotConfigured
    val target = resolveQuickTileTarget(config, favorite)
        ?: return QuickTileFavoriteStatus.Missing
    return QuickTileFavoriteStatus.Ready(target)
}

/** One selectable button row in Settings. */
data class QuickTileEntry(
    val favorite: QuickTileFavorite,
    val profileName: String,
    val pageName: String,
    val buttonLabel: String,
    /** True for tiles whose actions include a rig run. */
    val isRig: Boolean,
) {
    val path: String get() = "$profileName \u203a $pageName \u203a $buttonLabel"
}

/**
 * Flattens the cached config into picker rows. The list is intentionally
 * derived only from the cache, so the picker keeps working offline.
 */
fun quickTileEntries(config: DeckConfig?): List<QuickTileEntry> {
    if (config == null) return emptyList()
    val entries = mutableListOf<QuickTileEntry>()
    for (profile in config.profiles) {
        for (page in profile.pages) {
            for (button in page.buttons) {
                if (!button.isQuickTilePressable()) continue
                val favorite = normalizeQuickTileFavorite(
                    profileId = profile.id,
                    pageId = page.id,
                    buttonId = button.id,
                    label = button.label,
                ) ?: continue
                entries += QuickTileEntry(
                    favorite = favorite,
                    profileName = profile.name.ifBlank { "Deck" },
                    pageName = page.name.ifBlank { "Page" },
                    buttonLabel = button.label.trim().takeIf { it.isNotEmpty() }
                        ?: "Button ${button.slot + 1}",
                    isRig = button.actions.any { it.type.trim().lowercase() == "rig" },
                )
            }
        }
    }
    return entries
}
