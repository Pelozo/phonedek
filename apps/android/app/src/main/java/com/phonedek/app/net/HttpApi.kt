package com.phonedek.app.net

import com.phonedek.app.data.DEFAULT_HTTP_PORT
import com.phonedek.app.data.DeckConfig
import com.phonedek.app.data.DeckJson
import android.os.SystemClock
import com.phonedek.app.util.Diag
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

sealed interface FetchResult {
    data class Success(val raw: String, val config: DeckConfig) : FetchResult
    data class Failure(val message: String, val unauthorized: Boolean = false) : FetchResult
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

    companion object {
        const val DEFAULT_PORT = DEFAULT_HTTP_PORT
    }
}
