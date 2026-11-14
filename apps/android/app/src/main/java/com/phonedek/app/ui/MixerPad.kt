package com.phonedek.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.phonedek.app.data.DeckButton
import com.phonedek.app.net.MixerSessionPayload
import com.phonedek.app.net.MixerStatePayload
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

/* ------------------------------------------------------------------ */
/* Pure rules                                                          */
/* ------------------------------------------------------------------ */

/** Result of inspecting a tapped deck button for the mixer launcher. */
internal sealed interface MixerLaunch {
    /** The button is not a phone-local per-app mixer launcher. */
    data object NotLauncher : MixerLaunch

    /** It is a launcher, but this desktop did not advertise mixer-v1. */
    data object Unsupported : MixerLaunch

    /** It is a launcher but the deck has no live socket right now. */
    data object Offline : MixerLaunch

    /** Capable + connected: open the overlay without sending a press. */
    data object Open : MixerLaunch
}

/** True when the button carries a phone-local mixer open action. */
internal fun hasMixerAction(button: DeckButton): Boolean =
    button.actions.any { action ->
        action.type == "mixer" &&
            (action.action.isNullOrBlank() || action.action == "open")
    }

internal fun mixerLaunch(
    button: DeckButton,
    capable: Boolean,
    connected: Boolean,
): MixerLaunch {
    if (!hasMixerAction(button)) return MixerLaunch.NotLauncher
    if (!capable) return MixerLaunch.Unsupported
    if (!connected) return MixerLaunch.Offline
    return MixerLaunch.Open
}

/**
 * Deterministic channel order: display name, then process, then the opaque
 * desktop id. `sortedWith` is stable, so equal keys keep the desktop order.
 */
internal fun sortedMixerSessions(
    sessions: List<MixerSessionPayload>,
): List<MixerSessionPayload> = sessions.sortedWith(
    compareBy<MixerSessionPayload> { it.name.lowercase(Locale.ROOT) }
        .thenBy { it.process.lowercase(Locale.ROOT) }
        .thenBy { it.id },
)

internal const val MIXER_FADER_INTERVAL_MS = 50L

/** Local fader/mute feedback expires if no snapshot confirms the write. */
private const val MIXER_OPTIMISTIC_TIMEOUT_MS = 2_500L

/**
 * Latest-wins throttle for one channel fader. Moves inside [intervalMs] are
 * retained as a pending value; [flush] emits only the newest one, and
 * [commit] always sends the release value. All times are elapsedRealtime ms.
 */
internal class MixerFaderThrottle(
    private val intervalMs: Long = MIXER_FADER_INTERVAL_MS,
) {
    private var lastSentAt: Long? = null
    private var pendingValue: Int? = null

    /** Records a move; returns the value to send now, or null to wait. */
    fun onMove(volume: Int, now: Long): Int? {
        val bounded = volume.coerceIn(0, 100)
        pendingValue = bounded
        val last = lastSentAt
        if (last == null || now - last >= intervalMs) {
            lastSentAt = now
            pendingValue = null
            return bounded
        }
        return null
    }

    /** Milliseconds until the pending value is due (0 when none is waiting). */
    fun waitMs(now: Long): Long {
        if (pendingValue == null) return 0L
        val last = lastSentAt ?: return 0L
        return (intervalMs - (now - last)).coerceIn(0L, intervalMs)
    }

    /** Takes the pending value, if any, and marks it as just sent. */
    fun flush(now: Long): Int? {
        val value = pendingValue ?: return null
        pendingValue = null
        lastSentAt = now
        return value
    }

    /** Release commit: cancels any pending value and returns the final one. */
    fun commit(volume: Int, now: Long): Int {
        pendingValue = null
        lastSentAt = now
        return volume.coerceIn(0, 100)
    }

    fun reset() {
        lastSentAt = null
        pendingValue = null
    }
}

/* ------------------------------------------------------------------ */
/* Full-screen overlay                                                 */
/* ------------------------------------------------------------------ */

/**
 * Full-screen per-app mixer in the Studio Console language: a deep panel,
 * hairline channel strips and mono telemetry. One vertical fader per desktop
 * session. Fader moves are throttled in the ViewModel; mute is immediate.
 */
@Composable
fun MixerPadOverlay(
    viewModel: MainViewModel,
    snapshot: MixerStatePayload?,
    capable: Boolean,
    modifier: Modifier = Modifier,
) {
    BackHandler { viewModel.closeMixerPad() }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, viewModel) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                viewModel.closeMixerPad(sendStop = true)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // Removing the overlay must release the subscription even when the
    // lifecycle observer never fires (config change, error path).
    DisposableEffect(viewModel) {
        onDispose { viewModel.closeMixerPad() }
    }

    val sessions = remember(snapshot?.sessions) {
        sortedMixerSessions(snapshot?.sessions.orEmpty())
    }
    val status = when {
        !capable -> "NO CAP"
        snapshot == null -> "SYNC"
        !snapshot.available -> "NO MIXER"
        else -> "LIVE · ${sessions.size} CH"
    }
    val statusColor = when {
        !capable -> StatusDanger
        snapshot == null -> StatusWarn
        !snapshot.available -> StatusDanger
        else -> TextMuted
    }

    Box(
        modifier
            .fillMaxSize()
            .background(InkDeep)
            // The deck pager is still composed underneath; consume the Final
            // pass so a swipe on panel chrome cannot also flip a deck page.
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Final)
                            .changes
                            .forEach { change -> change.consume() }
                    }
                }
            },
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .navigationBarsPadding()
                .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            MixerHeader(
                status = status,
                statusColor = statusColor,
                onRefresh = viewModel::refreshMixer,
                onClose = { viewModel.closeMixerPad() },
            )

            Spacer(Modifier.height(10.dp))

            when {
                !capable -> MixerNotice(
                    title = "NO MIXER",
                    detail = "Update PhoneDeck on your PC to control per-app audio.",
                    modifier = Modifier.weight(1f),
                )

                snapshot == null -> MixerNotice(
                    title = "SYNC",
                    detail = "Waiting for the desktop to list audio sessions.",
                    modifier = Modifier.weight(1f),
                    warn = true,
                )

                !snapshot.available -> MixerNotice(
                    title = "NO MIXER",
                    detail = snapshot.reason?.takeIf { it.isNotBlank() }
                        ?: "Per-app audio is not available on this desktop.",
                    modifier = Modifier.weight(1f),
                )

                sessions.isEmpty() -> MixerNotice(
                    title = "NO SESSIONS",
                    detail = "Play audio in an app on your PC, then refresh.",
                    modifier = Modifier.weight(1f),
                    warn = true,
                )

                else -> LazyRow(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    itemsIndexed(sessions, key = { _, session -> session.id }) { index, session ->
                        MixerChannelStrip(
                            index = index,
                            session = session,
                            onVolumeMove = { volume ->
                                viewModel.onMixerVolume(session.id, volume)
                            },
                            onVolumeCommit = { volume ->
                                viewModel.onMixerVolumeCommit(session.id, volume)
                            },
                            onMute = { muted -> viewModel.onMixerMute(session.id, muted) },
                            modifier = Modifier.fillMaxHeight(),
                        )
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            MixerFooter(snapshot = snapshot, sessionCount = sessions.size)
        }
    }
}

@Composable
private fun MixerHeader(
    status: String,
    statusColor: Color,
    onRefresh: () -> Unit,
    onClose: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .width(3.dp)
                    .height(26.dp)
                    .background(Accent),
            )
            Spacer(Modifier.width(10.dp))
            Column {
                Text(
                    text = "MIX 01",
                    color = TextSecondary,
                    fontFamily = ConsoleMono,
                    fontSize = 10.sp,
                    letterSpacing = 2.sp,
                    fontWeight = FontWeight.Medium,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = "PER-APP MIXER",
                    color = TextFaint,
                    fontFamily = ConsoleMono,
                    fontSize = 8.sp,
                    letterSpacing = 1.4.sp,
                )
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = status,
                color = statusColor,
                fontFamily = ConsoleMono,
                fontSize = 9.sp,
                letterSpacing = 1.2.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                modifier = Modifier.padding(horizontal = 10.dp),
            )
            MixerIconButton(label = "↻", description = "Refresh mixer", onClick = onRefresh)
            Spacer(Modifier.width(8.dp))
            MixerIconButton(label = "×", description = "Close mixer", onClick = onClose)
        }
    }
}

@Composable
private fun MixerIconButton(
    label: String,
    description: String,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(4.dp)
    Box(
        Modifier
            .size(40.dp)
            .clip(shape)
            .background(PanelRaised)
            .border(1.dp, HairlineStrong, shape)
            .clickable(role = Role.Button, onClickLabel = description, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = TextSecondary,
            fontFamily = ConsoleMono,
            fontSize = 18.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun MixerNotice(
    title: String,
    detail: String,
    modifier: Modifier = Modifier,
    warn: Boolean = false,
) {
    Box(
        modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Panel)
            .border(1.dp, Hairline, RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 28.dp),
        ) {
            Text(
                text = title,
                color = if (warn) StatusWarn else StatusDanger,
                fontFamily = ConsoleMono,
                fontSize = 20.sp,
                letterSpacing = 3.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = detail,
                color = TextMuted,
                fontSize = 12.sp,
                lineHeight = 17.sp,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun MixerFooter(snapshot: MixerStatePayload?, sessionCount: Int) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = when {
                snapshot == null -> "WAITING FOR DESKTOP"
                !snapshot.available -> "SUBSCRIPTION OPEN · NO CHANNELS"
                else -> "LIVE · 1 HZ · $sessionCount CH"
            },
            color = TextFaint,
            fontFamily = ConsoleMono,
            fontSize = 8.sp,
            letterSpacing = 1.1.sp,
        )
        Text(
            text = "MIXER-V1",
            color = TextFaint,
            fontFamily = ConsoleMono,
            fontSize = 8.sp,
            letterSpacing = 1.1.sp,
        )
    }
}

@Composable
private fun MixerChannelStrip(
    index: Int,
    session: MixerSessionPayload,
    onVolumeMove: (Int) -> Unit,
    onVolumeCommit: (Int) -> Unit,
    onMute: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = LocalHapticFeedback.current
    val shape = RoundedCornerShape(6.dp)
    var localVolume by remember(session.id) { mutableStateOf<Int?>(null) }
    var localMuted by remember(session.id) { mutableStateOf<Boolean?>(null) }
    var faderActive by remember(session.id) { mutableStateOf(false) }

    // The 1 Hz snapshot catches up with the optimistic value, then the local
    // override steps aside so desktop-side changes are visible again.
    LaunchedEffect(session.volume) {
        if (localVolume != null && session.volume == localVolume) localVolume = null
    }
    LaunchedEffect(session.muted) {
        if (localMuted != null && session.muted == localMuted) localMuted = null
    }

    // If the desktop rejects a write (or never confirms it), drop the local
    // override so the strip falls back to the authoritative snapshot.
    LaunchedEffect(localVolume, faderActive) {
        if (localVolume != null && !faderActive) {
            delay(MIXER_OPTIMISTIC_TIMEOUT_MS)
            if (!faderActive) localVolume = null
        }
    }
    LaunchedEffect(localMuted) {
        if (localMuted != null) {
            delay(MIXER_OPTIMISTIC_TIMEOUT_MS)
            localMuted = null
        }
    }

    val volume = (localVolume ?: session.volume).coerceIn(0, 100)
    val muted = localMuted ?: session.muted
    val available = session.available

    Column(
        modifier
            .width(124.dp)
            .clip(shape)
            .background(Panel)
            .border(1.dp, if (available) Hairline else HairlineStrong, shape)
            .padding(horizontal = 10.dp, vertical = 9.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "CH ${"%02d".format(Locale.US, index + 1)}",
                color = TextFaint,
                fontFamily = ConsoleMono,
                fontSize = 8.sp,
                letterSpacing = 1.2.sp,
            )
            ConsoleLed(
                color = when {
                    !available -> StatusDanger
                    muted -> StatusWarn
                    else -> StatusOk
                },
            )
        }

        Spacer(Modifier.height(7.dp))

        Text(
            text = session.name.uppercase(Locale.ROOT),
            color = if (available) TextPrimary else TextMuted,
            fontSize = 12.sp,
            lineHeight = 15.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = session.process,
            color = TextFaint,
            fontFamily = ConsoleMono,
            fontSize = 8.sp,
            letterSpacing = 0.4.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(8.dp))

        MixerMuteButton(
            muted = muted,
            enabled = available,
            onToggle = {
                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                val next = !muted
                localMuted = next
                onMute(next)
            },
        )

        Spacer(Modifier.height(8.dp))

        VerticalFader(
            volume = volume,
            enabled = available,
            label = "${session.name} volume",
            onMove = { value ->
                faderActive = true
                localVolume = value
                onVolumeMove(value)
            },
            onCommit = { value ->
                faderActive = false
                localVolume = value
                onVolumeCommit(value)
            },
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
        )

        Spacer(Modifier.height(6.dp))

        Text(
            text = when {
                !available -> "NO SESSION"
                muted -> "MUTED · $volume%"
                else -> "$volume%"
            },
            color = when {
                !available -> StatusDanger
                muted -> StatusWarn
                else -> AccentHigh
            },
            fontFamily = ConsoleMono,
            fontSize = 10.sp,
            letterSpacing = 0.8.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
        )
    }
}

@Composable
private fun MixerMuteButton(
    muted: Boolean,
    enabled: Boolean,
    onToggle: () -> Unit,
) {
    val shape = RoundedCornerShape(3.dp)
    Box(
        Modifier
            .fillMaxWidth()
            .height(28.dp)
            .clip(shape)
            .background(if (muted) StatusDanger.copy(alpha = 0.18f) else PanelRaised)
            .border(
                1.dp,
                when {
                    !enabled -> Hairline
                    muted -> StatusDanger
                    else -> HairlineStrong
                },
                shape,
            )
            .clickable(
                enabled = enabled,
                role = Role.Button,
                onClickLabel = if (muted) "Unmute channel" else "Mute channel",
                onClick = onToggle,
            )
            .semantics {
                contentDescription = if (muted) "Unmute channel" else "Mute channel"
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = if (muted) "MUTED" else "MUTE",
            color = when {
                !enabled -> TextFaint
                muted -> StatusDanger
                else -> TextSecondary
            },
            fontFamily = ConsoleMono,
            fontSize = 9.sp,
            letterSpacing = 1.4.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

/**
 * Vertical fader. Tap sets the level at the touched point; drag scrubs. The
 * value is always an integer percentage so the wire payload never needs
 * rounding.
 */
@Composable
private fun VerticalFader(
    volume: Int,
    enabled: Boolean,
    label: String,
    onMove: (Int) -> Unit,
    onCommit: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    var trackHeight by remember { mutableIntStateOf(1) }
    val fraction = volume.coerceIn(0, 100) / 100f
    val shape = RoundedCornerShape(3.dp)
    val activeColor = if (enabled) Accent else HairlineStrong

    Box(
        modifier
            .onSizeChanged { trackHeight = it.height.coerceAtLeast(1) }
            .clip(shape)
            .background(InkDeep)
            .border(1.dp, Hairline, shape)
            .semantics {
                contentDescription = label
                progressBarRangeInfo = ProgressBarRangeInfo(
                    current = volume.coerceIn(0, 100).toFloat(),
                    range = 0f..100f,
                    steps = 99,
                )
                if (enabled) {
                    setProgress { target ->
                        val value = target.roundToInt().coerceIn(0, 100)
                        onCommit(value)
                        true
                    }
                }
            }
            .then(
                if (!enabled) {
                    Modifier
                } else {
                    Modifier.pointerInput(trackHeight) {
                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false)
                            down.consume()

                            fun valueAt(y: Float): Int {
                                val height = size.height.toFloat().coerceAtLeast(1f)
                                val ratio = (1f - (y / height)).coerceIn(0f, 1f)
                                return (ratio * 100f).roundToInt().coerceIn(0, 100)
                            }

                            var current = valueAt(down.position.y)
                            onMove(current)

                            var committed = false
                            while (true) {
                                val event = awaitPointerEvent()
                                val change = event.changes.firstOrNull { it.id == down.id }
                                if (change == null) break
                                change.consume()
                                if (!change.pressed) {
                                    onCommit(current)
                                    committed = true
                                    break
                                }
                                val next = valueAt(change.position.y)
                                if (next != current) {
                                    current = next
                                    onMove(next)
                                }
                            }
                            if (!committed) onCommit(current)
                        }
                    }
                },
            ),
    ) {
        Canvas(Modifier.fillMaxSize()) {
            // Ten-step scale ticks, kept faint so the fill stays the signal.
            val steps = 10
            for (step in 0..steps) {
                val y = size.height * (step / steps.toFloat())
                drawLine(
                    color = Hairline,
                    start = androidx.compose.ui.geometry.Offset(0f, y),
                    end = androidx.compose.ui.geometry.Offset(size.width, y),
                    strokeWidth = 1f,
                )
            }
            val fillTop = size.height * (1f - fraction)
            drawRect(
                color = activeColor.copy(alpha = if (enabled) 0.34f else 0.12f),
                topLeft = androidx.compose.ui.geometry.Offset(0f, fillTop),
                size = androidx.compose.ui.geometry.Size(size.width, size.height - fillTop),
            )
            val knobY = fillTop.coerceIn(2f, size.height - 2f)
            drawLine(
                color = activeColor,
                start = androidx.compose.ui.geometry.Offset(0f, knobY),
                end = androidx.compose.ui.geometry.Offset(size.width, knobY),
                strokeWidth = 3f,
            )
        }
    }
}
