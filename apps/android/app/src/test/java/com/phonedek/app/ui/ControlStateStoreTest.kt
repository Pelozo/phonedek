package com.phonedek.app.ui

import com.phonedek.app.data.ActionDto
import com.phonedek.app.data.ControlBindingDto
import com.phonedek.app.data.ControlDto
import com.phonedek.app.data.ControlStateEntryDto
import com.phonedek.app.data.DeckButton
import com.phonedek.app.data.DeckPage
import com.phonedek.app.data.StateBindingDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ControlStateStoreTest {
    @Test
    fun mergeIgnoresStaleAndEqualRevisions() {
        val current = mapOf(
            "vol" to state("vol", revision = 5, value = 0.5f),
        )

        val equal = ControlStateStore.merge(
            current,
            listOf(state("vol", revision = 5, value = 0.9f)),
        )
        assertSame(current, equal)

        val older = ControlStateStore.merge(
            current,
            listOf(state("vol", revision = 4, value = 0.1f)),
        )
        assertSame(current, older)
    }

    @Test
    fun mergeAcceptsNewerRevisionsAndKeepsOtherControls() {
        val current = mapOf(
            "vol" to state("vol", revision = 5, value = 0.5f),
            "other" to state("other", revision = 1, value = 0.2f),
        )

        val merged = ControlStateStore.merge(
            current,
            listOf(
                state("vol", revision = 6, value = 0.7f),
                state("new", revision = 3, value = 0.3f),
            ),
        )

        assertEquals(0.7f, merged["vol"]!!.value!!, 0.0001f)
        assertEquals(6, merged["vol"]!!.revision)
        assertEquals(0.2f, merged["other"]!!.value!!, 0.0001f)
        assertEquals(0.3f, merged["new"]!!.value!!, 0.0001f)
    }

    @Test
    fun onlyAbsoluteVolumeMicGainAndObsControlsAreWatchable() {
        val page = DeckPage(
            id = "pg1",
            buttons = listOf(
                button("abs-slider"),
                button("abs-wheel", kind = "dial"),
                button("mic", type = "mic", mode = "gain"),
                button("obs", type = "obs", mode = null, target = "inputVolume"),
                button("relative", mode = "relative", emit = "delta"),
                button("scroll", type = "scroll", mode = null, emit = "delta"),
                button(
                    "shortcut",
                    type = "shortcut",
                    mode = null,
                    emit = "delta",
                ),
                // Defensive: even a malformed value-emitting shortcut must not
                // enter the live-state watch (shortcuts have no desktop value).
                button(
                    "shortcut-value",
                    type = "shortcut",
                    mode = null,
                    emit = "value",
                ),
                button("pad", kind = "trackpad", type = "pointer", mode = null, emit = "delta"),
                button("bad-mic-mode", type = "mic", mode = "relative"),
                button("bad-obs-target", type = "obs", mode = null, target = "inputMute"),
                button(
                    "obs-delta",
                    type = "obs",
                    mode = null,
                    target = "inputVolume",
                    emit = "delta",
                ),
                button("plain", control = null),
                button("", control = null),
                button(
                    "status-stream",
                    control = null,
                    state = StateBindingDto(type = "obs", target = "streaming"),
                ),
                button(
                    "status-scene",
                    control = null,
                    state = StateBindingDto(
                        type = "obs",
                        target = "scene",
                        scene = "Game",
                    ),
                ),
            ),
        )

        assertEquals(
            listOf("abs-slider", "abs-wheel", "mic", "obs", "status-stream", "status-scene"),
            ControlStateStore.statefulControlIds(page),
        )
    }

    @Test
    fun watchIdsSkipUnboundButtonsAndKeepStateButtonsDistinct() {
        val page = DeckPage(
            id = "pg1",
            buttons = listOf(
                button("plain", control = null),
                button("", control = null),
                button(
                    "state-with-control",
                    type = "obs",
                    mode = null,
                    target = "inputVolume",
                    state = StateBindingDto(type = "obs", target = "inputVolume"),
                ),
            ),
        )

        assertEquals(
            listOf("state-with-control"),
            ControlStateStore.statefulControlIds(page),
        )
    }

    @Test
    fun detectsObsValueControlsAndObsActions() {
        val obs = ControlDto(
            kind = "slider",
            emit = "value",
            binding = ControlBindingDto(type = "obs", target = "inputVolume"),
        )
        assertTrue(ControlStateStore.isObsValueControl(obs))
        assertFalse(ControlStateStore.isObsValueControl(obs.copy(emit = "delta")))
        assertFalse(
            ControlStateStore.isObsValueControl(
                obs.copy(binding = obs.binding.copy(target = "inputMute")),
            ),
        )
        assertFalse(ControlStateStore.isObsValueControl(null))

        assertTrue(
            ControlStateStore.hasObsAction(
                listOf(ActionDto(type = "obs", action = "toggleMute")),
            ),
        )
        assertFalse(
            ControlStateStore.hasObsAction(
                listOf(ActionDto(type = "mic", action = "toggleMute")),
            ),
        )
    }

    @Test
    fun obsDisplayTextUsesDesktopDetailStrings() {
        assertEquals(
            "150%",
            ControlStateStore.displayText(
                localText = "100%",
                statePresent = true,
                stateAvailable = true,
                stateMuted = false,
                stateDetail = "150%",
                interacting = false,
            ),
        )
        assertEquals(
            ControlStateStore.MUTED,
            ControlStateStore.displayText(
                localText = "100%",
                statePresent = true,
                stateAvailable = true,
                stateMuted = true,
                stateDetail = "MUTED",
                interacting = false,
            ),
        )
        // Older/desktop-only state may carry MUTED as detail without the flag.
        assertEquals(
            ControlStateStore.MUTED,
            ControlStateStore.displayText(
                localText = "100%",
                statePresent = true,
                stateAvailable = true,
                stateMuted = false,
                stateDetail = "MUTED",
                interacting = false,
            ),
        )
        assertEquals(
            ControlStateStore.NO_OBS,
            ControlStateStore.displayText(
                localText = "100%",
                statePresent = true,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = "NO OBS",
                interacting = false,
            ),
        )
        assertEquals(
            ControlStateStore.NO_INPUT,
            ControlStateStore.displayText(
                localText = "100%",
                statePresent = true,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = "NO INPUT",
                interacting = false,
            ),
        )
        assertEquals(
            ControlStateStore.SWITCHING,
            ControlStateStore.displayText(
                localText = "100%",
                statePresent = true,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = "SWITCHING",
                interacting = false,
            ),
        )
        // Dragging keeps the local readout even while OBS is unavailable.
        assertEquals(
            "175%",
            ControlStateStore.displayText(
                localText = "175%",
                statePresent = true,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = "NO OBS",
                interacting = true,
            ),
        )
    }

    @Test
    fun micDisplayTextShowsDesktopDetailMuteAndUnavailable() {
        assertEquals(
            "42%",
            ControlStateStore.displayText(
                localText = "50%",
                statePresent = true,
                stateAvailable = true,
                stateMuted = false,
                stateDetail = "42%",
                interacting = false,
            ),
        )
        assertEquals(
            ControlStateStore.MUTED,
            ControlStateStore.displayText(
                localText = "50%",
                statePresent = true,
                stateAvailable = true,
                stateMuted = true,
                stateDetail = null,
                interacting = false,
            ),
        )
        assertEquals(
            ControlStateStore.NO_INPUT,
            ControlStateStore.displayText(
                localText = "50%",
                statePresent = true,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = "Unavailable",
                interacting = false,
            ),
        )
        // The local value remains authoritative while dragging and when there
        // is no state entry at all (old desktop or non-mic control).
        assertEquals(
            "73%",
            ControlStateStore.displayText(
                localText = "73%",
                statePresent = true,
                stateAvailable = true,
                stateMuted = true,
                stateDetail = "MUTED",
                interacting = true,
            ),
        )
        assertEquals(
            "73%",
            ControlStateStore.displayText(
                localText = "73%",
                statePresent = false,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = null,
                interacting = false,
            ),
        )
    }

    @Test
    fun plainTileStateShowsDetailAndActiveFallback() {
        val streaming = StateBindingDto(type = "obs", target = "streaming")
        assertEquals(
            "LIVE",
            ControlStateStore.stateTileText(
                streaming,
                state("stream", 3, detail = "LIVE", active = true),
                stateCapable = true,
            ),
        )
        // A sparse desktop update without a detail still gets an active cue.
        assertEquals(
            "LIVE",
            ControlStateStore.stateTileText(
                streaming,
                state("stream", 4, detail = null, active = true),
                stateCapable = true,
            ),
        )
        assertEquals(
            "OFF",
            ControlStateStore.stateTileText(
                streaming,
                state("stream", 5, detail = null, active = false),
                stateCapable = true,
            ),
        )
        // No entry yet: nothing on an old desktop, a placeholder once the
        // desktop advertises control-state-v1.
        assertNull(ControlStateStore.stateTileText(streaming, null, stateCapable = false))
        assertEquals(
            ControlStateStore.NO_STATE,
            ControlStateStore.stateTileText(streaming, null, stateCapable = true),
        )
        assertNull(ControlStateStore.stateTileText(null, null, stateCapable = true))
        assertFalse(ControlStateStore.stateTileActive(null))
        assertTrue(
            ControlStateStore.stateTileActive(
                state("stream", 6, detail = "LIVE", active = true),
            ),
        )
    }

    @Test
    fun stateTileTextMapsEveryObsStatusCue() {
        fun text(
            target: String,
            detail: String? = null,
            active: Boolean? = null,
            available: Boolean = true,
            muted: Boolean = false,
            value: Float? = null,
            scene: String? = null,
        ) = ControlStateStore.stateTileText(
            StateBindingDto(type = "obs", target = target, scene = scene),
            ControlStateEntryDto(
                controlId = "tile",
                revision = 1,
                value = value,
                muted = muted,
                available = available,
                detail = detail,
                active = active,
            ),
            stateCapable = true,
        )

        assertEquals("LIVE", text("streaming", detail = "LIVE", active = true))
        assertEquals("REC", text("recording", detail = "REC", active = true))
        assertEquals("REPLAY", text("replay", detail = "REPLAY", active = true))
        assertEquals("VCAM", text("virtualCam", detail = "VCAM", active = true))
        assertEquals("OFF", text("recording", detail = "OFF", active = false))
        assertEquals("REC", text("recording", active = true))
        assertEquals("OFF", text("streaming", active = false))
        assertEquals("MUTED", text("inputMute", detail = "MUTED", active = true))
        assertEquals(
            "MUTED",
            text("inputMute", detail = "ON", active = true, muted = true),
        )
        assertEquals("42%", text("inputVolume", detail = "42%"))
        assertEquals("63%", text("inputVolume", value = 0.63f))
        assertEquals(
            "SCENE: Game",
            text("scene", detail = "Game", active = true, scene = "Game"),
        )
        assertEquals("NO SCENE", text("scene", detail = "NO SCENE", available = true))
        assertEquals("NO OBS", text("streaming", detail = "NO OBS", available = false))
    }

    @Test
    fun watchIdsIncludeTwitchStateButtons() {
        val page = DeckPage(
            id = "pg1",
            buttons = listOf(
                button("plain", control = null),
                button(
                    "twitch-live",
                    control = null,
                    state = StateBindingDto(type = "twitch", target = "live"),
                ),
                button(
                    "twitch-title",
                    control = null,
                    state = StateBindingDto(type = "twitch", target = "title"),
                ),
                button(
                    "twitch-with-control",
                    type = "obs",
                    mode = null,
                    target = "inputVolume",
                    state = StateBindingDto(type = "twitch", target = "viewers"),
                ),
                button("", control = null, state = StateBindingDto(type = "twitch", target = "game")),
            ),
        )

        assertEquals(
            listOf("twitch-live", "twitch-title", "twitch-with-control"),
            ControlStateStore.statefulControlIds(page),
        )
        assertTrue(
            ControlStateStore.hasTwitchStateBinding(
                DeckButton(state = StateBindingDto(type = "twitch", target = "uptime")),
            ),
        )
        assertFalse(ControlStateStore.hasTwitchStateBinding(
            DeckButton(state = StateBindingDto(type = "obs", target = "streaming")),
        ))
    }

    @Test
    fun twitchStateTileShowsDetailAndUsesTheLiveCue() {
        fun text(
            target: String,
            detail: String? = null,
            active: Boolean? = null,
            available: Boolean = true,
        ) = ControlStateStore.stateTileText(
            StateBindingDto(type = "twitch", target = target),
            ControlStateEntryDto(
                controlId = "tile",
                revision = 1,
                available = available,
                detail = detail,
                active = active,
            ),
            stateCapable = true,
        )

        // Live cue plus each Helix detail form.
        assertEquals("LIVE", text("live", detail = "LIVE", active = true))
        assertEquals("OFF", text("live", detail = "OFF", available = false))
        assertEquals("321", text("viewers", detail = "321", active = true))
        assertEquals("1:23:45", text("uptime", detail = "1:23:45", active = true))
        assertEquals("Late night ranked", text("title", detail = "Late night ranked"))
        assertEquals("VALORANT", text("game", detail = "VALORANT"))
        // Sparse live update without a detail still gets a cue.
        assertEquals("LIVE", text("live", active = true))
        assertEquals("OFF", text("live", active = false))

        // Outage/unauthorized text is shown quietly on the tile.
        assertEquals("NO TWITCH", text("live", detail = "NO TWITCH", available = false))
        assertEquals("TWITCH OFF", text("viewers", detail = "TWITCH OFF", available = false))
        assertEquals(ControlStateStore.NO_TWITCH, text("live", available = false, detail = null))

        // No entry yet: placeholder only on a state-capable desktop.
        assertNull(
            ControlStateStore.stateTileText(
                StateBindingDto(type = "twitch", target = "live"),
                null,
                stateCapable = false,
            ),
        )
        assertEquals(
            ControlStateStore.NO_STATE,
            ControlStateStore.stateTileText(
                StateBindingDto(type = "twitch", target = "live"),
                null,
                stateCapable = true,
            ),
        )
    }

    @Test
    fun twitchActiveTreatmentRequiresAvailableAndTheLiveCue() {
        val live = StateBindingDto(type = "twitch", target = "live")
        assertEquals("LIVE", ControlStateStore.stateTileText(
            live,
            state("twitch", 1, detail = "LIVE", active = true),
            stateCapable = true,
        ))
        assertTrue(
            ControlStateStore.stateTileActive(
                state("twitch", 1, detail = "LIVE", active = true),
            ),
        )
        // Offline, viewer-count and title/game chips never use the accent.
        assertFalse(
            ControlStateStore.stateTileActive(
                state("twitch", 2, detail = "OFF", active = false, available = false),
            ),
        )
        assertFalse(
            ControlStateStore.stateTileActive(
                state("twitch", 3, detail = "NO TWITCH", available = false),
            ),
        )
        assertFalse(
            ControlStateStore.stateTileActive(
                state("twitch", 4, detail = "Late night ranked"),
            ),
        )
        // Viewers/uptime are live-derived readings, so the live cue still
        // applies while active.
        assertTrue(
            ControlStateStore.stateTileActive(
                state("twitch", 5, detail = "321", active = true),
            ),
        )
    }

    @Test
    fun watchIdsIncludeLightControlsAndLightStateButtons() {
        val page = DeckPage(
            id = "pg1",
            buttons = listOf(
                button("plain", control = null),
                button("bright", type = "light", mode = null, target = "brightness"),
                button("temp-wheel", kind = "dial", type = "light", mode = null, target = "temperature"),
                button("power-value", type = "light", mode = null, target = "power"),
                button(
                    "light-delta",
                    type = "light",
                    mode = null,
                    target = "brightness",
                    emit = "delta",
                ),
                button(
                    "light-power-tile",
                    control = null,
                    state = StateBindingDto(type = "light", target = "power"),
                ),
                button(
                    "light-temp-tile",
                    control = null,
                    state = StateBindingDto(type = "light", target = "temperature", light = "desk"),
                ),
                button(
                    "light-with-control",
                    type = "light",
                    mode = null,
                    target = "brightness",
                    state = StateBindingDto(type = "light", target = "brightness"),
                ),
                button("", control = null, state = StateBindingDto(type = "light", target = "power")),
            ),
        )

        assertEquals(
            listOf(
                "bright",
                "temp-wheel",
                "power-value",
                "light-power-tile",
                "light-temp-tile",
                "light-with-control",
            ),
            ControlStateStore.statefulControlIds(page),
        )
        assertTrue(
            ControlStateStore.hasLightStateBinding(
                DeckButton(state = StateBindingDto(type = "light", target = "power")),
            ),
        )
        assertFalse(
            ControlStateStore.hasLightStateBinding(
                DeckButton(state = StateBindingDto(type = "obs", target = "streaming")),
            ),
        )
        assertTrue(
            ControlStateStore.hasLightAction(
                listOf(ActionDto(type = "light", action = "togglePower")),
            ),
        )
        assertFalse(
            ControlStateStore.hasLightAction(
                listOf(ActionDto(type = "obs", action = "toggleMute")),
            ),
        )
        assertTrue(
            ControlStateStore.isLightValueControl(
                ControlDto(
                    kind = "slider",
                    emit = "value",
                    binding = ControlBindingDto(type = "light", target = "brightness"),
                ),
            ),
        )
        assertFalse(
            ControlStateStore.isLightValueControl(
                ControlDto(
                    kind = "slider",
                    emit = "delta",
                    binding = ControlBindingDto(type = "light", target = "brightness"),
                ),
            ),
        )
    }

    @Test
    fun lightStateTilesShowOnOffPercentMiredAndQuietOutages() {
        fun text(
            target: String,
            detail: String? = null,
            active: Boolean? = null,
            available: Boolean = true,
            value: Float? = null,
        ) = ControlStateStore.stateTileText(
            StateBindingDto(type = "light", target = target),
            ControlStateEntryDto(
                controlId = "tile",
                revision = 1,
                value = value,
                available = available,
                detail = detail,
                active = active,
            ),
            stateCapable = true,
        )

        assertEquals("ON", text("power", detail = "ON", active = true))
        assertEquals("OFF", text("power", detail = "OFF", active = false))
        assertEquals("42%", text("brightness", detail = "42%", active = true))
        assertEquals("250", text("temperature", detail = "250", active = true))
        assertEquals("OFF", text("brightness", detail = "OFF", active = false))
        assertEquals("OFF", text("temperature", detail = "OFF", active = false))

        // Sparse updates derive the short form from the normalized value.
        assertEquals("ON", text("power", active = true))
        assertEquals("OFF", text("power", active = false))
        assertEquals("63%", text("brightness", value = 0.63f))
        assertEquals("0%", text("brightness", value = 0f))
        assertEquals("244", text("temperature", value = 0.5f))
        assertEquals("143", text("temperature", value = 0f))
        assertEquals("344", text("temperature", value = 1f))
        assertEquals("OFF", text("brightness", active = false))

        // Missing/unreachable lights are quiet tile text, never toasts.
        assertEquals("NO LIGHT", text("power", detail = "NO LIGHT", available = false))
        assertEquals("OFFLINE", text("brightness", detail = "OFFLINE", available = false))
        assertEquals(
            ControlStateStore.NO_LIGHT,
            text("temperature", available = false, detail = null),
        )

        assertNull(
            ControlStateStore.stateTileText(
                StateBindingDto(type = "light", target = "power"),
                null,
                stateCapable = false,
            ),
        )
        assertEquals(
            ControlStateStore.NO_STATE,
            ControlStateStore.stateTileText(
                StateBindingDto(type = "light", target = "power"),
                null,
                stateCapable = true,
            ),
        )
    }

    @Test
    fun lightValueControlsShowDetailAndUnavailableTextWithoutToasts() {
        assertEquals(
            "42%",
            ControlStateStore.displayText(
                localText = "50%",
                statePresent = true,
                stateAvailable = true,
                stateMuted = false,
                stateDetail = "42%",
                interacting = false,
                unavailableText = ControlStateStore.NO_LIGHT,
            ),
        )
        assertEquals(
            "250",
            ControlStateStore.displayText(
                localText = "250 mired",
                statePresent = true,
                stateAvailable = true,
                stateMuted = false,
                stateDetail = "250",
                interacting = false,
                unavailableText = ControlStateStore.NO_LIGHT,
            ),
        )
        assertEquals(
            "OFF",
            ControlStateStore.displayText(
                localText = "50%",
                statePresent = true,
                stateAvailable = true,
                stateMuted = false,
                stateDetail = "OFF",
                interacting = false,
                unavailableText = ControlStateStore.NO_LIGHT,
            ),
        )
        assertEquals(
            ControlStateStore.NO_LIGHT,
            ControlStateStore.displayText(
                localText = "250 mired",
                statePresent = true,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = "Unavailable",
                interacting = false,
                unavailableText = ControlStateStore.NO_LIGHT,
            ),
        )
        assertEquals(
            ControlStateStore.OFFLINE,
            ControlStateStore.displayText(
                localText = "50%",
                statePresent = true,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = "OFFLINE",
                interacting = false,
                unavailableText = ControlStateStore.NO_LIGHT,
            ),
        )
        // Dragging keeps the local value even while the light is unreachable.
        assertEquals(
            "73%",
            ControlStateStore.displayText(
                localText = "73%",
                statePresent = true,
                stateAvailable = false,
                stateMuted = false,
                stateDetail = "NO LIGHT",
                interacting = true,
                unavailableText = ControlStateStore.NO_LIGHT,
            ),
        )
    }

    @Test
    fun lightActiveTreatmentRequiresAnAvailableLightThatIsOn() {
        assertTrue(
            ControlStateStore.stateTileActive(
                state("light", 1, detail = "ON", active = true),
            ),
        )
        assertFalse(
            ControlStateStore.stateTileActive(
                state("light", 2, detail = "OFF", active = false),
            ),
        )
        assertFalse(
            ControlStateStore.stateTileActive(
                state("light", 3, detail = "NO LIGHT", available = false),
            ),
        )
        assertTrue(
            ControlStateStore.stateTileActive(
                state("light", 4, detail = "42%", active = true),
            ),
        )
    }

    @Test
    fun normalizedStateMapsToTheControlRangeAndStep() {
        assertEquals(
            42f,
            ControlStateStore.valueFromNormalized(0.42f, 0f, 100f, 1f),
            0.0001f,
        )
        assertEquals(
            40f,
            ControlStateStore.valueFromNormalized(0.42f, 0f, 100f, 5f),
            0.0001f,
        )
        assertEquals(
            0f,
            ControlStateStore.valueFromNormalized(-1f, 0f, 100f, 1f),
            0.0001f,
        )
        assertEquals(
            1f,
            ControlStateStore.valueFromNormalized(2f, 0f, 1f, 0.1f),
            0.0001f,
        )
        // OBS uses a 0..200 % range; 100 % is unity, not the midpoint.
        assertEquals(
            150f,
            ControlStateStore.valueFromNormalized(0.75f, 0f, 200f, 1f),
            0.0001f,
        )
        assertEquals(
            100f,
            ControlStateStore.valueFromNormalized(0.5f, 0f, 200f, 1f),
            0.0001f,
        )
        // Light temperature maps normalized state onto the Elgato mired range.
        assertEquals(
            244f,
            ControlStateStore.valueFromNormalized(0.5f, 143f, 344f, 1f),
            0.0001f,
        )
        assertEquals(
            143f,
            ControlStateStore.valueFromNormalized(-1f, 143f, 344f, 1f),
            0.0001f,
        )
        assertEquals(
            344f,
            ControlStateStore.valueFromNormalized(2f, 143f, 344f, 1f),
            0.0001f,
        )
    }

    @Test
    fun snappingClampsAndGuardsInvalidSteps() {
        assertEquals(
            100f,
            ControlStateStore.snapControlValue(180f, 0f, 100f, 1f),
            0.0001f,
        )
        assertEquals(
            200f,
            ControlStateStore.snapControlValue(280f, 0f, 200f, 1f),
            0.0001f,
        )
        assertEquals(
            13.4f,
            ControlStateStore.snapControlValue(13.4f, 0f, 100f, 0f),
            0.0001f,
        )
        assertTrue(ControlStateStore.statefulControlIds(DeckPage()).isEmpty())
    }

    private fun state(
        id: String,
        revision: Int,
        value: Float? = null,
        available: Boolean = true,
        detail: String? = null,
        muted: Boolean = false,
        active: Boolean? = null,
    ) = ControlStateEntryDto(
        controlId = id,
        revision = revision,
        value = value,
        muted = muted,
        available = available,
        detail = detail ?: value?.let { "${(it * 100).toInt()}%" },
        active = active,
    )

    private fun button(
        id: String,
        kind: String = "slider",
        type: String = "volume",
        mode: String? = "absolute",
        target: String? = null,
        emit: String = "value",
        control: ControlDto? = ControlDto(
            kind = kind,
            emit = emit,
            binding = ControlBindingDto(type = type, mode = mode, target = target),
        ),
        state: StateBindingDto? = null,
    ) = DeckButton(id = id, control = control, state = state)
}
