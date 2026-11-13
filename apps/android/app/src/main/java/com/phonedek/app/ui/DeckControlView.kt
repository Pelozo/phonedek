package com.phonedek.app.ui

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phonedek.app.data.ControlDto
import com.phonedek.app.util.ShortcutChord
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin

private const val DIAL_DETENT_DEGREES = 15f

/**
 * Relative delta or absolute value slider/dial input.
 *
 * - Relative deltas are positive for right/up/clockwise.
 * - Absolute volume sends the normalized 0..1 slider value instead.
 * - Volume sliders map a full relative travel to 100 / stepPercent steps.
 * - Scroll sliders map a full relative travel to 100 wheel units.
 * - Every dial detent sends one relative unit; absolute dials send the new value.
 * - The final `end` phase is always sent by the VM even if no move occurred.
 */
@Composable
fun DeckControlView(
    control: ControlDto,
    label: String,
    textColor: Color,
    onInput: (phase: String, delta: Float?, value: Float?) -> Unit,
    onInteractingChange: (Boolean) -> Unit,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
    externalValue: Float? = null,
    stateAvailable: Boolean = false,
    statePresent: Boolean = false,
    stateMuted: Boolean = false,
    stateDetail: String? = null,
    stateRevision: Int = -1,
    stateCapable: Boolean = false,
) {
    val minValue = control.min ?: 0f
    val maxValue = control.max ?: 100f
    val stepValue = (control.step ?: 1f).takeIf { it > 0f } ?: 1f
    val range = (maxValue - minValue).takeIf { it > 0f } ?: 1f
    val absolute = control.emit == "value"
    val isVolume = control.binding.type == "volume"
    val isMic = control.binding.type == "mic"
    val isObs = control.binding.type == "obs"
    val isLight = control.binding.type == "light"
    val scrollControl = control.binding.type == "scroll"
    // Shortcut wheels are delta-only: the readout is a chord badge, not a
    // numeric value, and there is no live desktop state to follow.
    val isShortcut = control.binding.type == "shortcut"
    val shortcutChord = if (isShortcut) ShortcutChord.format(control.binding.keys) else ""
    val shortcutHold = if (isShortcut) {
        ShortcutChord.holdIndicator(control.binding.holdKeys)
    } else {
        ""
    }
    val volumeStepPercent = control.binding.stepPercent?.coerceIn(1, 25) ?: 2
    val sliderWireScale = if (isVolume) 100f / volumeStepPercent else 100f
    val displayUnit = control.unit ?: if (isVolume || isMic || isObs) "%" else ""
    val contentRotation = LocalButtonContentRotation.current
    val haptics = LocalHapticFeedback.current
    val density = LocalDensity.current
    // Vertical drag distance per wheel detent (used near the hub, where the
    // polar angle is too unstable to drive a rotary gesture).
    val dialDetentPx = with(density) { 12.dp.toPx() }
    val dialDecidePx = with(density) { 8.dp.toPx() }

    fun fractionOf(raw: Float): Float =
        ((raw - minValue) / range).coerceIn(0f, 1f)

    fun snap(raw: Float): Float =
        ControlStateStore.snapControlValue(raw, minValue, maxValue, stepValue)

    // A cached snapshot usually arrives before first composition; seed from it
    // so the slider starts at the real volume instead of sweeping from 50%.
    val stateSeed = externalValue
        ?.takeIf { stateAvailable && it.isFinite() }
        ?.let { ControlStateStore.valueFromNormalized(it, minValue, maxValue, stepValue) }
    var value by remember(control) {
        mutableFloatStateOf(
            stateSeed
                ?: (control.initial ?: ((minValue + maxValue) / 2f))
                    .coerceIn(minValue, maxValue),
        )
    }
    var interacting by remember(control) { mutableStateOf(false) }
    var appliedRevision by remember(control) {
        mutableIntStateOf(if (stateSeed != null) stateRevision else -1)
    }
    var tileHeightPx by remember { mutableIntStateOf(0) }
    // Absolute controls can open the exact-value plate from the readout;
    // relative controls keep the row tap for their action.
    val canEnterValue = ValueEntry.supports(control)
    var entryOpen by remember(control) { mutableStateOf(false) }
    var entryStart by remember(control) { mutableFloatStateOf(0f) }

    // Remote state never fights a finger. While the control is interactive we
    // remember the revision we superseded, so the pre-drag snapshot cannot
    // snap back on release; only the post-write revision is applied.
    LaunchedEffect(control, stateRevision, stateAvailable, externalValue, interacting) {
        if (interacting) {
            if (stateAvailable && stateRevision > appliedRevision) {
                appliedRevision = stateRevision
            }
            return@LaunchedEffect
        }
        if (!stateAvailable) {
            // No entry at all (page change, reconnect, old desktop): forget the
            // old socket's revision so a restarted desktop counter can apply.
            if (stateRevision < 0) appliedRevision = -1
            return@LaunchedEffect
        }
        val targetRaw = externalValue?.takeIf { it.isFinite() } ?: return@LaunchedEffect
        if (stateRevision <= appliedRevision) return@LaunchedEffect
        appliedRevision = stateRevision
        val target = snap(minValue + targetRaw.coerceIn(0f, 1f) * range)
        if (target == value) return@LaunchedEffect
        val start = value
        animate(0f, 1f, animationSpec = tween(durationMillis = 140)) { fraction, _ ->
            value = start + (target - start) * fraction
        }
        value = target
    }

    fun performDetentHaptic() {
        if (control.haptics) {
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        }
    }

    fun finishGesture(changed: Boolean) {
        if (!interacting) return
        if (absolute) {
            // A dial only commits a value when it actually turned; tapping a
            // wheel must not jump the desktop volume to the shown readout.
            if (changed || control.kind != "dial") {
                onInput("end", null, fractionOf(value))
            } else {
                onInput("end", null, null)
            }
        } else {
            onInput("end", 0f, null)
        }
        interacting = false
        onInteractingChange(false)
    }

    DisposableEffect(control) {
        onDispose {
            if (interacting) {
                if (absolute) {
                    onInput("end", null, fractionOf(value))
                } else {
                    onInput("end", 0f, null)
                }
                onInteractingChange(false)
            }
        }
    }

    val valueText = if (isShortcut) {
        // Chord + optional hold indicator, e.g. `⌃⇥ +ALT`.
        listOf(shortcutChord, shortcutHold)
            .filter { it.isNotEmpty() }
            .joinToString(" ")
    } else {
        ValueEntry.formatValue(value, displayUnit)
    }
    val displayText = if (isShortcut) {
        valueText
    } else {
        ControlStateStore.displayText(
            localText = valueText,
            statePresent = statePresent,
            stateAvailable = stateAvailable,
            stateMuted = stateMuted,
            stateDetail = stateDetail,
            interacting = interacting,
            unavailableText = if (isLight) {
                ControlStateStore.NO_LIGHT
            } else {
                ControlStateStore.NO_INPUT
            },
        )
    }
    val muted = !isShortcut && statePresent && stateAvailable &&
        (stateMuted || stateDetail?.trim() == ControlStateStore.MUTED) &&
        !interacting
    val stateBadge = if (stateCapable && stateAvailable && externalValue != null) {
        "LIVE"
    } else {
        "LOCAL"
    }
    // An unavailable mic/OBS input still knows the desktop supports live state;
    // showing LOCAL beside NO INPUT/NO OBS would be misleading. Key wheels are
    // delta-only and never have a live value to fall back from.
    val showStateBadge = !isShortcut && !statePresent && (tileHeightPx == 0 ||
        with(density) { tileHeightPx.toDp() } >= 48.dp)

    Column(
        modifier = modifier
            .fillMaxSize()
            .onSizeChanged { tileHeightPx = it.height }
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onTap)
                .graphicsLayer { rotationZ = contentRotation },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = label,
                color = textColor,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (control.kind == "dial") {
                // A small affordance: the tile is a wheel, not a slider track.
                Text(
                    text = "↻",
                    color = textColor.copy(alpha = 0.45f),
                    fontFamily = ConsoleMono,
                    fontSize = 10.sp,
                    modifier = Modifier.padding(horizontal = 5.dp),
                )
            }
            Text(
                text = displayText,
                color = textColor,
                fontFamily = ConsoleMono,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                modifier = when {
                    canEnterValue -> {
                        // The readout opens exact entry; it takes priority over
                        // the label row's tap action. Relative controls keep the
                        // row tap.
                        Modifier
                            .clip(RoundedCornerShape(3.dp))
                            .clickable(
                                role = Role.Button,
                                onClickLabel = "Set exact value",
                            ) {
                                entryStart = value
                                entryOpen = true
                                if (control.haptics) {
                                    haptics.performHapticFeedback(
                                        HapticFeedbackType.TextHandleMove,
                                    )
                                }
                            }
                            .padding(horizontal = 5.dp, vertical = 4.dp)
                    }

                    isShortcut -> {
                        // Compact chord badge; the hold indicator is part of the
                        // same readout, e.g. `⌃⇥ +ALT`.
                        Modifier
                            .clip(RoundedCornerShape(3.dp))
                            .background(textColor.copy(alpha = 0.12f))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    }

                    else -> Modifier
                },
            )
            // LIVE is implicit once the value follows the PC; only the LOCAL
            // fallback (old desktop) needs a label.
            if (showStateBadge && stateBadge == "LOCAL") {
                Text(
                    text = stateBadge,
                    color = textColor.copy(alpha = 0.55f),
                    fontFamily = ConsoleMono,
                    fontSize = 7.sp,
                    letterSpacing = 0.8.sp,
                    maxLines = 1,
                    modifier = Modifier.padding(start = 4.dp),
                )
            }
        }
        Spacer(Modifier.height(4.dp))

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .alpha(if (muted) 0.45f else 1f)
                // Consume the gesture in the Initial pass so the tile click and
                // horizontal pager cannot steal it before the control updates.
                .pointerInput(
                    control.kind,
                    control.axis,
                    control.binding,
                    minValue,
                    maxValue,
                    range,
                    stepValue,
                ) {
                    awaitEachGesture {
                        val down = awaitFirstDown(
                            requireUnconsumed = false,
                            pass = PointerEventPass.Initial,
                        )
                        down.consume()
                        interacting = true
                        onInteractingChange(true)
                        if (control.kind == "dial") {
                            // A dial has no value until it turns; sending the
                            // readout on touch-down would teleport the desktop
                            // volume every time the wheel is tapped.
                            onInput("start", null, if (absolute) null else 0f)
                        } else if (absolute) {
                            onInput("start", null, fractionOf(value))
                        } else {
                            onInput("start", 0f, null)
                        }

                        var moved = false

                        if (control.kind == "dial") {
                            val centerX = size.width / 2f
                            val centerY = size.height / 2f
                            val wheelRadius = min(size.width, size.height) / 2f

                            fun angleAt(position: Offset): Float =
                                Math.toDegrees(
                                    atan2(
                                        (position.y - centerY).toDouble(),
                                        (position.x - centerX).toDouble(),
                                    ),
                                ).toFloat()

                            fun applyDetents(detents: Int) {
                                if (detents == 0) return
                                val next = if (control.binding.type == "scroll") {
                                    val wrapped = minValue +
                                        ((((value + detents * stepValue) - minValue) % range) +
                                            range) % range
                                    wrapped.coerceIn(minValue, maxValue)
                                } else {
                                    (value + detents * stepValue).coerceIn(minValue, maxValue)
                                }
                                if (next == value) return
                                value = next
                                moved = true
                                if (absolute) {
                                    onInput("move", null, fractionOf(next))
                                } else {
                                    onInput("move", detents.toFloat(), null)
                                }
                                performDetentHaptic()
                            }

                            val radiusX = down.position.x - centerX
                            val radiusY = down.position.y - centerY
                            val startRadius = hypot(radiusX, radiusY)
                            val modeRotate = 1
                            val modeVertical = 2
                            // Scrolling is a vertical gesture, not a rotary
                            // one. Near the hub the polar angle is unstable,
                            // so those touches also scrub vertically.
                            var mode = if (
                                scrollControl ||
                                wheelRadius <= 1f ||
                                startRadius < wheelRadius * 0.35f
                            ) {
                                modeVertical
                            } else {
                                0
                            }

                            var lastPosition = down.position
                            var moveX = 0f
                            var moveY = 0f
                            var lastAngle = angleAt(down.position)
                            var angleAccumulator = 0f
                            var lastY = down.position.y
                            var verticalResidual = 0f
                            var verticalTravel = 0f
                            var lastMotionTime = down.uptimeMillis
                            var velocityY = 0f
                            // Crossing the hub flips the angle by 180°; pause
                            // there instead of firing a burst of detents.
                            val hubDeadZone = wheelRadius * 0.12f

                            while (true) {
                                val event = awaitPointerEvent(PointerEventPass.Initial)
                                val change = event.changes.firstOrNull { it.id == down.id }
                                    ?: break
                                change.consume()

                                if (mode == 0) {
                                    // Pick one gesture once, from its first few
                                    // dp: a turn around the ring rotates, a
                                    // radial/straight drag scrubs vertically.
                                    moveX += change.position.x - lastPosition.x
                                    moveY += change.position.y - lastPosition.y
                                    lastPosition = change.position
                                    if (hypot(moveX, moveY) >= dialDecidePx) {
                                        val radial = abs(moveX * radiusX + moveY * radiusY)
                                        val tangential = abs(moveX * radiusY - moveY * radiusX)
                                        mode = if (tangential > radial) {
                                            modeRotate
                                        } else {
                                            modeVertical
                                        }
                                        lastAngle = angleAt(change.position)
                                        lastY = change.position.y
                                        lastMotionTime = change.uptimeMillis
                                    }
                                } else if (mode == modeRotate) {
                                    val offsetX = change.position.x - centerX
                                    val offsetY = change.position.y - centerY
                                    if (hypot(offsetX, offsetY) < hubDeadZone) {
                                        lastAngle = angleAt(change.position)
                                    } else {
                                        val angle = angleAt(change.position)
                                        var delta = angle - lastAngle
                                        while (delta > 180f) delta -= 360f
                                        while (delta < -180f) delta += 360f
                                        lastAngle = angle
                                        angleAccumulator += delta
                                        val detents =
                                            (angleAccumulator / DIAL_DETENT_DEGREES).toInt()
                                        if (detents != 0) {
                                            angleAccumulator -=
                                                detents * DIAL_DETENT_DEGREES
                                            applyDetents(detents)
                                        }
                                    }
                                } else {
                                    val dy = change.position.y - lastY
                                    verticalResidual -= dy
                                    verticalTravel += abs(dy)
                                    val dt = (change.uptimeMillis - lastMotionTime)
                                        .coerceAtLeast(1)
                                    velocityY = 0.7f * velocityY +
                                        0.3f * (dy / dt * 1000f)
                                    lastMotionTime = change.uptimeMillis
                                    lastY = change.position.y
                                    val detents = (verticalResidual / dialDetentPx).toInt()
                                    if (detents != 0) {
                                        verticalResidual -= detents * dialDetentPx
                                        applyDetents(detents)
                                    }
                                }

                                if (!change.pressed) {
                                    if (mode == 0) {
                                        // A tap never reaches the 8dp mode
                                        // threshold: jump to the tapped arc
                                        // position, or nudge one step. A
                                        // shortcut wheel stays silent on tap.
                                        val tapAngle = angleAt(change.position)
                                        val tapRadius = hypot(
                                            change.position.x - centerX,
                                            change.position.y - centerY,
                                        )
                                        val tappedFraction = dialArcFraction(tapAngle)
                                        if (
                                            !isShortcut &&
                                            tapRadius >= hubDeadZone &&
                                            tappedFraction != null
                                        ) {
                                            if (absolute) {
                                                val target = snap(
                                                    minValue + tappedFraction * range,
                                                )
                                                if (target != value) {
                                                    value = target
                                                    moved = true
                                                    onInput(
                                                        "move",
                                                        null,
                                                        fractionOf(target),
                                                    )
                                                    performDetentHaptic()
                                                }
                                            } else {
                                                val direction = dialTapDirection(
                                                    tappedFraction,
                                                    fractionOf(value),
                                                )
                                                if (direction != 0) {
                                                    applyDetents(direction)
                                                }
                                            }
                                        }
                                    }
                                    if (mode == modeVertical) {
                                        if (
                                            scrollControl &&
                                            verticalTravel < dialDecidePx
                                        ) {
                                            // Tap: one notch toward the tapped
                                            // half, so a still finger is useful.
                                            applyDetents(
                                                if (change.position.y < centerY) 1 else -1,
                                            )
                                        } else if (
                                            abs(verticalResidual) >= dialDetentPx / 2f
                                        ) {
                                            applyDetents(
                                                if (verticalResidual > 0f) 1 else -1,
                                            )
                                        }
                                    } else if (
                                        mode == modeRotate &&
                                        abs(angleAccumulator) >=
                                        DIAL_DETENT_DEGREES / 2f
                                    ) {
                                        applyDetents(
                                            if (angleAccumulator > 0f) 1 else -1,
                                        )
                                    }

                                    // A scroll flick keeps some of its speed:
                                    // add a bounded burst of notches. The
                                    // gesture scope cannot delay, and the VM
                                    // coalesces moves anyway, so send one batch.
                                    if (scrollControl && abs(velocityY) > 800f) {
                                        val fling = (abs(velocityY) / 650f)
                                            .toInt()
                                            .coerceIn(1, 14)
                                        applyDetents(
                                            fling * (if (velocityY < 0f) 1 else -1),
                                        )
                                    }
                                    break
                                }
                            }
                        } else {
                            val vertical = control.axis == "vertical"
                            fun trackFraction(position: Offset): Float = if (vertical) {
                                1f - (position.y / size.height.toFloat()).coerceIn(0f, 1f)
                            } else {
                                (position.x / size.width.toFloat()).coerceIn(0f, 1f)
                            }
                            // A key wheel is a pure relative control: touching
                            // the track must not jump the value (and emit a
                            // chord burst). Its baseline is the touch-down point,
                            // so only finger travel turns into deltas.
                            var lastFraction = if (isShortcut) {
                                trackFraction(down.position)
                            } else {
                                fractionOf(value)
                            }
                            var pendingWireDelta = 0f

                            fun flushWholeWire(force: Boolean) {
                                if (absolute) return
                                val whole = pendingWireDelta.toInt().toFloat()
                                if (whole != 0f) {
                                    pendingWireDelta -= whole
                                    onInput("move", whole, null)
                                    performDetentHaptic()
                                } else if (force && abs(pendingWireDelta) >= 0.5f) {
                                    onInput("move", pendingWireDelta, null)
                                    pendingWireDelta = 0f
                                    performDetentHaptic()
                                }
                            }

                            fun updateFrom(position: Offset) {
                                val fraction = trackFraction(position)
                                if (isShortcut) {
                                    val fractionDelta = fraction - lastFraction
                                    if (fractionDelta == 0f) return
                                    lastFraction = fraction
                                    // Keep a local position for gesture
                                    // continuity, but the chord count follows
                                    // finger travel, not the track position.
                                    value = (value + fractionDelta * range)
                                        .coerceIn(minValue, maxValue)
                                    pendingWireDelta += fractionDelta * sliderWireScale
                                    flushWholeWire(force = false)
                                    return
                                }
                                val snapped = snap(minValue + fraction * range)
                                val newFraction = fractionOf(snapped)
                                if (snapped == value) return
                                value = snapped
                                if (absolute) {
                                    onInput("move", null, newFraction)
                                    performDetentHaptic()
                                    return
                                }
                                val fractionDelta = newFraction - lastFraction
                                if (fractionDelta == 0f) return
                                lastFraction = newFraction
                                pendingWireDelta += fractionDelta * sliderWireScale
                                flushWholeWire(force = false)
                            }

                            updateFrom(down.position)
                            while (true) {
                                val event = awaitPointerEvent(PointerEventPass.Initial)
                                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                                change.consume()
                                updateFrom(change.position)
                                if (!change.pressed) {
                                    flushWholeWire(force = true)
                                    break
                                }
                            }
                        }

                        finishGesture(moved)
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            val fraction = fractionOf(value)
            if (control.kind == "dial") {
                Canvas(Modifier.fillMaxSize()) {
                    val diameter = min(size.width, size.height) - 12.dp.toPx()
                    val topLeft = Offset(
                        (size.width - diameter) / 2f,
                        (size.height - diameter) / 2f,
                    )
                    val arcSize = Size(diameter, diameter)
                    val stroke = 4.dp.toPx()
                    // The full track must stay visible: the accent only covers
                    // the travelled part, and a faint remainder read as a
                    // broken circle.
                    val trackColor = textColor.copy(alpha = 0.42f)
                    drawArc(
                        color = trackColor,
                        startAngle = DIAL_ARC_START,
                        sweepAngle = DIAL_ARC_SWEEP,
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = Stroke(width = stroke, cap = StrokeCap.Round),
                    )
                    // The travelled-value arc and knob are meaningless for a
                    // key wheel; only the static track frames the chord.
                    if (!isShortcut) {
                        drawArc(
                            color = Accent,
                            startAngle = DIAL_ARC_START,
                            sweepAngle = DIAL_ARC_SWEEP * fraction,
                            useCenter = false,
                            topLeft = topLeft,
                            size = arcSize,
                            style = Stroke(width = stroke, cap = StrokeCap.Round),
                        )
                        val radians =
                            Math.toRadians(dialKnobDegrees(fraction).toDouble())
                        val radius = diameter / 2f
                        val center = Offset(size.width / 2f, size.height / 2f)
                        val knob = Offset(
                            center.x + cos(radians).toFloat() * radius,
                            center.y + sin(radians).toFloat() * radius,
                        )
                        drawCircle(Color.Black.copy(alpha = 0.35f), 7.dp.toPx(), knob)
                        drawCircle(Accent, 5.dp.toPx(), knob)
                    }
                }
            } else {
                Canvas(Modifier.fillMaxSize()) {
                    val inset = 10.dp.toPx()
                    val trackColor = textColor.copy(alpha = 0.28f)
                    val stroke = 4.dp.toPx()
                    if (control.axis == "vertical") {
                        val x = size.width / 2f
                        val top = inset
                        val bottom = size.height - inset
                        val thumbY = bottom - fraction * (bottom - top)
                        drawLine(
                            color = trackColor,
                            start = Offset(x, top),
                            end = Offset(x, bottom),
                            strokeWidth = stroke,
                            cap = StrokeCap.Round,
                        )
                        if (!isShortcut) {
                            drawLine(
                                color = Accent,
                                start = Offset(x, bottom),
                                end = Offset(x, thumbY),
                                strokeWidth = stroke,
                                cap = StrokeCap.Round,
                            )
                            drawCircle(
                                Color.Black.copy(alpha = 0.35f),
                                7.dp.toPx(),
                                Offset(x, thumbY),
                            )
                            drawCircle(Accent, 5.dp.toPx(), Offset(x, thumbY))
                        }
                    } else {
                        val y = size.height / 2f
                        val left = inset
                        val right = size.width - inset
                        val thumbX = left + fraction * (right - left)
                        drawLine(
                            color = trackColor,
                            start = Offset(left, y),
                            end = Offset(right, y),
                            strokeWidth = stroke,
                            cap = StrokeCap.Round,
                        )
                        if (!isShortcut) {
                            drawLine(
                                color = Accent,
                                start = Offset(left, y),
                                end = Offset(thumbX, y),
                                strokeWidth = stroke,
                                cap = StrokeCap.Round,
                            )
                            drawCircle(
                                Color.Black.copy(alpha = 0.35f),
                                7.dp.toPx(),
                                Offset(thumbX, y),
                            )
                            drawCircle(Accent, 5.dp.toPx(), Offset(thumbX, y))
                        }
                    }
                }
            }

            if (isShortcut) {
                // The value indicator is gone; the body carries the chord so
                // the tile still reads as an input at a glance.
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(textColor.copy(alpha = 0.10f))
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                ) {
                    Text(
                        text = shortcutChord,
                        color = textColor,
                        fontFamily = ConsoleMono,
                        fontSize = if (control.kind == "dial") 13.sp else 14.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (shortcutHold.isNotEmpty()) {
                        Text(
                            text = shortcutHold,
                            color = textColor.copy(alpha = 0.65f),
                            fontFamily = ConsoleMono,
                            fontSize = 8.sp,
                            letterSpacing = 0.8.sp,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }

    if (entryOpen) {
        ValueEntryDialog(
            title = label,
            minValue = minValue,
            maxValue = maxValue,
            step = stepValue,
            unit = displayUnit,
            initial = entryStart,
            onDismiss = { entryOpen = false },
            onConfirm = { entered ->
                val next = entered.coerceIn(minValue, maxValue)
                value = next
                // The VM coalesces this and repeats the final value on end, so
                // the desktop sees the change both live and committed.
                onInput("move", null, fractionOf(next))
                onInput("end", null, fractionOf(next))
                entryOpen = false
                if (control.haptics) {
                    haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                }
            },
        )
    }
}
