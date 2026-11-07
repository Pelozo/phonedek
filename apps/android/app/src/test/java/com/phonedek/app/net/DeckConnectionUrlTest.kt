package com.phonedek.app.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeckConnectionUrlTest {
    @Test
    fun buildsAWebSocketUrlUsingHttpScheme() {
        // OkHttp rejects ws:// in HttpUrl.Builder; the handshake is HTTP anyway.
        val url = buildWebSocketUrl("192.168.1.42", 47654, "4821")
        assertEquals("http", url?.scheme)
        assertEquals("192.168.1.42", url?.host)
        assertEquals(47654, url?.port)
        assertEquals("/ws", url?.encodedPath)
        assertEquals("4821", url?.queryParameter("token"))
    }

    @Test
    fun rejectsUnusableAddresses() {
        assertNull(buildWebSocketUrl("", 47654, "4821"))
        assertNull(buildWebSocketUrl("bad host", 47654, "4821"))
        assertNull(buildWebSocketUrl("192.168.1.42", 0, "4821"))
    }
}
