package com.phonedek.app.util

data class Endpoint(val host: String, val port: Int)

/**
 * Accepts "192.168.1.42", "192.168.1.42:47654", "http://host:port/path",
 * "[fe80::1]:47654" and bare hostnames. Returns null for blank/invalid input.
 */
fun parseEndpoint(input: String, fallbackPort: Int = 47654): Endpoint? {
    var raw = input.trim()
    if (raw.isEmpty()) return null

    val scheme = raw.indexOf("://")
    if (scheme >= 0) raw = raw.substring(scheme + 3)
    raw = raw.substringBefore('/').substringBefore('?').substringBefore('#')
    if (raw.isBlank()) return null

    if (raw.startsWith("[")) {
        val close = raw.indexOf(']')
        if (close <= 1) return null
        val host = raw.substring(1, close)
        val remainder = raw.substring(close + 1)
        val port = if (remainder.startsWith(":")) {
            remainder.drop(1).toIntOrNull()?.takeIf { it in 1..65535 } ?: fallbackPort
        } else {
            fallbackPort
        }
        return Endpoint(host, port).takeIf { it.isValid() }
    }

    val colonCount = raw.count { it == ':' }
    if (colonCount == 1) {
        val host = raw.substringBefore(':')
        val port = raw.substringAfter(':').toIntOrNull()
        if (host.isNotBlank() && port != null && port in 1..65535) {
            return Endpoint(host, port)
        }
        return null
    }
    if (colonCount > 1 || raw.any { it.isWhitespace() }) return null

    return Endpoint(raw, fallbackPort).takeIf { it.isValid() }
}

private fun Endpoint.isValid(): Boolean =
    host.isNotBlank() && port in 1..65535 &&
        host.none { it.isWhitespace() || it == '/' || it == '\\' }
