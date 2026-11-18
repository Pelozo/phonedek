package com.phonedek.app.tiles

import android.app.PendingIntent
import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.os.SystemClock
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.Toast
import com.phonedek.app.MainActivity
import com.phonedek.app.R
import com.phonedek.app.data.ConfigCache
import com.phonedek.app.data.DeckJson
import com.phonedek.app.data.Pairing
import com.phonedek.app.data.PrefsRepository
import com.phonedek.app.data.QuickTileFavorite
import com.phonedek.app.data.QuickTileTarget
import com.phonedek.app.data.resolveQuickTileTarget
import com.phonedek.app.net.QuickTileDebounce
import com.phonedek.app.net.QuickTilePressOutcome
import com.phonedek.app.net.QuickTilePressResult
import com.phonedek.app.net.buildQuickTilePressRequest
import com.phonedek.app.net.createQuickTileHttpClient
import com.phonedek.app.net.mapQuickTilePressResponse
import com.phonedek.app.net.newQuickTileRequestId
import com.phonedek.app.net.quickTileDescriptionAfterPress
import com.phonedek.app.net.quickTileFailureText
import com.phonedek.app.util.Diag
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * One Android Quick Settings tile that presses a chosen deck button, including
 * rig buttons. It uses only the saved pairing token and the cached config; it
 * never opens a WebSocket or asks the desktop for new endpoints.
 */
class QuickTileService : TileService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val debounce = QuickTileDebounce(intervalMs = 1_000L)
    private val pressGeneration = AtomicInteger(0)

    private data class Setup(
        val pairing: Pairing?,
        val favorite: QuickTileFavorite?,
        val target: QuickTileTarget?,
        val hasCachedConfig: Boolean,
    )

    override fun onStartListening() {
        super.onStartListening()
        val tile = qsTile
        scope.launch {
            val setup = withContext(Dispatchers.IO) { readSetup() }
            if (!scope.isActive) return@launch
            applyTile(tile, Tile.STATE_INACTIVE, idleDescription(setup))
        }
    }

    override fun onClick() {
        super.onClick()
        // Running a desktop action while the phone is locked is surprising and
        // risky; let the system ask for the unlock first.
        if (isLocked) {
            unlockAndRun { pressFavorite() }
        } else {
            pressFavorite()
        }
    }

    private fun pressFavorite() {
        if (!debounce.tryPress(SystemClock.elapsedRealtime())) return
        val generation = pressGeneration.incrementAndGet()
        val tile = qsTile
        applyTile(tile, Tile.STATE_ACTIVE, "Pressing\u2026")

        scope.launch {
            val setup = withContext(Dispatchers.IO) { readSetup() }
            if (!scope.isActive) return@launch

            when {
                setup.pairing == null -> openApp(
                    tile = tile,
                    message = "Pair with PhoneDeck on your PC, then choose a Quick Settings button.",
                    openSettings = false,
                )

                setup.favorite == null -> openApp(
                    tile = tile,
                    message = "Choose the button for the Quick Settings tile in PhoneDeck Settings.",
                    openSettings = true,
                )

                !setup.hasCachedConfig -> openApp(
                    tile = tile,
                    message = "Open PhoneDeck once while connected to cache the deck, then try the tile again.",
                    openSettings = true,
                )

                setup.target == null -> openApp(
                    tile = tile,
                    message = "That Quick Settings button is no longer available in the deck. Choose again in PhoneDeck Settings.",
                    openSettings = true,
                )

                else -> runPress(tile, setup.pairing, setup.favorite, setup.target, generation)
            }
        }
    }

    private suspend fun runPress(
        tile: Tile?,
        pairing: Pairing,
        favorite: QuickTileFavorite,
        target: QuickTileTarget,
        generation: Int,
    ) {
        val label = target.buttonLabel
        val request = buildQuickTilePressRequest(
            host = pairing.host,
            port = pairing.port,
            token = pairing.token,
            favorite = favorite,
            requestId = newQuickTileRequestId(),
        )
        if (request == null) {
            openApp(
                tile = tile,
                message = "PhoneDeck's saved server address is invalid. Open the app and pair again.",
                openSettings = true,
            )
            return
        }

        val result = withContext(Dispatchers.IO) {
            val client = createQuickTileHttpClient()
            try {
                client.newCall(request).execute().use { response ->
                    mapQuickTilePressResponse(response.code, response.body?.string().orEmpty())
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: IOException) {
                Diag.w("Quick tile press failed: ${error.message}")
                QuickTilePressResult(outcome = QuickTilePressOutcome.UNREACHABLE)
            } catch (error: Exception) {
                Diag.w("Quick tile press error: ${error.message}")
                QuickTilePressResult(
                    outcome = QuickTilePressOutcome.SERVER_ERROR,
                    detail = "The press could not be sent.",
                )
            } finally {
                client.connectionPool.evictAll()
                client.dispatcher.executorService.shutdown()
            }
        }

        when (result.outcome) {
            QuickTilePressOutcome.SUCCESS -> {
                Diag.i("Quick tile pressed \"$label\"")
                applyTile(tile, Tile.STATE_ACTIVE, quickTileDescriptionAfterPress(result, label))
                val detail = result.detail?.takeIf { it.isNotBlank() }
                toast(
                    if (detail == null) "PhoneDeck: $label pressed"
                    else "PhoneDeck: $label pressed. $detail",
                )
                delay(1_200)
                if (pressGeneration.get() == generation) {
                    applyTile(tile, Tile.STATE_INACTIVE, "Press $label")
                }
            }

            QuickTilePressOutcome.BUTTON_MISSING,
            QuickTilePressOutcome.UNAUTHORIZED,
            -> {
                Diag.w("Quick tile press rejected: ${result.outcome}")
                applyTile(
                    tile,
                    Tile.STATE_INACTIVE,
                    quickTileDescriptionAfterPress(result, label),
                )
                toast(quickTileFailureText(result))
                openApp(
                    tile = tile,
                    message = quickTileFailureText(result),
                    openSettings = true,
                    description = quickTileDescriptionAfterPress(result, label),
                )
            }

            else -> {
                Diag.w("Quick tile press failed: ${result.outcome}")
                applyTile(
                    tile,
                    Tile.STATE_INACTIVE,
                    quickTileDescriptionAfterPress(result, label),
                )
                toast(quickTileFailureText(result))
            }
        }
    }

    private suspend fun readSetup(): Setup {
        val settings = PrefsRepository(this).load()
        val cachedRaw = ConfigCache(this).read()
        val config = cachedRaw?.let { raw ->
            runCatching { DeckJson.parse(raw) }.getOrNull()
        }
        return Setup(
            pairing = settings.pairing,
            favorite = settings.quickTileFavorite,
            target = resolveQuickTileTarget(config, settings.quickTileFavorite),
            hasCachedConfig = config != null,
        )
    }

    private fun idleDescription(setup: Setup): String = when {
        setup.pairing == null -> "Pair with a PC"
        setup.favorite == null -> "Choose a button"
        !setup.hasCachedConfig -> "Open PhoneDeck once"
        setup.target == null -> "Choose again"
        else -> "Press ${setup.target.buttonLabel}"
    }

    private suspend fun openApp(
        tile: Tile?,
        message: String,
        openSettings: Boolean,
        description: String = "Set up PhoneDeck",
    ) {
        applyTile(tile, Tile.STATE_INACTIVE, description)
        toast(message)
        openMainActivity(message, openSettings)
    }

    // API 26-33 only: the PendingIntent overload does not exist there. API 34+
    // uses the non-deprecated call above, so this fallback never runs on 14+.
    @SuppressLint("StartActivityAndCollapseDeprecated")
    private fun openMainActivity(message: String, openSettings: Boolean) {
        val intent = Intent(this, MainActivity::class.java).apply {
            action = MainActivity.ACTION_QUICK_TILE_SETUP
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP,
            )
            putExtra(MainActivity.EXTRA_QUICK_TILE_MESSAGE, message)
            putExtra(MainActivity.EXTRA_QUICK_TILE_OPEN_SETTINGS, openSettings)
        }
        if (Build.VERSION.SDK_INT >= 34) {
            val pending = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            startActivityAndCollapse(pending)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    private fun applyTile(tile: Tile?, state: Int, description: String) {
        if (tile == null) return
        runCatching {
            tile.state = state
            if (Build.VERSION.SDK_INT >= 30) {
                tile.stateDescription = description
            }
            tile.updateTile()
        }
    }

    private fun toast(message: String) {
        runCatching {
            Toast.makeText(applicationContext, message, Toast.LENGTH_LONG).show()
        }
    }

    override fun onTileAdded() {
        super.onTileAdded()
        qsTile?.icon = Icon.createWithResource(this, R.drawable.ic_quick_tile)
        onStartListening()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
