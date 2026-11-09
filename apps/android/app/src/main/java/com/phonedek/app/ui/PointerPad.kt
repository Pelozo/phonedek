@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)

package com.phonedek.app.ui

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerInputChange
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.phonedek.app.data.PointerButtonEvent
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

/** In-process flag so the one-line legend only appears on the first pad open. */
private object PointerPadLegend {
    @Volatile
    var seen: Boolean = false
}

/**
 * Reusable pointer gesture surface shared by the full-screen pad and the
 * inline deck tile.
 *
 * The surface consumes every touch in the Initial pass and emits protocol
 * frames through [onInput]. [onStart] arms the session before the first frame
 * (the inline tile uses it to bind the gesture to its control); [onEnd] runs
 * after the final `end`/`cancel` so the inline tile can release its session
 * without closing the full-screen overlay.
 *
 * Frames are rotated by [contentRotation] immediately before they leave the
 * surface: raw touch handling stays in screen space, while the desktop sees
 * movement in the direction the (counter-rotated) deck content implies.
 */
@Composable
internal fun PointerSurface(
    options: PointerPadOptions,
    contentRotation: Float,
    onStart: () -> Boolean,
    onInput: (
        controlId: String,
        phase: String,
        dx: Float,
        dy: Float,
        scrollX: Float,
        scrollY: Float,
        buttons: List<PointerButtonEvent>,
    ) -> Unit,
    onEnd: (controlId: String) -> Unit = {},
    onInteractingChange: (Boolean) -> Unit = {},
    onFrame: (PointerGestureFrame) -> Unit = {},
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit = {},
) {
    val haptics = LocalHapticFeedback.current
    var contact by remember { mutableStateOf<Offset?>(null) }

    val latestStart by rememberUpdatedState(onStart)
    val latestInput by rememberUpdatedState(onInput)
    val latestEnd by rememberUpdatedState(onEnd)
    val latestInteracting by rememberUpdatedState(onInteractingChange)
    val latestFrame by rememberUpdatedState(onFrame)
    val latestRotation by rememberUpdatedState(contentRotation)

    Box(
        modifier = modifier.pointerInput(
            options.controlId,
            options.naturalScroll,
            options.tapToClick,
            options.dragLock,
        ) {
            val gesture = PointerGesture(
                padHeightPx = size.height.toFloat().coerceAtLeast(1f),
                tapSlopPx = POINTER_TAP_SLOP_DP.dp.toPx(),
                scrollSlopPx = POINTER_SCROLL_SLOP_DP.dp.toPx(),
                notchPx = POINTER_SCROLL_NOTCH_DP.dp.toPx(),
                naturalScroll = options.naturalScroll,
                tapToClick = options.tapToClick,
                dragLock = options.dragLock,
            )

            fun emit(raw: PointerGestureFrame, final: Boolean) {
                val frame = raw.rotated(latestRotation)
                latestFrame(raw)
                when (raw.haptic) {
                    PointerHaptic.TAP, PointerHaptic.RIGHT_CLICK ->
                        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)

                    PointerHaptic.DRAG_LOCK ->
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)

                    null -> Unit
                }
                when {
                    final -> {
                        latestInput(
                            options.controlId,
                            "end",
                            frame.dx,
                            frame.dy,
                            frame.scrollX,
                            frame.scrollY,
                            frame.buttons,
                        )
                        latestEnd(options.controlId)
                    }

                    frame.hasPayload -> latestInput(
                        options.controlId,
                        "move",
                        frame.dx,
                        frame.dy,
                        frame.scrollX,
                        frame.scrollY,
                        frame.buttons,
                    )
                }
            }

            awaitEachGesture {
                val down = awaitFirstDown(
                    requireUnconsumed = false,
                    pass = PointerEventPass.Initial,
                )
                down.consume()
                if (!latestStart()) {
                    latestInteracting(false)
                    return@awaitEachGesture
                }
                latestInteracting(true)
                val downPoint = PadPoint(
                    x = down.position.x,
                    y = down.position.y,
                    timeMs = down.uptimeMillis,
                )
                gesture.onDown(downPoint)
                contact = Offset(downPoint.x, downPoint.y)
                latestInput(options.controlId, "start", 0f, 0f, 0f, 0f, emptyList())

                var finished = false
                var pointerCount = 1
                try {
                    while (true) {
                        val now = SystemClock.uptimeMillis()
                        val waitMs = (gesture.longPressDeadlineMs - now)
                            .coerceAtLeast(1L)
                        val event = if (gesture.canLongPress) {
                            withTimeoutOrNull(waitMs) {
                                awaitPointerEvent(PointerEventPass.Initial)
                            }
                        } else {
                            awaitPointerEvent(PointerEventPass.Initial)
                        }

                        if (event == null) {
                            emit(gesture.onTick(SystemClock.uptimeMillis()), final = false)
                            continue
                        }

                        event.changes.forEach { change -> change.consume() }
                        // Only two pointers are needed; a third finger must not
                        // skew the centroid or classify scroll.
                        val pressed = event.changes
                            .filter { it.pressed }
                            .take(2)
                        val eventTime = event.changes.maxOfOrNull { it.uptimeMillis }
                            ?: SystemClock.uptimeMillis()

                        if (pressed.isEmpty()) {
                            val lift = event.changes.lastOrNull()
                            val upPoint = PadPoint(
                                x = lift?.position?.x ?: downPoint.x,
                                y = lift?.position?.y ?: downPoint.y,
                                timeMs = eventTime,
                            )
                            emit(gesture.onUp(upPoint), final = true)
                            finished = true
                            contact = null
                            break
                        }

                        val centroid = centroid(pressed)
                        val centroidPoint = PadPoint(
                            x = centroid.x,
                            y = centroid.y,
                            timeMs = eventTime,
                        )
                        if (pressed.size != pointerCount) {
                            val rebased = if (pressed.size == 2) {
                                gesture.onSecondDown(centroidPoint)
                            } else {
                                gesture.onSecondUp(centroidPoint)
                            }
                            emit(rebased, final = false)
                            pointerCount = pressed.size
                        }

                        val current = PadPoint(
                            x = centroid.x,
                            y = centroid.y,
                            timeMs = eventTime,
                        )
                        val history = if (pressed.size == 1) {
                            pressed.first().historical.map { sample ->
                                PadPoint(
                                    x = sample.position.x,
                                    y = sample.position.y,
                                    timeMs = sample.uptimeMillis,
                                )
                            }
                        } else {
                            emptyList()
                        }
                        emit(gesture.onMove(current, history), final = false)
                        contact = Offset(centroid.x, centroid.y)
                    }
                } finally {
                    if (!finished) {
                        gesture.onCancel()
                        latestFrame(PointerGestureFrame(cancelled = true))
                        latestInput(
                            options.controlId,
                            "cancel",
                            0f,
                            0f,
                            0f,
                            0f,
                            emptyList(),
                        )
                        latestEnd(options.controlId)
                        contact = null
                    }
                    latestInteracting(false)
                }
            }
        },
    ) {
        content()
        ContactDot(contact)
    }
}

/**
 * Full-screen pointer pad. The pad owns every touch in its inset well; the
 * close affordance is a sibling above it so the Initial-pass consumption
 * cannot steal the tap. The gesture surface itself is not rotated, but
 * outgoing frames are mapped through [LocalButtonContentRotation] and the
 * header/legend text is counter-rotated so it reads upright.
 */
@Composable
fun PointerPadOverlay(
    viewModel: MainViewModel,
    options: PointerPadOptions,
    modifier: Modifier = Modifier,
) {
    var lmbHeld by remember { mutableStateOf(false) }
    var rmbVisible by remember { mutableStateOf(false) }
    var showLegend by remember { mutableStateOf(!PointerPadLegend.seen) }
    val contentRotation = LocalButtonContentRotation.current

    LaunchedEffect(Unit) {
        PointerPadLegend.seen = true
        if (showLegend) {
            delay(4_500)
            showLegend = false
        }
    }

    LaunchedEffect(rmbVisible) {
        if (rmbVisible) {
            delay(650)
            rmbVisible = false
        }
    }

    BackHandler { viewModel.closePointerPad() }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, viewModel) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) viewModel.closePointerPad()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // Removing the overlay (including an error-triggered close) must abort the
    // gesture if the touch handler never got a final lift.
    DisposableEffect(viewModel) {
        onDispose { viewModel.closePointerPad() }
    }

    val wellShape = RoundedCornerShape(8.dp)
    val sensitivity = String.format(Locale.US, "%.1f×", options.sensitivity)
    val stateText = when {
        lmbHeld -> "LMB HELD"
        rmbVisible -> "RMB"
        else -> "READY"
    }
    val stateColor = when {
        lmbHeld -> AccentHigh
        rmbVisible -> Accent
        else -> TextMuted
    }

    Box(modifier.fillMaxSize().background(Ink)) {
        // ~8dp safe inset: system edge gestures still win at the very edge, so
        // the actionable well never sits flush against the screen boundary.
        PointerSurface(
            options = options,
            contentRotation = contentRotation,
            onStart = { true },
            onInput = { controlId, phase, dx, dy, scrollX, scrollY, buttons ->
                viewModel.onPointerInput(
                    controlId = controlId,
                    phase = phase,
                    dx = dx,
                    dy = dy,
                    scrollX = scrollX,
                    scrollY = scrollY,
                    buttons = buttons,
                )
            },
            onFrame = { frame ->
                if (frame.cancelled) {
                    lmbHeld = false
                    rmbVisible = false
                }
                frame.buttons.forEach { event ->
                    if (event.button == "left") {
                        when (event.action) {
                            "down" -> lmbHeld = true
                            "up", "click" -> lmbHeld = false
                        }
                    }
                    if (event.button == "right" && event.action == "click") {
                        rmbVisible = true
                    }
                }
            },
            modifier = Modifier
                .fillMaxSize()
                .padding(8.dp)
                .clip(wellShape)
                .background(InkDeep)
                .border(1.dp, HairlineStrong, wellShape),
        ) {
            PadGrid()
            PointerPadHeader(
                sensitivity = sensitivity,
                stateText = stateText,
                stateColor = stateColor,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .fillMaxWidth()
                    .padding(start = 14.dp, top = 12.dp, end = 64.dp)
                    .graphicsLayer { rotationZ = contentRotation },
            )
            AnimatedVisibility(
                visible = showLegend,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 20.dp, start = 16.dp, end = 16.dp)
                    .graphicsLayer { rotationZ = contentRotation },
            ) {
                Text(
                    text = "DRAG MOVE · TAP CLICK · 2-FINGER SCROLL · HOLD DRAG",
                    color = TextMuted,
                    fontFamily = ConsoleMono,
                    fontSize = 8.sp,
                    letterSpacing = 1.1.sp,
                    maxLines = 1,
                    textAlign = TextAlign.Center,
                )
            }
        }

        // Sibling above the gesture surface: pointerInput on the well consumes
        // in the Initial pass, so the close affordance must not be a child.
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .padding(18.dp)
                .size(40.dp)
                .zIndex(2f)
                .clip(RoundedCornerShape(4.dp))
                .background(PanelRaised)
                .border(1.dp, HairlineStrong, RoundedCornerShape(4.dp))
                .clickable(role = Role.Button, onClickLabel = "Close trackpad") {
                    viewModel.closePointerPad()
                }
                .semantics { contentDescription = "Close trackpad" },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "×",
                color = TextSecondary,
                fontFamily = ConsoleMono,
                fontSize = 18.sp,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
internal fun PadGrid() {
    Canvas(Modifier.fillMaxSize()) {
        val step = 16.dp.toPx()
        val line = Color.White.copy(alpha = 0.03f)
        var x = step
        while (x < size.width) {
            drawLine(line, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1f)
            x += step
        }
        var y = step
        while (y < size.height) {
            drawLine(line, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
            y += step
        }
    }
}

@Composable
private fun ContactDot(contact: Offset?) {
    val point = contact
    if (point != null) {
        Canvas(Modifier.fillMaxSize()) {
            drawCircle(
                color = Accent.copy(alpha = 0.18f),
                radius = 14.dp.toPx(),
                center = point,
            )
            drawCircle(
                color = Accent,
                radius = 5.dp.toPx(),
                center = point,
            )
            drawCircle(
                color = Accent.copy(alpha = 0.55f),
                radius = 10.dp.toPx(),
                center = point,
                style = Stroke(width = 1.dp.toPx()),
            )
        }
    }
}

@Composable
private fun PointerPadHeader(
    sensitivity: String,
    stateText: String,
    stateColor: Color,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column {
            Text(
                text = "PAD 01",
                color = TextSecondary,
                fontFamily = ConsoleMono,
                fontSize = 10.sp,
                letterSpacing = 2.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(3.dp))
            Text(
                text = "$sensitivity · POINTER",
                color = TextFaint,
                fontFamily = ConsoleMono,
                fontSize = 8.sp,
                letterSpacing = 1.2.sp,
            )
        }
        Text(
            text = stateText,
            color = stateColor,
            fontFamily = ConsoleMono,
            fontSize = 9.sp,
            letterSpacing = 1.5.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

private fun centroid(changes: List<PointerInputChange>): Offset {
    if (changes.isEmpty()) return Offset.Zero
    var x = 0f
    var y = 0f
    changes.forEach { change ->
        x += change.position.x
        y += change.position.y
    }
    val count = changes.size.toFloat()
    return Offset(x / count, y / count)
}
