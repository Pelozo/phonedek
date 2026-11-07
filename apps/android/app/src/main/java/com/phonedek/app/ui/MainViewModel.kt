package com.phonedek.app.ui

import android.app.Application
import android.content.ContentResolver
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.phonedek.app.BuildConfig
import com.phonedek.app.data.ConfigCache
import com.phonedek.app.data.DeckButton
import com.phonedek.app.data.DeckConfig
import com.phonedek.app.data.DeckJson
import com.phonedek.app.data.DeckPage
import com.phonedek.app.data.DeckProfile
import com.phonedek.app.data.DeviceInfo
import com.phonedek.app.data.Pairing
import com.phonedek.app.data.PairingDraft
import com.phonedek.app.data.PrefsRepository
import com.phonedek.app.net.BackupResult
import com.phonedek.app.net.ConnectionStatus
import com.phonedek.app.net.DeckConnection
import com.phonedek.app.net.FetchResult
import com.phonedek.app.net.HttpApi
import com.phonedek.app.net.createHttpClient
import com.phonedek.app.net.createWebSocketClient
import com.phonedek.app.util.Diag
import com.phonedek.app.util.parseEndpoint
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

data class UiState(
    val ready: Boolean = false,
    val pairing: Pairing? = null,
    val config: DeckConfig? = null,
    val activeProfileId: String? = null,
    val activePageId: String? = null,
    val connection: ConnectionStatus = ConnectionStatus.OFFLINE,
    val keepScreenOn: Boolean = true,
    val hideTopBarWhenConnected: Boolean = true,
    val lockLandscape: Boolean = true,
    val rotateContentInPortrait: Boolean = true,
    val pairingBusy: Boolean = false,
    val pairingError: String? = null,
    val pairingDraft: PairingDraft? = null,
    val backupBusy: Boolean = false,
    val backupProgress: Float = 0f,
    val backupBytes: Long = 0,
    val backupTotalBytes: Long = -1,
    val backupError: String? = null,
    val backupSavedName: String? = null,
)

sealed interface UiEvent {
    data class Message(val text: String) : UiEvent
}

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val prefs = PrefsRepository(application)
    private val cache = ConfigCache(application)
    private val httpClient = createHttpClient()
    private val socketClient = createWebSocketClient()
    private val http = HttpApi(httpClient)
    private val ingestMutex = Mutex()

    private val deviceInfo = DeviceInfo(
        name = Build.MODEL?.trim().takeUnless { it.isNullOrEmpty() } ?: "Android",
        model = listOf(Build.MANUFACTURER, Build.MODEL)
            .mapNotNull { it?.trim()?.takeIf(String::isNotEmpty) }
            .joinToString(" ")
            .ifBlank { "Android" },
        appVersion = BuildConfig.VERSION_NAME,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<UiEvent>(extraBufferCapacity = 16)
    val events: SharedFlow<UiEvent> = _events.asSharedFlow()

    private var foreground = false
    private var loaded = false
    private var lastRawConfig: String? = null
    private var lastPageId: String? = null
    private var lastProfileId: String? = null
    private var pairJob: Job? = null
    private var fetchJob: Job? = null
    private var backupJob: Job? = null
    private var protocolWarningShown = false
    private var authWarningShown = false

    private val connection = DeckConnection(
        client = socketClient,
        scope = viewModelScope,
        device = deviceInfo,
        listener = object : DeckConnection.Listener {
            override fun onStatus(status: ConnectionStatus) {
                _state.update { it.copy(connection = status) }
            }

            override fun onOpen() {
                refreshConfig()
            }

            override fun onServerHello(serverName: String, protocol: Int) {
                if (protocol != 1 && !protocolWarningShown) {
                    protocolWarningShown = true
                    emit("This desktop uses protocol v$protocol; some features may not work.")
                }
                val current = _state.value.pairing ?: return
                if (serverName.isNotBlank() && serverName != current.serverName) {
                    _state.update { state ->
                        state.copy(pairing = state.pairing?.copy(serverName = serverName))
                    }
                    viewModelScope.launch { runCatching { prefs.setServerName(serverName) } }
                }
            }

            override fun onConfig(rawJson: String) {
                ingestConfig(rawJson)
            }

            override fun onPressResult(
                requestId: String,
                buttonId: String,
                ok: Boolean,
                error: String?,
                message: String?,
            ) {
                if (!ok) {
                    emit(error?.takeIf { it.isNotBlank() } ?: "The desktop could not run that action.")
                } else {
                    // Success messages are optional; ordinary presses stay quiet.
                    message?.trim()?.takeIf { it.isNotEmpty() }?.let(::emit)
                }
            }

            override fun onServerError(code: String, message: String) {
                Diag.w("Server error code=$code message=\"$message\"")
                emit(message.ifBlank { "The desktop reported an error." })
            }

            override fun onNavigate(direction: String, pageId: String?) {
                navigateCurrentProfile(direction, pageId)
            }

            override fun onPong() = Unit
        },
    )

    init {
        Diag.i("PhoneDeck ${BuildConfig.VERSION_NAME} (build ${BuildConfig.VERSION_CODE}) starting")
        viewModelScope.launch { loadInitialState() }
    }

    fun onForeground() {
        Diag.i("App foregrounded; pairing=${_state.value.pairing != null}")
        foreground = true
        if (!loaded) return
        val pairing = _state.value.pairing ?: return
        connection.start(pairing.host, pairing.port, pairing.token)
    }

    fun onBackground() {
        Diag.i("App backgrounded; stopping WebSocket")
        foreground = false
        connection.stop()
    }

    fun connect(
        hostInput: String,
        port: Int,
        tokenInput: String,
        name: String? = null,
    ) {
        if (_state.value.pairingBusy) return
        val token = tokenInput.trim()
        Diag.i("Pairing attempt: hostInput=\"$hostInput\" port=$port token=${Diag.maskToken(token)}")
        val endpoint = parseEndpoint(hostInput, port)
        if (endpoint == null) {
            Diag.w("Pairing rejected: parseEndpoint returned null")
            Diag.w("  rawHost=\"$hostInput\" rawPort=$port")
            _state.update { it.copy(pairingError = "Enter a valid host name or IP address.") }
            return
        }
        if (!Regex("^\\d{4}$").matches(token) && token.length < 8) {
            Diag.w("Pairing rejected: PIN is not 4 digits and token is too short (${Diag.maskToken(token)})")
            _state.update { it.copy(pairingError = "Enter the 4-digit PIN shown on your PC.") }
            return
        }
        if (port !in 1..65535 && !hostInput.contains(':')) {
            Diag.w("Pairing rejected: invalid port $port")
            _state.update { it.copy(pairingError = "Enter a port between 1 and 65535.") }
            return
        }

        val hadPairing = _state.value.pairing != null
        pairJob?.cancel()
        fetchJob?.cancel()
        pairJob = viewModelScope.launch {
            _state.update { it.copy(pairingBusy = true, pairingError = null) }
            Diag.i("Fetching config from ${endpoint.host}:${endpoint.port}")
            when (val result = http.fetchConfig(endpoint.host, endpoint.port, token)) {
                is FetchResult.Success -> {
                    val serverName = result.config.serverName
                        .takeIf { it.isNotBlank() }
                        ?: name?.takeIf { it.isNotBlank() }
                        ?: endpoint.host

                    runCatching {
                        prefs.savePairing(endpoint.host, endpoint.port, token, serverName)
                    }
                    cache.write(result.raw)
                    lastRawConfig = result.raw
                    authWarningShown = false

                    val pairing = Pairing(
                        host = endpoint.host,
                        port = endpoint.port,
                        token = token,
                        serverName = serverName,
                    )
                    val active = resolveActive(result.config, lastProfileId, lastPageId)
                    lastProfileId = active.first
                    lastPageId = active.second

                    _state.update {
                        it.copy(
                            pairing = pairing,
                            config = result.config,
                            activeProfileId = active.first,
                            activePageId = active.second,
                            pairingBusy = false,
                            pairingError = null,
                            pairingDraft = null,
                            connection = ConnectionStatus.OFFLINE,
                        )
                    }
                    runCatching { prefs.setLastPage(active.first, active.second) }
                    Diag.i("Pairing saved: ${endpoint.host}:${endpoint.port} server=\"$serverName\"")
                    emit(if (hadPairing) "Switched to $serverName" else "Paired with $serverName")

                    if (foreground) {
                        Diag.i("Starting WebSocket after pairing")
                        connection.start(pairing.host, pairing.port, pairing.token)
                    }
                }

                is FetchResult.Failure -> {
                    Diag.w("Config fetch failed: ${result.message}")
                    _state.update {
                        it.copy(
                            pairingBusy = false,
                            pairingError = result.message,
                            connection = ConnectionStatus.OFFLINE,
                        )
                    }
                    if (hadPairing) emit(result.message)
                }
            }
        }
    }

    fun handleDeepLink(host: String, port: Int, token: String, name: String?) {
        val endpoint = parseEndpoint(host, port)
        Diag.i("Deep-link pairing: host=\"$host\" port=$port token=${Diag.maskToken(token)} parsed=${endpoint?.host ?: "null"}:${endpoint?.port ?: 0}")
        if (endpoint == null) {
            emit("That pairing link is missing a valid server address.")
            return
        }
        val draft = PairingDraft(
            host = endpoint.host,
            port = endpoint.port,
            token = token,
            name = name,
        )
        _state.update { it.copy(pairingDraft = draft) }
        if (token.isBlank()) {
            _state.update {
                it.copy(pairingError = "The pairing link did not include a PIN.")
            }
            emit("The pairing link did not include a PIN.")
            return
        }
        connect(endpoint.host, endpoint.port, token, name)
    }

    fun reportMessage(message: String) {
        emit(message)
    }

    fun clearPairingError() {
        _state.update { it.copy(pairingError = null) }
    }

    fun reconnect() {
        val pairing = _state.value.pairing ?: return
        if (!foreground) return
        connection.restart()
        refreshConfig()
        emit("Reconnecting to ${pairing.serverName}…")
    }

    fun forgetServer() {
        pairJob?.cancel()
        fetchJob?.cancel()
        backupJob?.cancel()
        backupJob = null
        connection.stop()
        lastRawConfig = null
        lastPageId = null
        lastProfileId = null
        protocolWarningShown = false
        authWarningShown = false
        val keepScreenOn = _state.value.keepScreenOn
        val hideTopBarWhenConnected = _state.value.hideTopBarWhenConnected
        val lockLandscape = _state.value.lockLandscape
        val rotateContentInPortrait = _state.value.rotateContentInPortrait
        _state.value = UiState(
            ready = true,
            keepScreenOn = keepScreenOn,
            hideTopBarWhenConnected = hideTopBarWhenConnected,
            lockLandscape = lockLandscape,
            rotateContentInPortrait = rotateContentInPortrait,
            connection = ConnectionStatus.OFFLINE,
        )
        viewModelScope.launch {
            // Keep a private safety copy before forgetServer removes the cache.
            runCatching { cache.archive("change-server") }
            runCatching { prefs.clearPairing() }
            cache.clear()
        }
    }

    fun setKeepScreenOn(enabled: Boolean) {
        _state.update { it.copy(keepScreenOn = enabled) }
        viewModelScope.launch { runCatching { prefs.setKeepScreenOn(enabled) } }
    }

    fun setHideTopBarWhenConnected(enabled: Boolean) {
        _state.update { it.copy(hideTopBarWhenConnected = enabled) }
        viewModelScope.launch { runCatching { prefs.setHideTopBarWhenConnected(enabled) } }
    }

    fun setLockLandscape(enabled: Boolean) {
        _state.update { it.copy(lockLandscape = enabled) }
        viewModelScope.launch { runCatching { prefs.setLockLandscape(enabled) } }
    }

    fun setRotateContentInPortrait(enabled: Boolean) {
        _state.update { it.copy(rotateContentInPortrait = enabled) }
        viewModelScope.launch { runCatching { prefs.setRotateContentInPortrait(enabled) } }
    }

    /**
     * Streams the desktop's ZIP backup into the SAF document chosen by the user.
     * Partial documents are deleted when the download or write fails.
     */
    fun saveBackup(uri: Uri) {
        val snapshot = _state.value
        if (snapshot.backupBusy) return
        val pairing = snapshot.pairing
        if (pairing == null) {
            reportBackupFailure("Pair with a PC before saving a backup.")
            return
        }
        if (snapshot.connection != ConnectionStatus.CONNECTED) {
            reportBackupFailure("Connect to your PC to save a backup.")
            return
        }

        _state.update {
            it.copy(
                backupBusy = true,
                backupProgress = 0f,
                backupBytes = 0,
                backupTotalBytes = -1,
                backupError = null,
                backupSavedName = null,
            )
        }

        backupJob = viewModelScope.launch {
            val resolver = getApplication<Application>().contentResolver
            var failure: String? = null
            var savedName: String? = null
            try {
                withContext(Dispatchers.IO) {
                    val displayName = queryBackupName(resolver, uri)
                    val output = resolver.openOutputStream(uri)
                    if (output == null) {
                        failure = "Could not open the selected file."
                        return@withContext
                    }
                    output.use { stream ->
                        when (
                            val result = http.downloadBackup(
                                host = pairing.host,
                                port = pairing.port,
                                token = pairing.token,
                                outputStream = stream,
                                onProgress = { downloaded, total ->
                                    _state.update { current ->
                                        current.copy(
                                            backupBytes = downloaded,
                                            backupTotalBytes = total,
                                            backupProgress = if (total > 0) {
                                                (downloaded.toFloat() / total)
                                                    .coerceIn(0f, 1f)
                                            } else {
                                                0f
                                            },
                                        )
                                    }
                                },
                            )
                        ) {
                            is BackupResult.Success -> {
                                savedName = displayName
                                    ?: uri.lastPathSegment
                                    ?: "backup.zip"
                            }

                            is BackupResult.Failure -> failure = result.message
                        }
                    }
                }
            } catch (error: CancellationException) {
                _state.update { it.copy(backupBusy = false) }
                throw error
            } catch (error: SecurityException) {
                failure = "The selected location isn't writable. Choose another folder."
            } catch (error: IOException) {
                failure = if (
                    error.message?.contains("ENOSPC", ignoreCase = true) == true ||
                    error.message?.contains("no space", ignoreCase = true) == true
                ) {
                    "Not enough space to save the backup."
                } else {
                    "Could not write the backup. Check free space and try again."
                }
            } catch (error: Exception) {
                failure = "Backup failed: ${error.message ?: "unknown error"}"
            }

            if (failure != null) {
                // SAF may leave a zero/partial document behind. Remove it so a
                // failed download never looks like a valid backup.
                runCatching { resolver.delete(uri, null, null) }
            }
            val message = failure
                ?: "Backup saved to ${savedName ?: "your phone"}."
            _state.update {
                it.copy(
                    backupBusy = false,
                    backupError = failure,
                    backupSavedName = savedName,
                )
            }
            emit(message)
        }
    }

    private fun reportBackupFailure(message: String) {
        _state.update {
            it.copy(
                backupBusy = false,
                backupError = message,
                backupSavedName = null,
            )
        }
        emit(message)
    }

    private fun queryBackupName(resolver: ContentResolver, uri: Uri): String? =
        runCatching {
            resolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null,
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (index >= 0) cursor.getString(index) else null
                } else {
                    null
                }
            }
        }.getOrNull()?.takeIf { it.isNotBlank() }

    /**
     * Called when a horizontal swipe settles on [pageId]. Uses the same
     * persistence path as page actions so the last page survives restarts.
     */
    fun onPageSelected(profileId: String, pageId: String) {
        val current = _state.value
        if (current.activeProfileId != profileId) return
        val profile = current.config?.profiles?.firstOrNull { it.id == profileId } ?: return
        // A pager that was disposed during a profile/config change can still
        // deliver one last settle; never write a stale page or profile.
        if (profile.pages.none { it.id == pageId }) return
        setActivePage(profileId, pageId)
    }

    fun onButtonPressed(button: DeckButton) {
        val snapshot = _state.value
        val profile = snapshot.config?.profiles?.firstOrNull {
            it.id == snapshot.activeProfileId
        } ?: return
        val page = profile.pages.firstOrNull { it.id == snapshot.activePageId } ?: return

        val pageActions = button.actions.filter { it.type == "page" }
        val remoteActions = button.actions.filterNot { it.type == "page" }

        for (action in pageActions) {
            applyPageAction(profile, action)
        }

        if (remoteActions.isEmpty()) return
        if (!connection.isConnected()) {
            emit("Offline — that action was not sent.")
            return
        }

        val sent = connection.sendPress(
            requestId = connection.newRequestId(),
            profileId = profile.id,
            pageId = page.id,
            buttonId = button.id,
        )
        if (!sent) emit("Connection lost — that action was not sent.")
    }

    private suspend fun loadInitialState() {
        val stored = prefs.load()
        lastPageId = stored.lastPageId
        lastProfileId = stored.lastProfileId

        val cachedRaw = cache.read()
        val current = _state.value
        val cached = cachedRaw?.let {
            withContext(Dispatchers.IO) { runCatching { DeckJson.parse(it) }.getOrNull() }
        }
        if (current.config == null && cached != null) {
            lastRawConfig = cachedRaw
        }

        val active = cached?.let { resolveActive(it, stored.lastProfileId, stored.lastPageId) }
        val pairing = current.pairing ?: stored.pairing
        val profileId = current.activeProfileId ?: active?.first
        val pageId = current.activePageId ?: active?.second

        // Merge instead of replacing: a deep link can arrive while this read is
        // still in flight, and its draft/error/busy/pairing state must survive.
        _state.value = current.copy(
            ready = true,
            pairing = pairing,
            config = current.config ?: cached,
            activeProfileId = profileId,
            activePageId = pageId,
            keepScreenOn = stored.keepScreenOn,
            hideTopBarWhenConnected = stored.hideTopBarWhenConnected,
            lockLandscape = stored.lockLandscape,
            rotateContentInPortrait = stored.rotateContentInPortrait,
        )
        loaded = true

        if (current.activeProfileId == null && active != null) {
            lastProfileId = active.first
            lastPageId = active.second
        }

        if (pairing != null && foreground && !current.pairingBusy) {
            connection.start(pairing.host, pairing.port, pairing.token)
        }
    }

    private fun refreshConfig() {
        val pairing = _state.value.pairing ?: return
        fetchJob?.cancel()
        fetchJob = viewModelScope.launch {
            when (val result = http.fetchConfig(pairing.host, pairing.port, pairing.token)) {
                is FetchResult.Success -> ingestConfig(result.raw)
                is FetchResult.Failure -> {
                    Diag.w("Refreshing config failed: ${result.message}")
                    // The WebSocket may still be healthy; only surface auth failures.
                    if (result.unauthorized && !authWarningShown) {
                        authWarningShown = true
                        emit("${result.message} Re-pair if the desktop PIN was changed.")
                    }
                }
            }
        }
    }

    private fun ingestConfig(rawJson: String) {
        viewModelScope.launch {
            ingestMutex.withLock {
                if (rawJson == lastRawConfig || rawJson.isBlank()) return@withLock
                val config = withContext(Dispatchers.IO) {
                    runCatching { DeckJson.parse(rawJson) }.getOrNull()
                }
                if (config == null) {
                    emit("The desktop sent a config this app could not read; keeping the last deck.")
                    return@withLock
                }

                lastRawConfig = rawJson
                val current = _state.value
                val active = resolveActive(
                    config,
                    current.activeProfileId ?: lastProfileId,
                    current.activePageId ?: lastPageId,
                )
                lastProfileId = active.first
                lastPageId = active.second
                _state.update {
                    it.copy(
                        config = config,
                        activeProfileId = active.first,
                        activePageId = active.second,
                    )
                }
                cache.write(rawJson)

                val pairing = _state.value.pairing
                if (pairing != null && config.serverName.isNotBlank() &&
                    config.serverName != pairing.serverName
                ) {
                    _state.update {
                        it.copy(pairing = it.pairing?.copy(serverName = config.serverName))
                    }
                    runCatching { prefs.setServerName(config.serverName) }
                }
            }
        }
    }

    private fun resolveActive(
        config: DeckConfig,
        preferredProfileId: String?,
        preferredPageId: String?,
    ): Pair<String, String> {
        val profile = config.profiles.firstOrNull { it.id == preferredProfileId }
            ?: config.profiles.firstOrNull { it.id == config.defaultProfileId }
            ?: config.profiles.first()

        val page = profile.pages.firstOrNull { it.id == preferredPageId }
            ?: profile.pages.firstOrNull { it.id == profile.defaultPageId }
            ?: profile.pages.first()

        return profile.id to page.id
    }

    private fun applyPageAction(profile: DeckProfile, action: com.phonedek.app.data.ActionDto) {
        val pages = profile.pages
        if (pages.isEmpty()) return
        val currentIndex = pages.indexOfFirst { it.id == _state.value.activePageId }
            .let { if (it >= 0) it else pages.indexOfFirst { page -> page.id == profile.defaultPageId } }
            .let { if (it >= 0) it else 0 }

        val targetIndex = when (action.direction) {
            "next" -> (currentIndex + 1) % pages.size
            "prev" -> (currentIndex - 1 + pages.size) % pages.size
            "goto" -> pages.indexOfFirst { it.id == action.pageId }.takeIf { it >= 0 } ?: return
            else -> return
        }
        setActivePage(profile.id, pages[targetIndex].id)
    }

    private fun navigateCurrentProfile(direction: String, pageId: String?) {
        val snapshot = _state.value
        val profile = snapshot.config?.profiles?.firstOrNull {
            it.id == snapshot.activeProfileId
        } ?: return
        applyPageAction(
            profile,
            com.phonedek.app.data.ActionDto(
                type = "page",
                direction = direction,
                pageId = pageId,
            ),
        )
    }

    private fun setActivePage(profileId: String, pageId: String) {
        val current = _state.value
        if (current.activeProfileId == profileId && current.activePageId == pageId) return
        _state.update { it.copy(activeProfileId = profileId, activePageId = pageId) }
        lastProfileId = profileId
        lastPageId = pageId
        viewModelScope.launch {
            runCatching { prefs.setLastPage(profileId, pageId) }
        }
    }

    private fun emit(message: String) {
        if (message.isNotBlank()) _events.tryEmit(UiEvent.Message(message))
    }

    override fun onCleared() {
        backupJob?.cancel()
        connection.stop()
        super.onCleared()
    }
}
