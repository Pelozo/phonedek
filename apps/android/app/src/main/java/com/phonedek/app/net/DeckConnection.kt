package com.phonedek.app.net

import android.os.SystemClock
import com.phonedek.app.data.DeckJson
import com.phonedek.app.data.DeviceInfo
import com.phonedek.app.data.PROTOCOL_VERSION
import com.phonedek.app.util.Diag
import java.util.UUID
import kotlin.math.min
import kotlin.random.Random
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * OkHttp's HttpUrl only accepts http/https. WebSocket requests are regular
 * HTTP requests with an Upgrade header, so a ws:// URL is built as http://.
 */
internal fun buildWebSocketUrl(host: String, port: Int, token: String): HttpUrl? = runCatching {
    HttpUrl.Builder()
        .scheme("http")
        .host(host)
        .port(port)
        .addPathSegment("ws")
        .addQueryParameter("token", token)
        .build()
}.getOrNull()

internal val CLIENT_CAPABILITIES = listOf("input-v1", "brightness-v1")

internal fun buildHelloPayload(device: DeviceInfo): JsonObject = buildJsonObject {
    put("type", "hello")
    put("protocol", PROTOCOL_VERSION)
    put("capabilities", buildJsonArray {
        CLIENT_CAPABILITIES.forEach { capability -> add(capability) }
    })
    put("device", buildJsonObject {
        put("name", device.name)
        put("model", device.model)
        put("appVersion", device.appVersion)
    })
}

enum class ConnectionStatus {
    CONNECTING,
    CONNECTED,
    RECONNECTING,
    OFFLINE,
}

/**
 * Owns the OkHttp WebSocket. All listener callbacks are delivered on the main
 * thread via [scope]; reconnect uses exponential backoff with jitter.
 */
class DeckConnection(
    private val client: OkHttpClient,
    private val scope: CoroutineScope,
    private val device: DeviceInfo,
    private val listener: Listener,
) {
    interface Listener {
        fun onStatus(status: ConnectionStatus)
        fun onOpen()
        fun onServerHello(serverName: String, protocol: Int, capabilities: Set<String>)
        fun onConfig(rawJson: String)
        fun onPressResult(
            requestId: String,
            buttonId: String,
            ok: Boolean,
            error: String?,
            message: String?,
        )
        fun onInputResult(requestId: String, controlId: String, ok: Boolean, error: String?)
        fun onBrightness(level: Float?)
        fun onServerError(code: String, message: String)
        fun onNavigate(direction: String, pageId: String?)
        fun onPong()
    }

    @Volatile
    private var active = false

    @Volatile
    private var connected = false

    @Volatile
    private var lastPongAt = 0L

    private var socketGeneration = 0L
    private var host = ""
    private var port = 0
    private var token = ""
    private var attempt = 0
    private var reconnectJob: Job? = null
    private var pingJob: Job? = null

    fun start(host: String, port: Int, token: String) {
        if (active && this.host == host && this.port == port && this.token == token) return
        Diag.i("WS start host=\"$host\" port=$port token=${Diag.maskToken(token)}")
        stopInternal(notify = false)
        this.host = host
        this.port = port
        this.token = token
        active = true
        attempt = 0
        listener.onStatus(ConnectionStatus.CONNECTING)
        connect()
    }

    fun stop() {
        active = false
        stopInternal(notify = true)
    }

    fun restart() {
        if (host.isBlank() || token.isBlank()) return
        stopInternal(notify = false)
        active = true
        attempt = 0
        listener.onStatus(ConnectionStatus.CONNECTING)
        connect()
    }

    fun isConnected(): Boolean = active && connected

    fun sendPress(
        requestId: String,
        profileId: String,
        pageId: String,
        buttonId: String,
    ): Boolean {
        val socket = webSocketRef
        if (!active || !connected || socket == null) {
            Diag.w("sendPress dropped: connected=$connected active=$active socket=${socket != null}")
            return false
        }
        val payload = buildJsonObject {
            put("type", "press")
            put("requestId", requestId)
            put("profileId", profileId)
            put("pageId", pageId)
            put("buttonId", buttonId)
        }
        return socket.send(payload.toString())
    }

    fun sendInput(
        requestId: String,
        profileId: String,
        pageId: String,
        controlId: String,
        phase: String,
        delta: Float? = null,
    ): Boolean {
        val socket = webSocketRef
        if (!active || !connected || socket == null) {
            Diag.w("sendInput dropped: connected=$connected active=$active socket=${socket != null}")
            return false
        }
        val payload = buildJsonObject {
            put("type", "input")
            put("requestId", requestId)
            put("profileId", profileId)
            put("pageId", pageId)
            put("controlId", controlId)
            put("phase", phase)
            if (delta != null) put("delta", delta.toDouble())
        }
        return socket.send(payload.toString())
    }

    fun newRequestId(): String = "r-${UUID.randomUUID()}"

    private fun connect() {
        if (!active) return
        val generation = ++socketGeneration
        val url = buildWebSocketUrl(host, port, token)
        if (url == null) {
            Diag.e("WS URL build failed for host=\"$host\" port=$port")
            listener.onServerError("bad_address", "The server address is not valid (\"$host:$port\").")
            scheduleReconnect(generation)
            return
        }

        Diag.d("WS URL ${Diag.redactUrl(url.toString())}")
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "PhoneDeck-Android")
            .build()

        val socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                scope.launch {
                    if (!active || generation != socketGeneration) {
                        webSocket.close(1000, "stale connection")
                        return@launch
                    }
                    Diag.i("WS connected to \"$host:$port\"")
                    webSocketRef = webSocket
                    connected = true
                    attempt = 0
                    lastPongAt = SystemClock.elapsedRealtime()
                    listener.onStatus(ConnectionStatus.CONNECTED)
                    listener.onOpen()
                    sendHello(webSocket)
                    startPing(generation, webSocket)
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text.length > MAX_MESSAGE_BYTES) return
                scope.launch {
                    if (!active || generation != socketGeneration) return@launch
                    handleMessage(text)
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Diag.w("WS closed code=$code reason=\"$reason\"")
                scope.launch { handleDisconnect(generation) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Diag.e("WS failure (http=${response?.code ?: "-"})", t)
                scope.launch { handleDisconnect(generation) }
            }
        })

        // Keep the local reference in sync. onOpen may race this assignment, but
        // onOpen sets the reference for the generation that is still current.
        if (generation == socketGeneration) {
            webSocketRef = socket
        } else {
            socket.cancel()
        }
    }

    @Volatile
    private var webSocketRef: WebSocket? = null

    private fun handleDisconnect(generation: Long) {
        if (!active || generation != socketGeneration) return
        connected = false
        webSocketRef = null
        pingJob?.cancel()
        pingJob = null
        listener.onStatus(ConnectionStatus.RECONNECTING)
        scheduleReconnect(generation)
    }

    private fun scheduleReconnect(generation: Long) {
        if (!active || generation != socketGeneration) return
        if (reconnectJob?.isActive == true) return
        attempt++
        val exponential = 1_000L shl min(attempt - 1, 4)
        val delayMs = min(MAX_BACKOFF_MS, exponential) + Random.nextLong(0, 400)
        Diag.i("WS reconnect #$attempt in ${delayMs}ms")
        reconnectJob = scope.launch {
            delay(delayMs)
            if (active && generation == socketGeneration) {
                connect()
            }
        }
    }

    private fun stopInternal(notify: Boolean) {
        socketGeneration++
        connected = false
        reconnectJob?.cancel()
        reconnectJob = null
        pingJob?.cancel()
        pingJob = null
        val socket = webSocketRef
        webSocketRef = null
        runCatching { socket?.close(1000, "client stopped") }
        if (notify) listener.onStatus(ConnectionStatus.OFFLINE)
    }

    private fun sendHello(socket: WebSocket) {
        socket.send(buildHelloPayload(device).toString())
    }

    private fun startPing(generation: Long, socket: WebSocket) {
        pingJob?.cancel()
        pingJob = scope.launch {
            while (active && generation == socketGeneration) {
                delay(PING_INTERVAL_MS)
                if (!active || generation != socketGeneration || !connected) break
                if (SystemClock.elapsedRealtime() - lastPongAt > PONG_TIMEOUT_MS) {
                    socket.cancel()
                    break
                }
                val ping = buildJsonObject {
                    put("type", "ping")
                    put("t", System.currentTimeMillis())
                }.toString()
                if (!socket.send(ping)) break
            }
        }
    }

    private fun handleMessage(text: String) {
        val obj = runCatching {
            DeckJson.format.parseToJsonElement(text) as? JsonObject
        }.getOrNull() ?: return

        val type = obj.string("type") ?: "unknown"
        Diag.d("WS <- type=$type bytes=${text.length}")
        when (type) {
            "hello" -> {
                val config = obj["config"]
                if (config != null) listener.onConfig(config.toString())
                val serverName = obj.string("serverName") ?: "PhoneDeck"
                val protocol = obj.int("protocol") ?: PROTOCOL_VERSION
                val capabilities = parseCapabilities(obj)
                Diag.i(
                    "WS hello from=\"$serverName\" protocol=$protocol " +
                        "capabilities=${capabilities.joinToString(",")} config=${config != null}",
                )
                listener.onServerHello(serverName, protocol, capabilities)
            }

            "config" -> {
                obj["config"]?.let { listener.onConfig(it.toString()) }
            }

            "pressResult" -> {
                val result = parsePressResult(obj)
                listener.onPressResult(
                    requestId = result.requestId,
                    buttonId = result.buttonId,
                    ok = result.ok,
                    error = result.error,
                    message = result.message,
                )
            }

            "inputResult" -> {
                listener.onInputResult(
                    requestId = obj.string("requestId").orEmpty(),
                    controlId = obj.string("controlId").orEmpty(),
                    ok = obj.bool("ok") ?: false,
                    error = obj.string("error"),
                )
            }

            "brightness" -> {
                when (val brightness = parseBrightness(obj)) {
                    is BrightnessMessage.Level -> listener.onBrightness(brightness.level)
                    BrightnessMessage.System -> listener.onBrightness(null)
                    BrightnessMessage.Invalid -> Unit
                }
            }

            "error" -> {
                val code = obj.string("code") ?: "error"
                val message = obj.string("message") ?: "The desktop reported an error."
                Diag.w("WS server error code=$code message=\"$message\"")
                listener.onServerError(code, message)
            }

            "navigate" -> {
                obj.string("direction")?.let { direction ->
                    listener.onNavigate(direction, obj.string("pageId"))
                }
            }

            "pong" -> {
                lastPongAt = SystemClock.elapsedRealtime()
                listener.onPong()
            }

            // Unknown message types are intentionally ignored for forward compatibility.
        }
    }

    private companion object {
        const val PING_INTERVAL_MS = 20_000L
        const val PONG_TIMEOUT_MS = 70_000L
        const val MAX_BACKOFF_MS = 20_000L
        const val MAX_MESSAGE_BYTES = 4 * 1024 * 1024
    }
}

internal data class PressResultPayload(
    val requestId: String,
    val buttonId: String,
    val ok: Boolean,
    val error: String?,
    val message: String?,
)

internal fun parseCapabilities(obj: JsonObject): Set<String> =
    obj.stringList("capabilities").orEmpty().toSet()

internal sealed interface BrightnessMessage {
    data class Level(val level: Float) : BrightnessMessage
    data object System : BrightnessMessage
    data object Invalid : BrightnessMessage
}

internal fun parseBrightness(obj: JsonObject): BrightnessMessage {
    val element = obj["level"] ?: return BrightnessMessage.Invalid
    if (element is JsonNull) return BrightnessMessage.System
    val primitive = element as? JsonPrimitive ?: return BrightnessMessage.Invalid
    if (primitive.isString) return BrightnessMessage.Invalid
    val level = primitive.floatOrNull ?: return BrightnessMessage.Invalid
    if (!level.isFinite() || level !in 0f..1f) return BrightnessMessage.Invalid
    return BrightnessMessage.Level(level)
}

internal fun parsePressResult(obj: JsonObject): PressResultPayload = PressResultPayload(
    requestId = obj.string("requestId").orEmpty(),
    buttonId = obj.string("buttonId").orEmpty(),
    ok = obj.bool("ok") ?: false,
    error = obj.string("error"),
    message = obj.string("message"),
)

private fun JsonObject.string(key: String): String? =
    (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.int(key: String): Int? =
    (this[key] as? JsonPrimitive)?.intOrNull

private fun JsonObject.bool(key: String): Boolean? =
    (this[key] as? JsonPrimitive)?.booleanOrNull

private fun JsonObject.stringList(key: String): List<String>? =
    (this[key] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
