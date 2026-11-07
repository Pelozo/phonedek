package com.phonedek.app.ui

import androidx.compose.foundation.Canvas
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phonedek.app.data.ControlDto
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

private const val DIAL_DETENT_DEGREES = 15f

/**
 * Relative slider/dial input. Wire deltas are positive for right/up/clockwise.
 *
 * - Volume sliders map a full travel to 100 / stepPercent desktop volume steps.
 * - Scroll sliders map a full travel to 100 wheel units.
 * - Every dial detent sends one unit for either binding.
 * - The final `end` phase is always sent by the VM even if no move occurred.
 */
@Composable
fun DeckControlView(
    control: ControlDto,
    label: String,
    textColor: Color,
    onInput: (phase: String, delta: Float) -> Unit,
    onInteractingChange: (Boolean) -> Unit,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val minValue = control.min ?: 0f
    val maxValue = control.max ?: 100f
    val stepValue = (control.step ?: 1f).takeIf { it > 0f } ?: 1f
    val range = (maxValue - minValue).takeIf { it > 0f } ?: 1f
    val isVolume = control.binding.type == "volume"
    val volumeStepPercent = control.binding.stepPercent?.coerceIn(1, 25) ?: 2
    val sliderWireScale = if (isVolume) 100f / volumeStepPercent else 100f
    val displayUnit = control.unit ?: if (isVolume) "%" else ""
    val contentRotation = LocalButtonContentRotation.current
    val haptics = LocalHapticFeedback.current

    var value by remember(control) {
        mutableFloatStateOf(
            (control.initial ?: ((minValue + maxValue) / 2f))
                .coerceIn(minValue, maxValue),
        )
    }
    var interacting by remember(control) { mutableStateOf(false) }

    fun fractionOf(raw: Float): Float =
        ((raw - minValue) / range).coerceIn(0f, 1f)

    fun snap(raw: Float): Float {
        val clamped = raw.coerceIn(minValue, maxValue)
        val steps = ((clamped - minValue) / stepValue).roundToInt()
        return (minValue + steps * stepValue).coerceIn(minValue, maxValue)
    }

    fun performDetentHaptic() {
        if (control.haptics) {
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        }
    }

    fun finishGesture() {
        if (!interacting) return
        onInput("end", 0f)
        interacting = false
        onInteractingChange(false)
    }

    DisposableEffect(Unit) {
        onDispose {
            if (interacting) {
                onInput("end", 0f)
                onInteractingChange(false)
            }
        }
    }

    val valueText = "${value.roundToInt()}$displayUnit"

    Column(
        modifier = modifier
            .fillMaxSize()
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
            Text(
                text = valueText,
                color = textColor,
                fontFamily = ConsoleMono,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
        }
        Spacer(Modifier.height(4.dp))

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
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
                        onInput("start", 0f)

                        if (control.kind == "dial") {
                            fun angleAt(position: Offset): Float {
                                val centerX = size.width / 2f
                                val centerY = size.height / 2f
                                return Math.toDegrees(
                                    atan2(
                                        (position.y - centerY).toDouble(),
                                        (position.x - centerX).toDouble(),
                                    ),
                                ).toFloat()
                            }

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
                                onInput("move", detents.toFloat())
                                performDetentHaptic()
                            }

                            var lastAngle = angleAt(down.position)
                            var angleAccumulator = 0f
                            while (true) {
                                val event = awaitPointerEvent(PointerEventPass.Initial)
                                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                                change.consume()
                                val angle = angleAt(change.position)
                                var delta = angle - lastAngle
                                while (delta > 180f) delta -= 360f
                                while (delta < -180f) delta += 360f
                                lastAngle = angle
                                angleAccumulator += delta
                                val detents = (angleAccumulator / DIAL_DETENT_DEGREES).toInt()
                                if (detents != 0) {
                                    angleAccumulator -= detents * DIAL_DETENT_DEGREES
                                    applyDetents(detents)
                                }
                                if (!change.pressed) {
                                    if (abs(angleAccumulator) >= DIAL_DETENT_DEGREES / 2f) {
                                        applyDetents(if (angleAccumulator > 0f) 1 else -1)
                                    }
                                    break
                                }
                            }
                        } else {
                            val vertical = control.axis == "vertical"
                            var lastFraction = fractionOf(value)
                            var pendingWireDelta = 0f

                            fun flushWholeWire(force: Boolean) {
                                val whole = pendingWireDelta.toInt().toFloat()
                                if (whole != 0f) {
                                    pendingWireDelta -= whole
                                    onInput("move", whole)
                                    performDetentHaptic()
                                } else if (force && abs(pendingWireDelta) >= 0.5f) {
                                    onInput("move", pendingWireDelta)
                                    pendingWireDelta = 0f
                                    performDetentHaptic()
                                }
                            }

                            fun updateFrom(position: Offset) {
                                val fraction = if (vertical) {
                                    1f - (position.y / size.height.toFloat()).coerceIn(0f, 1f)
                                } else {
                                    (position.x / size.width.toFloat()).coerceIn(0f, 1f)
                                }
                                val snapped = snap(minValue + fraction * range)
                                val newFraction = fractionOf(snapped)
                                val fractionDelta = newFraction - lastFraction
                                if (fractionDelta == 0f) return
                                value = snapped
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

                        finishGesture()
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
                    val trackColor = textColor.copy(alpha = 0.28f)
                    drawArc(
                        color = trackColor,
                        startAngle = -135f,
                        sweepAngle = 270f,
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = Stroke(width = stroke, cap = StrokeCap.Round),
                    )
                    drawArc(
                        color = Accent,
                        startAngle = -135f,
                        sweepAngle = 270f * fraction,
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = Stroke(width = stroke, cap = StrokeCap.Round),
                    )
                    val radians = Math.toRadians((-135f + 270f * fraction).toDouble())
                    val radius = diameter / 2f
                    val center = Offset(size.width / 2f, size.height / 2f)
                    val knob = Offset(
                        center.x + cos(radians).toFloat() * radius,
                        center.y + sin(radians).toFloat() * radius,
                    )
                    drawCircle(Color.Black.copy(alpha = 0.35f), 7.dp.toPx(), knob)
                    drawCircle(Accent, 5.dp.toPx(), knob)
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
    }
}
