package com.phonedek.app.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import java.io.IOException
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first

private val Context.deckDataStore by preferencesDataStore(name = "phonedek")

data class StoredSettings(
    val pairing: Pairing?,
    val keepScreenOn: Boolean,
    val lastProfileId: String?,
    val lastPageId: String?,
)

class PrefsRepository(private val context: Context) {
    private object Keys {
        val HOST = stringPreferencesKey("host")
        val PORT = intPreferencesKey("port")
        val TOKEN = stringPreferencesKey("token")
        val SERVER_NAME = stringPreferencesKey("server_name")
        val KEEP_SCREEN_ON = booleanPreferencesKey("keep_screen_on")
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
        val pairing = if (host.isNotEmpty() && token.isNotEmpty()) {
            Pairing(
                host = host,
                port = prefs[Keys.PORT] ?: DEFAULT_HTTP_PORT,
                token = token,
                serverName = prefs[Keys.SERVER_NAME]?.takeIf { it.isNotBlank() } ?: host,
            )
        } else {
            null
        }

        return StoredSettings(
            pairing = pairing,
            keepScreenOn = prefs[Keys.KEEP_SCREEN_ON] ?: true,
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

    suspend fun setLastPage(profileId: String, pageId: String) {
        context.deckDataStore.edit { prefs ->
            prefs[Keys.LAST_PROFILE] = profileId
            prefs[Keys.LAST_PAGE] = pageId
        }
    }
}
