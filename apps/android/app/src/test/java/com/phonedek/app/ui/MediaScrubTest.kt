package com.phonedek.app.ui

import com.phonedek.app.data.ControlStateEntryDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaScrubTest {
    @Test
    fun formatsClockTimesLikeTheDesktop() {
        assertEquals("0:00", MediaScrub.formatTime(0))
        assertEquals("1:05", MediaScrub.formatTime(65_000))
        assertEquals("3:45", MediaScrub.formatTime(225_000))
        assertEquals("1:02:03", MediaScrub.formatTime(3_723_000))
        assertEquals("1:00", MediaScrub.formatTime(59_600))
        // Corrupt/negative playheads must not render a negative clock.
        assertEquals("0:00", MediaScrub.formatTime(-5_000))
    }

    @Test
    fun formatsElapsedOverDuration() {
        assertEquals("1:23 / 3:45", MediaScrub.formatRange(83_000, 225_000))
        assertEquals("0:00 / 1:02:03", MediaScrub.formatRange(0, 3_723_000))
        // Unknown duration: show just the elapsed time.
        assertEquals("1:23", MediaScrub.formatRange(83_000, 0))
    }

    @Test
    fun convertsBetweenFractionsAndPlayheads() {
        assertEquals(0.5f, MediaScrub.fractionFor(60_000, 120_000), 0.0001f)
        assertEquals(0f, MediaScrub.fractionFor(-1_000, 120_000), 0.0001f)
        assertEquals(1f, MediaScrub.fractionFor(240_000, 120_000), 0.0001f)
        assertEquals(0f, MediaScrub.fractionFor(10_000, 0), 0.0001f)

        assertEquals(60_000L, MediaScrub.previewFor(0.5f, 120_000))
        assertEquals(0L, MediaScrub.previewFor(-1f, 120_000))
        assertEquals(120_000L, MediaScrub.previewFor(2f, 120_000))
        assertEquals(0L, MediaScrub.previewFor(0.5f, 0))
        assertEquals(0L, MediaScrub.previewFor(Float.NaN, 120_000))
    }

    @Test
    fun remotePlayheadAppliesWhileIdle() {
        val state = MediaScrubState()
            .applyRemote(positionMs = 30_000, durationMs = 120_000)

        assertEquals(30_000L, state.positionMs)
        assertEquals(120_000L, state.durationMs)
        assertEquals(30_000L, state.shownMs)
        assertEquals(0.25f, state.fraction, 0.0001f)
        assertFalse(state.dragging)
    }

    @Test
    fun dragKeepsThePreviewPositionUntilRelease() {
        val idle = MediaScrubState().applyRemote(positionMs = 0, durationMs = 120_000)
        val dragging = idle.startDrag(0.25f)
        assertEquals(30_000L, dragging.previewMs)
        assertEquals(30_000L, dragging.shownMs)

        val remote = dragging.applyRemote(positionMs = 90_000, durationMs = 240_000)
        assertTrue(remote.dragging)
        // Position is suppressed; duration is not.
        assertEquals(240_000L, remote.durationMs)
        assertEquals(30_000L, remote.previewMs)
        assertEquals(30_000L, remote.shownMs)

        val moved = remote.drag(0.5f)
        assertEquals(120_000L, moved.previewMs)
        assertEquals(0.5f, moved.fraction, 0.0001f)
        // Still no wire value and no change to the remote position.
        assertEquals(0L, moved.positionMs)

        // A transient unknown duration during buffering keeps the preview.
        val buffering = moved.applyRemote(positionMs = 0, durationMs = 0)
        assertEquals(240_000L, buffering.durationMs)
        assertEquals(120_000L, buffering.previewMs)
    }

    @Test
    fun releaseProducesTheSingleCommitFraction() {
        val idle = MediaScrubState().applyRemote(positionMs = 0, durationMs = 120_000)
        val dragging = idle.startDrag(0.1f).drag(0.4f)
        assertEquals(48_000L, dragging.shownMs)

        val released = dragging.release(0.75f)
        assertFalse(released.dragging)
        assertEquals(90_000L, released.positionMs)
        assertEquals(90_000L, released.shownMs)
        // The composable sends exactly this fraction on `end` (commit end).
        assertEquals(0.75f, released.fraction, 0.0001f)
    }

    @Test
    fun unavailableStateIsQuietAndExplainsWhy() {
        assertFalse(MediaScrub.isAvailable(null))
        assertEquals(MediaScrub.NO_PLAYER, MediaScrub.timeText(null, 0))
        assertEquals(MediaScrub.NO_PLAYER, MediaScrub.unavailableText(null))

        val noPlayer = state(available = false, detail = "NO PLAYER")
        assertFalse(MediaScrub.isAvailable(noPlayer))
        assertEquals("NO PLAYER", MediaScrub.unavailableText(noPlayer))
        assertEquals("NO PLAYER", MediaScrub.timeText(noPlayer, 0))
        assertNull(MediaScrub.titleText(noPlayer))
        assertNull(MediaScrub.artistText(noPlayer))

        val unsupported = state(available = false, detail = "SEEK UNSUPPORTED")
        assertEquals("SEEK UNSUPPORTED", MediaScrub.unavailableText(unsupported))
    }

    @Test
    fun availableStateFormatsTimeTitleArtistAndPlayCue() {
        val playing = state(
            available = true,
            detail = "1:23 / 3:45",
            positionMs = 83_000,
            durationMs = 225_000,
            playing = true,
            title = "  Midnight City  ",
            artist = "M83",
        )
        assertTrue(MediaScrub.isAvailable(playing))
        assertTrue(MediaScrub.isPlaying(playing))
        assertEquals("1:23 / 3:45", MediaScrub.timeText(playing, 83_000))
        assertEquals("Midnight City", MediaScrub.titleText(playing))
        assertEquals("M83", MediaScrub.artistText(playing))
        assertEquals("\u23F8\uFE0E", MediaScrub.glyph(playing = true))
        assertEquals("\u25B6\uFE0E", MediaScrub.glyph(playing = false))

        val paused = playing.copy(playing = false, title = null, artist = "   ")
        assertFalse(MediaScrub.isPlaying(paused))
        assertNull(MediaScrub.titleText(paused))
        assertNull(MediaScrub.artistText(paused))
    }

    private fun state(
        available: Boolean,
        detail: String? = null,
        positionMs: Long? = null,
        durationMs: Long? = null,
        playing: Boolean? = null,
        title: String? = null,
        artist: String? = null,
    ) = ControlStateEntryDto(
        controlId = "media",
        revision = 1,
        available = available,
        detail = detail,
        positionMs = positionMs,
        durationMs = durationMs,
        playing = playing,
        title = title,
        artist = artist,
    )
}
