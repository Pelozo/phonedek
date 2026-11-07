package com.phonedek.app.net

import com.phonedek.app.data.DEFAULT_HTTP_PORT
import com.phonedek.app.data.DeckConfig
import com.phonedek.app.data.DeckJson
import android.os.SystemClock
import com.phonedek.app.util.Diag
import java.io.IOException
import java.io.InterruptedIOException
import java.io.OutputStream
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

sealed interface FetchResult {
    data class Success(val raw: String, val config: DeckConfig) : FetchResult
    data class Failure(val message: String, val unauthorized: Boolean = false) : FetchResult
}

sealed interface BackupResult {
    data class Success(val bytes: Long) : BackupResult
    data class Failure(
        val message: String,
        val unsupported: Boolean = false,
    ) : BackupResult
}

fun createHttpClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(6, TimeUnit.SECONDS)
    .readTimeout(15, TimeUnit.SECONDS)
    .writeTimeout(15, TimeUnit.SECONDS)
    .callTimeout(25, TimeUnit.SECONDS)
    .retryOnConnectionFailure(true)
    .addInterceptor { chain ->
        val request = chain.request()
        val safeUrl = Diag.redactUrl(request.url.toString())
        Diag.d("HTTP ${request.method} $safeUrl")
        val started = SystemClock.elapsedRealtime()
        try {
            val response = chain.proceed(request)
            Diag.d("HTTP ${response.code} $safeUrl (${SystemClock.elapsedRealtime() - started} ms)")
            response
        } catch (error: IOException) {
            Diag.e("HTTP failed $safeUrl after ${SystemClock.elapsedRealtime() - started} ms", error)
            throw error
        }
    }
    .build()

/**
 * WebSockets are long-lived, so they must not inherit the HTTP call timeout.
 * The app-level ping/pong watchdog in DeckConnection detects dead links.
 */
fun createWebSocketClient(): OkHttpClient = createHttpClient()
    .newBuilder()
    .callTimeout(0, TimeUnit.MILLISECONDS)
    .readTimeout(0, TimeUnit.MILLISECONDS)
    .build()

fun httpBaseUrl(host: String, port: Int): HttpUrl =
    HttpUrl.Builder()
        .scheme("http")
        .host(host)
        .port(port)
        .build()

fun assetUrl(host: String, port: Int, asset: String, token: String? = null): String? = runCatching {
    HttpUrl.Builder()
        .scheme("http")
        .host(host)
        .port(port)
        .addPathSegment("assets")
        .addPathSegment(asset)
        .apply {
            if (!token.isNullOrBlank()) addQueryParameter("token", token)
        }
        .build()
        .toString()
}.getOrNull()

class HttpApi(private val client: OkHttpClient) {
    // Backups can be large; do not inherit the short config call/read timeout.
    private val backupClient: OkHttpClient = client.newBuilder()
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .writeTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    suspend fun fetchConfig(host: String, port: Int, token: String): FetchResult =
        withContext(Dispatchers.IO) {
            Diag.i("fetchConfig: host=\"$host\" port=$port token=${Diag.maskToken(token)}")
            val urlResult = runCatching {
                HttpUrl.Builder()
                    .scheme("http")
                    .host(host)
                    .port(port)
                    .addPathSegment("api")
                    .addPathSegment("config")
                    .build()
            }
            val url = urlResult.getOrNull() ?: run {
                Diag.e("fetchConfig: could not build HTTP URL for host=\"$host\" port=$port", urlResult.exceptionOrNull())
                return@withContext FetchResult.Failure(
                    "That server address is not valid.",
                )
            }

            val request = Request.Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .header("User-Agent", "PhoneDeck-Android")
                .build()

            Diag.d("fetchConfig URL ${Diag.redactUrl(url.toString())}")
            try {
                client.newCall(request).execute().use { response ->
                    when {
                        response.code == 401 || response.code == 403 -> FetchResult.Failure(
                            "PIN rejected. Check the 4-digit PIN shown in PhoneDeck on your PC.",
                            unauthorized = true,
                        )

                        !response.isSuccessful -> FetchResult.Failure(
                            "Server returned HTTP ${response.code}.",
                        )

                        else -> {
                            val raw = response.body?.string().orEmpty()
                            if (raw.isBlank()) {
                                FetchResult.Failure("The server returned an empty config.")
                            } else {
                                val config = DeckJson.parse(raw)
                                if (config == null) {
                                    FetchResult.Failure(
                                        "The server sent a config this app cannot read.",
                                    )
                                } else {
                                    FetchResult.Success(raw, config)
                                }
                            }
                        }
                    }
                }
            } catch (error: InterruptedIOException) {
                Diag.e("fetchConfig timeout for \"$host:$port\"", error)
                FetchResult.Failure(
                    "Connection timed out. Check the address and that PhoneDeck is running.",
                )
            } catch (error: IOException) {
                Diag.e("fetchConfig IO failure for \"$host:$port\"", error)
                FetchResult.Failure(
                    "Could not reach $host:$port. Check Wi-Fi and the server address.",
                )
            } catch (error: Exception) {
                Diag.e("fetchConfig unexpected failure for \"$host:$port\"", error)
                FetchResult.Failure(
                    "Could not load the deck: ${error.message ?: "unknown error"}",
                )
            }
        }

    suspend fun downloadBackup(
        host: String,
        port: Int,
        token: String,
        outputStream: OutputStream,
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ): BackupResult = withContext(Dispatchers.IO) {
        val urlResult = runCatching {
            HttpUrl.Builder()
                .scheme("http")
                .host(host)
                .port(port)
                .addPathSegment("api")
                .addPathSegment("backup")
                .build()
        }
        val url = urlResult.getOrNull() ?: run {
            Diag.e(
                "downloadBackup: could not build HTTP URL for host=\"$host\" port=$port",
                urlResult.exceptionOrNull(),
            )
            return@withContext BackupResult.Failure("That server address is not valid.")
        }

        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/zip")
            .header("User-Agent", "PhoneDeck-Android")
            .build()

        Diag.i("downloadBackup: host=\"$host\" port=$port token=${Diag.maskToken(token)}")
        Diag.d("downloadBackup URL ${Diag.redactUrl(url.toString())}")

        try {
            backupClient.newCall(request).execute().use responseUse@ { response ->
                when {
                    response.code == 401 || response.code == 403 -> BackupResult.Failure(
                        "PIN rejected. Check the 4-digit PIN shown in PhoneDeck on your PC.",
                    )

                    response.code == 404 -> BackupResult.Failure(
                        "Update PhoneDeck on your PC to enable backups.",
                        unsupported = true,
                    )

                    response.code != 200 -> BackupResult.Failure(
                        "Backup failed (HTTP ${response.code}).",
                    )

                    else -> {
                        val body = response.body
                            ?: return@responseUse BackupResult.Failure(
                                "The PC returned an empty backup.",
                            )
                        val contentLength = body.contentLength()
                        val zipContentType = response.header("Content-Type")
                            ?.lowercase()
                            ?.contains("zip") == true

                        body.byteStream().use inputUse@ { input ->
                            val header = ByteArray(4)
                            var headerLength = 0
                            while (headerLength < header.size) {
                                currentCoroutineContext().ensureActive()
                                val read = input.read(
                                    header,
                                    headerLength,
                                    header.size - headerLength,
                                )
                                if (read <= 0) break
                                headerLength += read
                            }
                            if (headerLength < 4) {
                                return@inputUse BackupResult.Failure(
                                    "The PC returned an empty or invalid backup.",
                                )
                            }
                            if (!isZipHeader(header, headerLength) && !zipContentType) {
                                return@inputUse BackupResult.Failure(
                                    "The PC returned a non-ZIP response. " +
                                        "Update PhoneDeck on your PC and try again.",
                                )
                            }

                            outputStream.write(header, 0, headerLength)
                            var total = headerLength.toLong()
                            val expected = if (contentLength > 0) contentLength else -1L
                            var lastReported = -1L

                            onProgress(total, expected)
                            lastReported = total

                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                currentCoroutineContext().ensureActive()
                                val read = input.read(buffer)
                                if (read < 0) break
                                outputStream.write(buffer, 0, read)
                                total += read
                                if (total - lastReported >= 256 * 1024) {
                                    onProgress(total, expected)
                                    lastReported = total
                                }
                            }
                            outputStream.flush()
                            onProgress(total, expected)

                            if (expected > 0 && total != expected) {
                                BackupResult.Failure(
                                    "The backup download was incomplete. Try again.",
                                )
                            } else {
                                BackupResult.Success(total)
                            }
                        }
                    }
                }
            }
        } catch (error: kotlinx.coroutines.CancellationException) {
            throw error
        } catch (error: InterruptedIOException) {
            Diag.e("downloadBackup timeout for \"$host:$port\"", error)
            BackupResult.Failure("Backup download timed out. Try again.")
        } catch (error: IOException) {
            Diag.e("downloadBackup IO failure for \"$host:$port\"", error)
            val detail = error.message.orEmpty()
            val message = if (
                detail.contains("ENOSPC", ignoreCase = true) ||
                detail.contains("no space", ignoreCase = true)
            ) {
                "Not enough space to save the backup."
            } else {
                "Backup download failed. Check Wi-Fi and free space."
            }
            BackupResult.Failure(message)
        } catch (error: Exception) {
            Diag.e("downloadBackup unexpected failure for \"$host:$port\"", error)
            BackupResult.Failure(
                "Backup failed: ${error.message ?: "unknown error"}",
            )
        }
    }

    companion object {
        const val DEFAULT_PORT = DEFAULT_HTTP_PORT
    }
}

private fun isZipHeader(bytes: ByteArray, length: Int): Boolean {
    if (length < 4) return false
    if (bytes[0] != 0x50.toByte() || bytes[1] != 0x4B.toByte()) return false
    return when {
        bytes[2] == 0x03.toByte() -> bytes[3] == 0x04.toByte()
        bytes[2] == 0x05.toByte() -> bytes[3] == 0x06.toByte()
        bytes[2] == 0x07.toByte() -> bytes[3] == 0x08.toByte()
        else -> false
    }
}
