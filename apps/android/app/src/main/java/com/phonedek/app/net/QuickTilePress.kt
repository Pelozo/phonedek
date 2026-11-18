package com.phonedek.app.net

import com.phonedek.app.data.DeckJson
import com.phonedek.app.data.QuickTileFavorite
import com.phonedek.app.data.normalizeQuickTileFavorite
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** How a Quick Settings press ended. Used for tile state and user-facing text. */
enum class QuickTilePressOutcome {
    SUCCESS,
    UNAUTHORIZED,
    BUTTON_MISSING,
    RATE_LIMITED,
    SERVER_ERROR,
    UNREACHABLE,
}

data class QuickTilePressResult(
    val outcome: QuickTilePressOutcome,
    /** Server text when it supplied one; never contains the pairing token. */
    val detail: String? = null,
)

private val QUICK_TILE_JSON = "application/json; charset=utf-8".toMediaType()

/**
 * Builds the exact HTTP press the app already sends over its WebSocket:
 * `POST /api/press`, Bearer pairing token, same `press` JSON including `type`
 * because the desktop's client-message schema requires it.
 *
 * Returns null for a blank token or an unusable host/port; callers then open the
 * app for pairing instead of sending an unauthenticated request.
 */
fun buildQuickTilePressRequest(
    host: String,
    port: Int,
    token: String,
    favorite: QuickTileFavorite,
    requestId: String,
): Request? {
    if (token.isBlank()) return null
    if (requestId.isBlank() || requestId.length > 64) return null
    val normalized = normalizeQuickTileFavorite(
        profileId = favorite.profileId,
        pageId = favorite.pageId,
        buttonId = favorite.buttonId,
        label = favorite.label,
    ) ?: return null
    val url = runCatching {
        HttpUrl.Builder()
            .scheme("http")
            .host(host)
            .port(port)
            .addPathSegment("api")
            .addPathSegment("press")
            .build()
    }.getOrNull() ?: return null

    val payload = buildPressPayload(
        requestId = requestId,
        profileId = normalized.profileId,
        pageId = normalized.pageId,
        buttonId = normalized.buttonId,
    )
    return Request.Builder()
        .url(url)
        .post(payload.toString().toRequestBody(QUICK_TILE_JSON))
        .header("Authorization", "Bearer $token")
        .header("Accept", "application/json")
        .header("User-Agent", "PhoneDeck-Android")
        .build()
}

fun newQuickTileRequestId(): String = "qs-${UUID.randomUUID()}"

/**
 * Short-lived client for one tile press. The tile never holds a WebSocket and
 * every call is bounded so the Quick Settings panel can collapse immediately.
 */
fun createQuickTileHttpClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(3, TimeUnit.SECONDS)
    .readTimeout(5, TimeUnit.SECONDS)
    .writeTimeout(5, TimeUnit.SECONDS)
    .callTimeout(6, TimeUnit.SECONDS)
    .retryOnConnectionFailure(true)
    .build()

/**
 * Maps the existing `POST /api/press` response to a tile outcome. The desktop
 * returns `{ok: true, requestId, buttonId, message?}` on success, 404 for a
 * button that disappeared, and `{ok:false, error}` otherwise.
 */
fun mapQuickTilePressResponse(code: Int, body: String): QuickTilePressResult {
    val json = runCatching {
        DeckJson.format.parseToJsonElement(body) as? JsonObject
    }.getOrNull()
    val ok = (json?.get("ok") as? JsonPrimitive)?.booleanOrNull == true
    val serverText = ((json?.get("message") ?: json?.get("error")) as? JsonPrimitive)
        ?.contentOrNull
        ?.trim()
        ?.take(200)
        ?.takeIf { it.isNotEmpty() }

    return when {
        code in 200..299 && ok -> QuickTilePressResult(
            outcome = QuickTilePressOutcome.SUCCESS,
            detail = serverText,
        )

        code in 200..299 -> QuickTilePressResult(
            outcome = QuickTilePressOutcome.SERVER_ERROR,
            detail = serverText ?: "The PC did not confirm the press.",
        )

        code == 401 || code == 403 -> QuickTilePressResult(
            outcome = QuickTilePressOutcome.UNAUTHORIZED,
            detail = serverText,
        )

        code == 404 -> QuickTilePressResult(
            outcome = QuickTilePressOutcome.BUTTON_MISSING,
            detail = serverText,
        )

        code == 429 -> QuickTilePressResult(
            outcome = QuickTilePressOutcome.RATE_LIMITED,
            detail = serverText,
        )

        else -> QuickTilePressResult(
            outcome = QuickTilePressOutcome.SERVER_ERROR,
            detail = serverText ?: "The PC rejected the press (HTTP $code).",
        )
    }
}

fun quickTileFailureText(result: QuickTilePressResult): String = when (result.outcome) {
    QuickTilePressOutcome.SUCCESS -> result.detail.orEmpty()
    QuickTilePressOutcome.UNAUTHORIZED ->
        "Pairing PIN rejected. Open PhoneDeck and pair again."

    QuickTilePressOutcome.BUTTON_MISSING ->
        "That button is no longer on the PC deck. Choose another in PhoneDeck Settings."

    QuickTilePressOutcome.RATE_LIMITED ->
        "Too many attempts. Wait a minute and try again."

    QuickTilePressOutcome.SERVER_ERROR ->
        result.detail ?: "The PC could not run that button."

    QuickTilePressOutcome.UNREACHABLE ->
        "Could not reach the PC. Check Wi-Fi and that PhoneDeck is running."
}

/** Compact Quick Settings state description for a finished press. */
fun quickTileDescriptionAfterPress(
    result: QuickTilePressResult,
    buttonLabel: String,
): String = when (result.outcome) {
    QuickTilePressOutcome.SUCCESS -> "Pressed $buttonLabel"
    QuickTilePressOutcome.UNAUTHORIZED -> "Pair again"
    QuickTilePressOutcome.BUTTON_MISSING -> "Choose again"
    QuickTilePressOutcome.RATE_LIMITED -> "Wait and retry"
    QuickTilePressOutcome.SERVER_ERROR -> "Press failed"
    QuickTilePressOutcome.UNREACHABLE -> "PC unreachable"
}

/**
 * Rejects a second tap inside [intervalMs]. `nowMs` is supplied by the caller so
 * the rule is unit-testable without sleeps.
 */
class QuickTileDebounce(private val intervalMs: Long = 1_000L) {
    private var lastPressAt: Long? = null

    @Synchronized
    fun tryPress(nowMs: Long): Boolean {
        val last = lastPressAt
        if (last != null && nowMs - last < intervalMs) return false
        lastPressAt = nowMs
        return true
    }
}
