package com.phonedek.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import com.phonedek.app.util.ShortcutChord

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
    val control: ControlDto? = null,
    val span: CellSpanDto? = null,
)

@Serializable
data class CellSpanDto(
    val columns: Int = 1,
    val rows: Int = 1,
)

@Serializable
data class ControlDto(
    val kind: String = "",
    val axis: String? = null,
    val emit: String = "",
    val binding: ControlBindingDto = ControlBindingDto(),
    val min: Float? = null,
    val max: Float? = null,
    val step: Float? = null,
    val initial: Float? = null,
    val unit: String? = null,
    val haptics: Boolean = true,
)

@Serializable
data class ControlBindingDto(
    val type: String = "",
    val mode: String? = null,
    val stepPercent: Int? = null,
    val axis: String? = null,
    val invert: Boolean? = null,
    // OBS input volume binding (`type == "obs"`, `target == "inputVolume"`).
    // The name is scene-collection scoped; omitted means the desktop falls
    // back to its first audio-like input.
    val target: String? = null,
    val input: String? = null,
    // Trackpad/pointer binding settings. The desktop applies sensitivity; the
    // phone only mirrors the flags for its local gesture classifier.
    val sensitivity: Float? = null,
    val naturalScroll: Boolean? = null,
    val tapToClick: Boolean? = null,
    val dragLock: Boolean? = null,
    // Shortcut/key-wheel binding (`type == "shortcut"`). The desktop maps
    // deltas to key chords; the phone only renders what one detent sends.
    val keys: List<String> = emptyList(),
    val reverseKeys: List<String> = emptyList(),
    val holdKeys: List<String> = emptyList(),
    val repeat: Int? = null,
    val travelSteps: Int? = null,
)

/** Ordered pointer button transition carried by a `pointer` move/end message. */
data class PointerButtonEvent(
    val button: String,
    val action: String,
)

/**
 * Live state for one watched control, as sent by `controlState`. Runtime data
 * only: this is never part of [DeckConfig] and is never persisted.
 */
@Serializable
data class ControlStateEntryDto(
    val controlId: String = "",
    val revision: Int = 0,
    val value: Float? = null,
    val muted: Boolean? = null,
    val available: Boolean = false,
    val detail: String? = null,
)

/** Alias used by the connection/UI API; the wire shape is [ControlStateEntryDto]. */
typealias ControlStateDto = ControlStateEntryDto

/** Batched `controlState` message: one entry per watched control. */
@Serializable
data class ControlStateMessageDto(
    val profileId: String = "",
    val pageId: String = "",
    val states: List<ControlStateEntryDto> = emptyList(),
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
    // Kept for the desktop-resolved mic (and future) actions; presses carry
    // only ids, so this is informational on the phone.
    val action: String? = null,
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

    /**
     * Parses one `controlState` message. Unknown fields are ignored and
     * malformed entries are dropped instead of failing the whole batch.
     */
    fun parseControlState(raw: String): ControlStateMessageDto? =
        runCatching { format.parseToJsonElement(raw) }
            .getOrNull()
            ?.let(::parseControlState)

    fun parseControlState(element: JsonElement): ControlStateMessageDto? {
        val obj = element as? JsonObject ?: return null
        val profileId = (obj["profileId"] as? JsonPrimitive)
            ?.contentOrNull?.trim().orEmpty()
        val pageId = (obj["pageId"] as? JsonPrimitive)
            ?.contentOrNull?.trim().orEmpty()
        if (profileId.isEmpty() || pageId.isEmpty()) return null
        val rawStates = obj["states"] as? JsonArray ?: return null
        val states = rawStates
            .asSequence()
            .mapNotNull { entry ->
                // One malformed entry must not discard the whole batch.
                runCatching { format.decodeFromJsonElement<ControlStateEntryDto>(entry) }
                    .getOrNull()
                    ?.sanitized()
            }
            .take(32)
            .toList()
        return ControlStateMessageDto(
            profileId = profileId,
            pageId = pageId,
            states = states,
        )
    }
}

private fun ControlStateEntryDto.sanitized(): ControlStateEntryDto? {
    val id = controlId.trim()
    if (id.isEmpty() || id.length > 128 || revision < 0) return null
    // `value` is normalized 0..1; a non-finite or out-of-range value means the
    // entry cannot be applied, so keep the configured initial for that control.
    val safeValue = value?.takeIf { it.isFinite() && it in 0f..1f }
    if (value != null && safeValue == null) return null
    return copy(
        controlId = id,
        value = safeValue,
        detail = detail?.trim()?.take(64)?.takeIf { it.isNotEmpty() },
    )
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
    val columns = effectiveGrid.columns
    val rows = effectiveGrid.rows
    val capacity = columns * rows

    val usedButtonIds = mutableSetOf<String>()
    val occupied = mutableSetOf<Int>()
    val cleanButtons = mutableListOf<DeckButton>()

    buttons.forEachIndexed { index, button ->
        if (button.slot !in 0 until capacity) return@forEachIndexed
        val anchorRow = button.slot / columns
        val anchorColumn = button.slot % columns
        var span = button.span?.normalized() ?: CellSpanDto()

        // A broken footprint falls back to the anchor cell rather than vanishing.
        if (anchorColumn + span.columns > columns || anchorRow + span.rows > rows) {
            span = CellSpanDto()
        }
        var covered = spanCells(button.slot, span, columns)
        if (covered.any { it in occupied }) {
            span = CellSpanDto()
            covered = spanCells(button.slot, span, columns)
            if (covered.any { it in occupied }) return@forEachIndexed
        }
        occupied += covered

        cleanButtons += button.copy(
            id = uniqueId(button.id, "btn-${button.slot}-$index", usedButtonIds),
            label = button.label.take(120),
            sublabel = button.sublabel?.take(120),
            icon = button.icon?.take(48),
            iconMedia = button.iconMedia?.normalized(),
            control = button.control?.normalized(),
            span = if (button.span == null) null else span,
        )
    }

    return copy(
        name = name.ifBlank { "Page" },
        grid = safePageGrid?.toDto(),
        buttons = cleanButtons,
    )
}

private fun spanCells(slot: Int, span: CellSpanDto, columns: Int): List<Int> {
    val anchorRow = slot / columns
    val anchorColumn = slot % columns
    return buildList {
        repeat(span.rows) { rowOffset ->
            repeat(span.columns) { columnOffset ->
                add((anchorRow + rowOffset) * columns + anchorColumn + columnOffset)
            }
        }
    }
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

private fun CellSpanDto.normalized(): CellSpanDto = copy(
    columns = columns.coerceIn(1, 10),
    rows = rows.coerceIn(1, 10),
)

private fun ControlBindingDto.normalized(): ControlBindingDto? {
    return when (type.trim().lowercase()) {
        "volume" -> when (mode?.trim()?.lowercase() ?: "relative") {
            "relative" -> ControlBindingDto(
                type = "volume",
                mode = "relative",
                stepPercent = (stepPercent ?: 2).coerceIn(1, 25),
            )

            "absolute" -> ControlBindingDto(
                type = "volume",
                mode = "absolute",
            )

            else -> null
        }

        "scroll" -> ControlBindingDto(
            type = "scroll",
            axis = if (axis?.trim()?.lowercase() == "horizontal") "horizontal" else "vertical",
            invert = invert ?: false,
        )

        "mic" -> if (mode?.trim()?.lowercase() == "gain") {
            ControlBindingDto(type = "mic", mode = "gain")
        } else {
            null
        }

        // OBS input volume is always an absolute value binding. The target is
        // fixed by the contract; an unknown target or a volume/mic-style mode
        // is not an OBS binding and must not drive the tile.
        "obs" -> {
            val obsTarget = target?.trim()?.lowercase()
            val obsMode = mode?.trim()?.lowercase()
            if (obsTarget != "inputvolume" || !obsMode.isNullOrEmpty()) {
                null
            } else {
                ControlBindingDto(
                    type = "obs",
                    target = "inputVolume",
                    input = input?.trim()?.take(128)?.takeIf { it.isNotEmpty() },
                )
            }
        }

        "pointer" -> ControlBindingDto(
            type = "pointer",
            mode = if (mode?.trim()?.lowercase() == "fullscreen") "fullscreen" else "inline",
            sensitivity = sensitivity
                ?.takeIf { it.isFinite() }
                ?.coerceIn(0.25f, 3f)
                ?: 1f,
            naturalScroll = naturalScroll ?: true,
            tapToClick = tapToClick ?: true,
            dragLock = dragLock ?: true,
        )

        "shortcut" -> {
            // At least one valid key is required; an unknown name anywhere in
            // the binding means the desktop schema would reject it too, so the
            // control must not silently become a misleading wheel.
            val forward = ShortcutChord.normalizeKeys(keys) ?: return null
            val reverse = if (reverseKeys.isEmpty()) {
                null
            } else {
                ShortcutChord.normalizeKeys(reverseKeys) ?: return null
            }
            val hold = if (holdKeys.isEmpty()) {
                null
            } else {
                ShortcutChord.normalizeKeys(holdKeys) ?: return null
            }
            ControlBindingDto(
                type = "shortcut",
                keys = forward,
                reverseKeys = reverse ?: emptyList(),
                holdKeys = hold ?: emptyList(),
                repeat = (repeat ?: 1).coerceIn(1, 5),
                travelSteps = (travelSteps ?: 20).coerceIn(4, 100),
            )
        }

        else -> null
    }
}

private fun ControlDto.normalized(): ControlDto? {
    val controlKind = kind.trim().lowercase()
    val controlEmit = emit.trim().lowercase()

    // Trackpads are launch tiles: the full-screen pad owns the gesture. The
    // binding must be a pointer so a value binding cannot be smuggled in.
    if (controlKind == "trackpad") {
        if (controlEmit != "delta") return null
        val pointerBinding = binding.normalized() ?: return null
        if (pointerBinding.type != "pointer") return null
        return ControlDto(
            kind = "trackpad",
            emit = "delta",
            binding = pointerBinding,
            haptics = haptics,
        )
    }

    if (controlKind != "slider" && controlKind != "dial") return null
    val safeBinding = binding.normalized() ?: return null

    val emitMatchesBinding = when {
        safeBinding.type == "volume" && safeBinding.mode == "absolute" ->
            controlEmit == "value"

        safeBinding.type == "volume" -> controlEmit == "delta"
        safeBinding.type == "scroll" -> controlEmit == "delta"
        safeBinding.type == "mic" -> controlEmit == "value"
        safeBinding.type == "obs" -> controlEmit == "value"
        safeBinding.type == "shortcut" -> controlEmit == "delta"
        else -> false
    }
    if (!emitMatchesBinding) return null

    val isObs = safeBinding.type == "obs"
    // OBS uses a 0..200 % range (100 % = 0 dB) and starts at unity instead of
    // the midpoint used by the generic slider. Accept an explicit max so a
    // future 0..2000 control still renders, but never a nonzero minimum: the
    // desktop maps the normalized value directly to inputVolumeMul.
    val defaultMax = if (isObs) 200f else 100f
    val safeMin = if (isObs) 0f else (min?.takeIf { it.isFinite() } ?: 0f)
    var safeMax = max?.takeIf { it.isFinite() } ?: defaultMax
    if (safeMax <= safeMin) safeMax = safeMin + defaultMax
    val safeStep = step?.takeIf { it.isFinite() && it > 0f }
        ?: when {
            safeBinding.type == "volume" && safeBinding.mode == "relative" ->
                safeBinding.stepPercent!!.toFloat()

            else -> 1f
        }
    val defaultInitial = if (isObs) 100f else (safeMin + safeMax) / 2f
    val safeInitial = (initial?.takeIf { it.isFinite() } ?: defaultInitial)
        .coerceIn(safeMin, safeMax)
    val safeAxis = if (axis?.trim()?.lowercase() == "vertical") "vertical" else "horizontal"
    val safeUnit = if (safeBinding.type == "shortcut") {
        // A key wheel has no numeric readout, so any unit is meaningless.
        null
    } else {
        (unit?.trim()?.takeIf { it.isNotEmpty() }?.take(16))
            ?: if (
                safeBinding.type == "volume" ||
                safeBinding.type == "mic" ||
                safeBinding.type == "obs"
            ) {
                "%"
            } else {
                null
            }
    }

    return copy(
        kind = controlKind,
        axis = safeAxis,
        emit = controlEmit,
        binding = safeBinding,
        min = safeMin,
        max = safeMax,
        step = safeStep,
        initial = safeInitial,
        unit = safeUnit,
        haptics = haptics,
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
