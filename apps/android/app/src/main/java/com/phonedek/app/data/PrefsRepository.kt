package com.phonedek.app.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.phonedek.app.util.Diag
import com.phonedek.app.util.parseEndpoint
import java.io.IOException
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first

private val Context.deckDataStore by preferencesDataStore(name = "phonedek")

data class StoredSettings(
    val pairing: Pairing?,
    val keepScreenOn: Boolean,
    val hideTopBarWhenConnected: Boolean,
    val lockLandscape: Boolean,
    val rotateContentInPortrait: Boolean,
    val onboardingSeen: Boolean,
    val lastProfileId: String?,
    val lastPageId: String?,
)

/**
 * Existing users (saved pairing) should not see the first-run guide after an
 * update. Fresh installs start with it visible.
 */
internal fun resolveOnboardingSeen(
    storedValue: Boolean?,
    hasSavedPairing: Boolean,
): Boolean = storedValue ?: hasSavedPairing

class PrefsRepository(private val context: Context) {
    private object Keys {
        val HOST = stringPreferencesKey("host")
        val PORT = intPreferencesKey("port")
        val TOKEN = stringPreferencesKey("token")
        val SERVER_NAME = stringPreferencesKey("server_name")
        val KEEP_SCREEN_ON = booleanPreferencesKey("keep_screen_on")
        val HIDE_TOP_BAR_WHEN_CONNECTED =
            booleanPreferencesKey("hide_top_bar_when_connected")
        val LOCK_LANDSCAPE = booleanPreferencesKey("lock_landscape")
        val ROTATE_CONTENT_IN_PORTRAIT =
            booleanPreferencesKey("rotate_content_in_portrait")
        val ONBOARDING_SEEN = booleanPreferencesKey("onboarding_seen")
        val LAST_PROFILE = stringPreferencesKey("last_profile")
        val LAST_PAGE = stringPreferencesKey("last_page")
    }

    suspend fun load(): StoredSettings {
        val prefs = context.deckDataStore.data
            .catch { error ->
                if (error is IOException) emit(emptyPreferences()) else throw error
            }
            .first()

        val host = prefs[Keys.HOST]?.trim().orEmpty()
        val token = prefs[Keys.TOKEN].orEmpty()
        val storedPort = prefs[Keys.PORT] ?: DEFAULT_HTTP_PORT
        val endpoint = parseEndpoint(host, storedPort)
        val tokenValid = token.isNotEmpty()
        val pairing = if (host.isNotEmpty() && token.isNotEmpty()) {
            if (endpoint == null) {
                Diag.w("Stored pairing has an invalid host=\"$host\" port=$storedPort; clearing it")
                clearPairing()
                null
            } else if (!tokenValid) {
                Diag.w("Stored pairing has a blank token; clearing it")
                clearPairing()
                null
            } else {
                Diag.i("Stored pairing restored: ${endpoint.host}:${endpoint.port} token=${Diag.maskToken(token)}")
                Pairing(
                    host = endpoint.host,
                    port = endpoint.port,
                    token = token,
                    serverName = prefs[Keys.SERVER_NAME]?.takeIf { it.isNotBlank() } ?: endpoint.host,
                )
            }
        } else {
            Diag.i("No saved pairing")
            null
        }

        return StoredSettings(
            pairing = pairing,
            keepScreenOn = prefs[Keys.KEEP_SCREEN_ON] ?: true,
            // Hidden chrome is the default once a deck is paired and connected.
            hideTopBarWhenConnected = prefs[Keys.HIDE_TOP_BAR_WHEN_CONNECTED] ?: true,
            // The deck is a landscape console by default.
            lockLandscape = prefs[Keys.LOCK_LANDSCAPE] ?: true,
            rotateContentInPortrait = prefs[Keys.ROTATE_CONTENT_IN_PORTRAIT] ?: true,
            onboardingSeen = resolveOnboardingSeen(
                storedValue = prefs[Keys.ONBOARDING_SEEN],
                hasSavedPairing = pairing != null,
            ),
            lastProfileId = prefs[Keys.LAST_PROFILE]?.takeIf { it.isNotBlank() },
            lastPageId = prefs[Keys.LAST_PAGE]?.takeIf { it.isNotBlank() },
        )
    }

    suspend fun savePairing(host: String, port: Int, token: String, serverName: String) {
        context.deckDataStore.edit { prefs ->
            prefs[Keys.HOST] = host
            prefs[Keys.PORT] = port
            prefs[Keys.TOKEN] = token
            prefs[Keys.SERVER_NAME] = serverName
        }
    }

    suspend fun setServerName(serverName: String) {
        if (serverName.isBlank()) return
        context.deckDataStore.edit { prefs ->
            if (prefs[Keys.HOST] != null) prefs[Keys.SERVER_NAME] = serverName
        }
    }

    suspend fun clearPairing() {
        context.deckDataStore.edit { prefs ->
            prefs.remove(Keys.HOST)
            prefs.remove(Keys.PORT)
            prefs.remove(Keys.TOKEN)
            prefs.remove(Keys.SERVER_NAME)
            prefs.remove(Keys.LAST_PROFILE)
            prefs.remove(Keys.LAST_PAGE)
        }
    }

    suspend fun setKeepScreenOn(enabled: Boolean) {
        context.deckDataStore.edit { prefs -> prefs[Keys.KEEP_SCREEN_ON] = enabled }
    }

    suspend fun setHideTopBarWhenConnected(enabled: Boolean) {
        context.deckDataStore.edit { prefs -> prefs[Keys.HIDE_TOP_BAR_WHEN_CONNECTED] = enabled }
    }

    suspend fun setLockLandscape(enabled: Boolean) {
        context.deckDataStore.edit { prefs -> prefs[Keys.LOCK_LANDSCAPE] = enabled }
    }

    suspend fun setRotateContentInPortrait(enabled: Boolean) {
        context.deckDataStore.edit { prefs -> prefs[Keys.ROTATE_CONTENT_IN_PORTRAIT] = enabled }
    }

    suspend fun setOnboardingSeen(seen: Boolean) {
        context.deckDataStore.edit { prefs -> prefs[Keys.ONBOARDING_SEEN] = seen }
    }

    suspend fun setLastPage(profileId: String, pageId: String) {
        context.deckDataStore.edit { prefs ->
            prefs[Keys.LAST_PROFILE] = profileId
            prefs[Keys.LAST_PAGE] = pageId
        }
    }
}
