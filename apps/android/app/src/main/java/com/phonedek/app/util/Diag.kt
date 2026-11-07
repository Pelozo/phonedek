package com.phonedek.app.util

import android.util.Log
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale

/**
 * Small in-memory + logcat diagnostic log.
 *
 * Tokens/PINs are never stored here. Use [maskToken] and redact URL query
 * parameters before logging network addresses.
 */
object Diag {
    const val TAG = "PhoneDeck"
    private const val MAX_LINES = 300
    private val lines = ArrayDeque<String>()
    private val lock = Any()
    private val timeFormat = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    fun d(message: String) = write("D", message, null)
    fun i(message: String) = write("I", message, null)
    fun w(message: String) = write("W", message, null)
    fun e(message: String, error: Throwable? = null) = write("E", message, error)

    fun maskToken(token: String): String =
        if (token.isBlank()) "blank" else "len=${token.length}"

    fun redactUrl(url: String): String =
        url.replace(Regex("([?&]token=)[^&]*"), "$1<redacted>")

    fun snapshot(): String = synchronized(lock) { lines.joinToString("\n") }

    fun clear() {
        synchronized(lock) { lines.clear() }
        Log.i(TAG, "Diagnostics cleared")
    }

    private fun write(level: String, message: String, error: Throwable?) {
        val line = synchronized(lock) {
            "${timeFormat.format(Date())} $level $message" +
                if (error != null) " | ${error.javaClass.simpleName}: ${error.message ?: "no message"}" else ""
        }
        synchronized(lock) {
            lines.addLast(line)
            while (lines.size > MAX_LINES) lines.removeFirst()
        }
        when (level) {
            "E" -> Log.e(TAG, line, error)
            "W" -> Log.w(TAG, line)
            else -> Log.d(TAG, line)
        }
    }
}
