package com.phonedek.app.net

import android.content.Context
import android.net.wifi.WifiManager
import android.os.SystemClock
import com.phonedek.app.data.DEFAULT_HTTP_PORT
import com.phonedek.app.data.DISCOVERY_PORT
import com.phonedek.app.data.DeckJson
import com.phonedek.app.data.PROTOCOL_VERSION
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketException
import java.net.SocketTimeoutException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

data class DiscoveredServer(
    val name: String,
    val host: String,
    val port: Int,
    val lastSeen: Long,
) {
    val key: String get() = "$host:$port"
}

/**
 * Listens for PhoneDeck beacons on UDP 47655 and broadcasts a discover probe
 * every two seconds. Requires a WifiManager multicast lock for broadcast
 * reception on many Android devices.
 */
class DiscoveryClient(context: Context) {
    private val appContext = context.applicationContext
    private var multicastLock: WifiManager.MulticastLock? = null
    private var job: Job? = null
    private var socket: DatagramSocket? = null
    private var runId = 0
    @Volatile
    private var running = false

    fun start(
        scope: CoroutineScope,
        onServer: (DiscoveredServer) -> Unit,
        onError: (String) -> Unit = {},
    ) {
        if (running) return
        running = true
        val id = ++runId
        acquireMulticastLock()

        job = scope.launch(Dispatchers.IO) {
            val receiveSocket = createSocket()
            if (receiveSocket == null) {
                if (running && id == runId) {
                    scope.launch {
                        onError("Network discovery is unavailable. Enter the address manually.")
                    }
                }
                running = false
                releaseMulticastLock()
                return@launch
            }
            socket = receiveSocket

            val probeBytes = """{"magic":"PHONEDECK","protocol":$PROTOCOL_VERSION,"type":"discover"}"""
                .toByteArray(Charsets.UTF_8)
            val broadcast = runCatching { InetAddress.getByName("255.255.255.255") }.getOrNull()
            var lastProbeAt = 0L

            try {
                while (running && id == runId) {
                    val now = SystemClock.elapsedRealtime()
                    if (broadcast != null && now - lastProbeAt >= PROBE_INTERVAL_MS) {
                        runCatching {
                            receiveSocket.send(
                                DatagramPacket(
                                    probeBytes,
                                    probeBytes.size,
                                    broadcast,
                                    DISCOVERY_PORT,
                                ),
                            )
                        }
                        lastProbeAt = now
                    }

                    val buffer = ByteArray(2048)
                    val packet = DatagramPacket(buffer, buffer.size)
                    try {
                        receiveSocket.receive(packet)
                    } catch (_: SocketTimeoutException) {
                        continue
                    }

                    val text = String(packet.data, packet.offset, packet.length, Charsets.UTF_8)
                    val server = parseBeacon(text, packet.address?.hostAddress) ?: continue
                    if (running && id == runId) {
                        scope.launch { if (running && id == runId) onServer(server) }
                    }
                }
            } catch (_: SocketException) {
                // Socket closed by stop().
            } catch (_: IOException) {
                if (running && id == runId) {
                    scope.launch {
                        onError("Network discovery stopped. Enter the address manually.")
                    }
                }
            } finally {
                runCatching { receiveSocket.close() }
                if (socket === receiveSocket) socket = null
            }
        }
    }

    fun stop() {
        running = false
        runId++
        job?.cancel()
        job = null
        runCatching { socket?.close() }
        socket = null
        releaseMulticastLock()
    }

    private fun createSocket(): DatagramSocket? {
        val broadcastSocket = runCatching {
            DatagramSocket(null).apply {
                reuseAddress = true
                broadcast = true
                soTimeout = RECEIVE_TIMEOUT_MS
                bind(InetSocketAddress(DISCOVERY_PORT))
            }
        }.getOrNull()
        if (broadcastSocket != null) return broadcastSocket

        // Some devices/another app may hold 47655. An ephemeral port still
        // receives the desktop's unicast reply to our probe.
        return runCatching {
            DatagramSocket().apply {
                broadcast = true
                soTimeout = RECEIVE_TIMEOUT_MS
            }
        }.getOrNull()
    }

    private fun parseBeacon(text: String, hostAddress: String?): DiscoveredServer? {
        val host = hostAddress?.substringBefore('%')?.takeIf { it.isNotBlank() } ?: return null
        val obj = runCatching {
            DeckJson.format.parseToJsonElement(text) as? JsonObject
        }.getOrNull() ?: return null

        if (obj.string("magic") != "PHONEDECK") return null
        if (obj.int("protocol") != PROTOCOL_VERSION) return null
        if (obj.string("type") != "beacon") return null

        val port = (obj.int("port") ?: DEFAULT_HTTP_PORT).takeIf { it in 1..65535 }
            ?: DEFAULT_HTTP_PORT
        return DiscoveredServer(
            name = obj.string("name")?.takeIf { it.isNotBlank() } ?: "PhoneDeck",
            host = host,
            port = port,
            lastSeen = SystemClock.elapsedRealtime(),
        )
    }

    private fun acquireMulticastLock() {
        val wifi = runCatching {
            appContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        }.getOrNull() ?: return
        runCatching {
            wifi.createMulticastLock("phonedek-discovery").apply {
                setReferenceCounted(false)
                acquire()
            }
        }.onSuccess { multicastLock = it }
    }

    private fun releaseMulticastLock() {
        val lock = multicastLock ?: return
        multicastLock = null
        runCatching { if (lock.isHeld) lock.release() }
    }

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.contentOrNull

    private fun JsonObject.int(key: String): Int? =
        (this[key] as? JsonPrimitive)?.intOrNull

    private companion object {
        const val PROBE_INTERVAL_MS = 2_000L
        const val RECEIVE_TIMEOUT_MS = 900
    }
}
