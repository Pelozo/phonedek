package com.phonedek.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.decodeFromJsonElement

const val DEFAULT_HTTP_PORT = 47654
const val DISCOVERY_PORT = 47655
const val PROTOCOL_VERSION = 1

/**
 * Wire model for the PhoneDeck config. Everything has a default so partial or
 * older configs never crash the renderer. Unknown keys are ignored by [DeckJson].
 */
@Serializable
data class DeckConfig(
    val schemaVersion: Int = 1,
    val updatedAt: String = "",
    val serverName: String = "PhoneDeck",
    val defaultProfileId: String = "",
    val profiles: List<DeckProfile> = emptyList(),
)

@Serializable
data class DeckProfile(
    val id: String = "",
    val name: String = "Deck",
    val grid: GridSettings = GridSettings(),
    val theme: ProfileTheme = ProfileTheme(),
    val pages: List<DeckPage> = emptyList(),
    val defaultPageId: String = "",
)

@Serializable
data class GridSettings(
    val columns: Int = 5,
    val rows: Int = 3,
    val gap: Int = 12,
    val padding: Int = 14,
)

@Serializable
data class ProfileTheme(
    val background: BackgroundDto? = null,
    val buttonBackground: BackgroundDto? = null,
    val textColor: String = "#f8fafc",
    val accentColor: String = "#34d399",
    val fontSize: Int = 15,
    val buttonRadius: Int = 18,
)

@Serializable
data class DeckPage(
    val id: String = "",
    val name: String = "Page",
    val background: BackgroundDto? = null,
    val grid: GridDto? = null,
    val buttons: List<DeckButton> = emptyList(),
)

/**
 * Optional page-level override. Omitted fields fall back to the profile grid.
 * Kept nullable independently from [GridSettings] so partial or malformed
 * overrides can be repaired without losing the profile defaults.
 */
@Serializable
data class GridDto(
    val columns: Int? = null,
    val rows: Int? = null,
    val gap: Int? = null,
    val padding: Int? = null,
)

@Serializable
data class DeckButton(
    val id: String = "",
    val slot: Int = 0,
    val label: String = "",
    val sublabel: String? = null,
    val icon: String? = null,
    val iconMedia: MediaIconDto? = null,
    val background: BackgroundDto? = null,
    val textColor: String? = null,
    val actions: List<ActionDto> = emptyList(),
)

@Serializable
data class MediaIconDto(
    val type: String = "",
    val asset: String = "",
    val fit: String = "cover",
    val loop: Boolean = true,
    val muted: Boolean = true,
)

/**
 * Only the fields Android cares about. Everything else is forwarded to the
 * desktop verbatim as part of a press, so it is deliberately ignored here.
 */
@Serializable
data class ActionDto(
    val type: String = "",
    val direction: String? = null,
    val pageId: String? = null,
)

@Serializable
data class BackgroundDto(
    val type: String = "color",
    val color: String? = null,
    val from: String? = null,
    val to: String? = null,
    val angle: Float? = null,
    val asset: String? = null,
    val fit: String? = "cover",
    val loop: Boolean = true,
    val muted: Boolean = true,
    val autoplay: Boolean = true,
    val overlay: Float? = null,
)

data class Pairing(
    val host: String,
    val port: Int,
    val token: String,
    val serverName: String,
)

data class PairingDraft(
    val host: String,
    val port: Int,
    val token: String,
    val name: String?,
    val nonce: Long = System.nanoTime(),
)

data class DeviceInfo(
    val name: String,
    val model: String,
    val appVersion: String,
)

object DeckJson {
    val format: Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        explicitNulls = false
        encodeDefaults = true
    }

    fun parse(raw: String): DeckConfig? =
        runCatching { format.decodeFromString<DeckConfig>(raw) }
            .getOrNull()
            ?.normalized()

    fun parse(element: JsonElement): DeckConfig? =
        runCatching { format.decodeFromJsonElement<DeckConfig>(element) }
            .getOrNull()
            ?.normalized()
}

/**
 * Defensive cleanup for configs coming from disk or an older/broken desktop:
 * drops unusable profiles/pages, clamps the grid, and removes buttons that fall
 * outside the grid or duplicate a slot. Never throws.
 */
fun DeckConfig.normalized(): DeckConfig? {
    if (profiles.isEmpty()) return null

    val usedProfileIds = mutableSetOf<String>()
    val cleanProfiles = profiles.mapIndexedNotNull { index, profile ->
        val id = uniqueId(profile.id, "profile-${index + 1}", usedProfileIds)
        profile.normalized()?.copy(id = id)
    }
    if (cleanProfiles.isEmpty()) return null

    val defaultId = defaultProfileId
        .takeIf { id -> cleanProfiles.any { it.id == id } }
        ?: cleanProfiles.first().id

    return copy(
        serverName = serverName.ifBlank { "PhoneDeck" },
        defaultProfileId = defaultId,
        profiles = cleanProfiles,
    )
}

private fun DeckProfile.normalized(): DeckProfile? {
    val safeGrid = grid.safe()

    val usedPageIds = mutableSetOf<String>()
    val cleanPages = pages.mapIndexedNotNull { index, page ->
        val id = uniqueId(page.id, "page-${index + 1}", usedPageIds)
        page.normalized(safeGrid).copy(id = id)
    }
    if (cleanPages.isEmpty()) return null

    val defaultId = defaultPageId
        .takeIf { id -> cleanPages.any { it.id == id } }
        ?: cleanPages.first().id

    return copy(
        name = name.ifBlank { "Deck" },
        grid = safeGrid,
        theme = theme.safe(),
        pages = cleanPages,
        defaultPageId = defaultId,
    )
}

private fun DeckPage.normalized(profileGrid: GridSettings): DeckPage {
    val safePageGrid = grid?.toGridSettings(profileGrid)
    val effectiveGrid = safePageGrid ?: profileGrid
    val capacity = effectiveGrid.columns * effectiveGrid.rows

    val usedButtonIds = mutableSetOf<String>()
    val cleanButtons = buttons
        .filter { it.slot in 0 until capacity }
        .distinctBy { it.slot }
        .mapIndexed { index, button ->
            button.copy(
                id = uniqueId(button.id, "btn-${button.slot}-$index", usedButtonIds),
                label = button.label.take(120),
                sublabel = button.sublabel?.take(120),
                icon = button.icon?.take(48),
                iconMedia = button.iconMedia?.normalized(),
            )
        }
    return copy(
        name = name.ifBlank { "Page" },
        grid = safePageGrid?.toDto(),
        buttons = cleanButtons,
    )
}

private fun GridSettings.toDto(): GridDto = GridDto(
    columns = columns,
    rows = rows,
    gap = gap,
    padding = padding,
)

/** Effective grid for a page: its override when present, otherwise the profile default. */
fun pageGrid(profile: DeckProfile, page: DeckPage): GridSettings {
    val fallback = profile.grid.safe()
    return page.grid?.toGridSettings(fallback) ?: fallback
}

private fun GridDto.toGridSettings(fallback: GridSettings): GridSettings = GridSettings(
    columns = columns?.takeIf { it in 1..10 } ?: fallback.columns,
    rows = rows?.takeIf { it in 1..10 } ?: fallback.rows,
    gap = gap?.takeIf { it in 0..60 } ?: fallback.gap,
    padding = padding?.takeIf { it in 0..80 } ?: fallback.padding,
)

private fun GridSettings.safe(): GridSettings = copy(
    columns = columns.takeIf { it in 1..10 } ?: 5,
    rows = rows.takeIf { it in 1..10 } ?: 3,
    gap = gap.takeIf { it in 0..60 } ?: 12,
    padding = padding.takeIf { it in 0..80 } ?: 14,
)

private fun ProfileTheme.safe(): ProfileTheme = copy(
    textColor = textColor.ifBlank { "#f8fafc" },
    accentColor = accentColor.ifBlank { "#34d399" },
    fontSize = fontSize.takeIf { it in 8..48 } ?: 15,
    buttonRadius = buttonRadius.takeIf { it in 0..120 } ?: 18,
)

private fun MediaIconDto.normalized(): MediaIconDto? {
    val mediaType = type.trim().lowercase()
    val mediaAsset = asset.trim()
    if (mediaType != "image" && mediaType != "video") return null
    if (mediaAsset.isEmpty()) return null
    return copy(
        type = mediaType,
        asset = mediaAsset,
        fit = if (fit.trim() == "contain") "contain" else "cover",
        loop = loop,
        muted = muted,
    )
}

private fun uniqueId(raw: String, fallback: String, used: MutableSet<String>): String {
    val base = raw.ifBlank { fallback }
    if (used.add(base)) return base
    var suffix = 2
    while (!used.add("$base-$suffix")) {
        suffix++
    }
    return "$base-$suffix"
}
