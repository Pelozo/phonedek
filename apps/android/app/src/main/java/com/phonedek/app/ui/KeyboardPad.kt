@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.phonedek.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Full-screen phone keyboard.
 *
 * The system IME owns text entry (Gboard/CJK/autocorrect), while a pinned strip
 * sends special keys. Text is committed only on an explicit boundary and never
 * while `TextFieldValue.composition` is active.
 */
@Composable
fun KeyboardPadOverlay(
    viewModel: MainViewModel,
    options: KeyboardPadOptions,
    status: KeyboardStatus,
    capable: Boolean,
    modifier: Modifier = Modifier,
) {
    var value by remember { mutableStateOf(TextFieldValue("")) }
    var modifiers by remember { mutableStateOf(KeyboardModifierState()) }
    var fnOpen by remember { mutableStateOf(false) }

    val focusRequester = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    val haptics = LocalHapticFeedback.current

    val density = LocalDensity.current
    val imeVisible = WindowInsets.ime.getBottom(density) > 0
    val composing = value.composition != null

    fun refocus() {
        focusRequester.requestFocus()
        keyboardController?.show()
    }

    LaunchedEffect(Unit) {
        // Give the overlay a frame to attach before asking the IME to appear.
        delay(120)
        refocus()
    }

    BackHandler {
        // First Back hides the IME and keeps the panel; a second closes it.
        if (imeVisible) {
            keyboardController?.hide()
        } else {
            viewModel.closeKeyboardPad()
        }
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, viewModel) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                // Background is an abort: cancel queued text and drop modifiers.
                viewModel.closeKeyboardPad(cancel = true)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    DisposableEffect(viewModel) {
        onDispose { viewModel.closeKeyboardPad(cancel = true) }
    }

    fun tick() {
        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    }

    fun sendKey(key: String, repeat: Int = 1) {
        if (composing) return
        viewModel.sendKeyboardKey(modifiers.chordFor(key), repeat)
        modifiers = modifiers.afterKey()
    }

    /** Commits the outbox as one or more text messages (no Enter). */
    fun commitText(): Boolean {
        val plan = planLineSend(
            text = value.text,
            composing = value.composition != null,
        ) ?: return false
        viewModel.sendKeyboardText(plan.text)
        value = TextFieldValue("")
        refocus()
        return true
    }

    fun commitFromIme() {
        if (composing) return
        commitText()
        refocus()
    }

    fun stripEnter() {
        if (composing) return
        if (modifiers.hasActive()) {
            // A latched modifier means "send the chord", not "type then Enter".
            sendKey("ENTER")
            return
        }
        commitText()
        sendKey("ENTER")
        refocus()
    }

    /**
     * Strip Backspace deletes on the PC, not in the phone's outbox. Flush the
     * pending line first so the deletion cannot overtake the text it edits;
     * the system IME's Backspace still edits the local field without sending.
     */
    fun stripBackspace() {
        if (composing) return
        commitText()
        sendKey("BACKSPACE")
    }

    fun toggleModifier(key: String, lock: Boolean) {
        if (composing) return
        modifiers = if (lock) modifiers.longPress(key) else modifiers.tap(key)
    }

    fun clearOutbox() {
        value = TextFieldValue("")
        refocus()
    }

    Box(
        modifier
            .fillMaxSize()
            .background(Ink)
            // The deck pager is still composed underneath. Consume the Final
            // pass so a swipe on panel chrome cannot also flip a deck page;
            // children (text field, keycaps) already handled Main.
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        awaitPointerEvent(PointerEventPass.Final)
                            .changes
                            .forEach { change -> change.consume() }
                    }
                }
            },
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .imePadding()
                .navigationBarsPadding()
                .padding(horizontal = 14.dp),
        ) {
            KeyboardHeader(
                label = options.label,
                status = status,
                capable = capable,
                onClose = { viewModel.closeKeyboardPad() },
            )

            Spacer(Modifier.height(10.dp))

            Box(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Panel)
                    .border(1.dp, HairlineStrong, RoundedCornerShape(8.dp))
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            ) {
                if (value.text.isEmpty()) {
                    Text(
                        text = "TYPE HERE",
                        color = TextFaint,
                        fontFamily = ConsoleMono,
                        fontSize = 10.sp,
                        letterSpacing = 1.4.sp,
                    )
                }
                BasicTextField(
                    value = value,
                    onValueChange = { updated -> value = updated },
                    modifier = Modifier
                        .fillMaxSize()
                        .focusRequester(focusRequester),
                    textStyle = TextStyle(
                        color = TextPrimary,
                        fontSize = 18.sp,
                        lineHeight = 24.sp,
                    ),
                    cursorBrush = SolidColor(Accent),
                    keyboardOptions = KeyboardOptions(
                        imeAction = ImeAction.Send,
                        capitalization = KeyboardCapitalization.Sentences,
                    ),
                    keyboardActions = KeyboardActions(onSend = { commitFromIme() }),
                    maxLines = 6,
                )
            }

            Spacer(Modifier.height(7.dp))
            KeyboardTelemetry(
                length = value.text.length,
                chunks = chunkKeyboardText(value.text).size,
                composing = composing,
                status = status,
                capable = capable,
            )
            Spacer(Modifier.height(7.dp))

            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    PressKeycap(
                        label = "Esc",
                        description = "Escape",
                        onPress = { sendKey("ESC") },
                        onPressTick = ::tick,
                    )
                    PressKeycap(
                        label = "Tab",
                        description = "Tab",
                        onPress = { sendKey("TAB") },
                        onPressTick = ::tick,
                    )
                    RepeatKeycap(
                        label = "⌫",
                        description = "Backspace on the PC",
                        onPressTick = ::tick,
                        onPress = { stripBackspace() },
                        onRepeat = { sendKey("BACKSPACE") },
                    )
                    PressKeycap(
                        label = "⏎",
                        description = "Enter on the PC",
                        onPress = { stripEnter() },
                        onPressTick = ::tick,
                    )
                    PressKeycap(
                        label = "←",
                        description = "Left arrow",
                        onPress = { sendKey("LEFT") },
                        onPressTick = ::tick,
                    )
                    PressKeycap(
                        label = "↑",
                        description = "Up arrow",
                        onPress = { sendKey("UP") },
                        onPressTick = ::tick,
                    )
                    PressKeycap(
                        label = "↓",
                        description = "Down arrow",
                        onPress = { sendKey("DOWN") },
                        onPressTick = ::tick,
                    )
                    PressKeycap(
                        label = "→",
                        description = "Right arrow",
                        onPress = { sendKey("RIGHT") },
                        onPressTick = ::tick,
                    )
                }

                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    ModifierKeycap(
                        label = "Ctrl",
                        armed = modifiers.isActive("CTRL"),
                        onClick = { toggleModifier("CTRL", lock = false) },
                        onLongClick = { toggleModifier("CTRL", lock = true) },
                        onClickTick = ::tick,
                    )
                    ModifierKeycap(
                        label = "Alt",
                        armed = modifiers.isActive("ALT"),
                        onClick = { toggleModifier("ALT", lock = false) },
                        onLongClick = { toggleModifier("ALT", lock = true) },
                        onClickTick = ::tick,
                    )
                    ModifierKeycap(
                        label = "Shift",
                        armed = modifiers.isActive("SHIFT"),
                        onClick = { toggleModifier("SHIFT", lock = false) },
                        onLongClick = { toggleModifier("SHIFT", lock = true) },
                        onClickTick = ::tick,
                    )
                    ModifierKeycap(
                        label = "Win",
                        armed = modifiers.isActive("WIN"),
                        onClick = { toggleModifier("WIN", lock = false) },
                        onLongClick = { toggleModifier("WIN", lock = true) },
                        onClickTick = ::tick,
                    )
                    PressKeycap(
                        label = "SEND",
                        description = "Send text to the PC",
                        accent = true,
                        onPress = { commitText() },
                        onPressTick = ::tick,
                        weight = 1.7f,
                    )
                    PressKeycap(
                        label = "CLR",
                        description = "Clear the phone text field",
                        onPress = { clearOutbox() },
                        onPressTick = ::tick,
                    )
                    PressKeycap(
                        label = if (fnOpen) "FN•" else "FN",
                        description = "Function keys",
                        armed = fnOpen,
                        onPress = {
                            fnOpen = !fnOpen
                            refocus()
                        },
                        onPressTick = ::tick,
                    )
                }

                if (fnOpen) {
                    FunctionRow(
                        start = 1,
                        onPress = { index -> sendKey("F$index") },
                        onPressTick = ::tick,
                    )
                    FunctionRow(
                        start = 7,
                        onPress = { index -> sendKey("F$index") },
                        onPressTick = ::tick,
                    )
                }
            }

            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun KeyboardHeader(
    label: String,
    status: KeyboardStatus,
    capable: Boolean,
    onClose: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = "KEY 01",
                color = TextSecondary,
                fontFamily = ConsoleMono,
                fontSize = 10.sp,
                letterSpacing = 2.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(3.dp))
            Text(
                text = label.ifBlank { "Phone keyboard" }.uppercase(),
                color = TextFaint,
                fontFamily = ConsoleMono,
                fontSize = 8.sp,
                letterSpacing = 1.2.sp,
                maxLines = 1,
            )
        }
        Text(
            text = when {
                !capable -> "NO CAP"
                status == KeyboardStatus.OPENING -> "SYNC"
                status == KeyboardStatus.TX_ERROR -> "TX ERR"
                else -> "READY"
            },
            color = when {
                !capable -> StatusDanger
                status == KeyboardStatus.TX_ERROR -> StatusDanger
                status == KeyboardStatus.OPENING -> StatusWarn
                else -> TextMuted
            },
            fontFamily = ConsoleMono,
            fontSize = 9.sp,
            letterSpacing = 1.5.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(horizontal = 10.dp),
        )
        Box(
            Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(PanelRaised)
                .border(1.dp, HairlineStrong, RoundedCornerShape(4.dp))
                .semantics {
                    contentDescription = "Close keyboard"
                    role = Role.Button
                    onClick(label = "Close keyboard") {
                        onClose()
                        true
                    }
                }
                .pointerInput(Unit) {
                    detectTapGestures(onTap = { onClose() })
                },
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
private fun KeyboardTelemetry(
    length: Int,
    chunks: Int,
    composing: Boolean,
    status: KeyboardStatus,
    capable: Boolean,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = if (length > KEYBOARD_MAX_TEXT) {
                "TX $length · $chunks CHUNKS"
            } else {
                "TX $length/$KEYBOARD_MAX_TEXT"
            },
            color = if (length > KEYBOARD_MAX_TEXT) StatusWarn else TextFaint,
            fontFamily = ConsoleMono,
            fontSize = 8.sp,
            letterSpacing = 1.1.sp,
        )
        Text(
            text = when {
                !capable -> "KEYBOARD LOCKED ON PC"
                composing -> "IME COMPOSING · NOT SENT"
                status == KeyboardStatus.TX_ERROR -> "TX ERROR · RETRY"
                else -> "LINE MODE · STRIP KEYS → PC"
            },
            color = if (composing) StatusWarn else TextFaint,
            fontFamily = ConsoleMono,
            fontSize = 8.sp,
            letterSpacing = 1.1.sp,
            maxLines = 1,
        )
    }
}

@Composable
private fun RowScope.PressKeycap(
    label: String,
    description: String,
    onPress: () -> Unit,
    onPressTick: () -> Unit,
    modifier: Modifier = Modifier,
    weight: Float = 1f,
    accent: Boolean = false,
    armed: Boolean = false,
) {
    val latestPress by rememberUpdatedState(onPress)
    val latestTick by rememberUpdatedState(onPressTick)
    KeycapFrame(
        label = label,
        description = description,
        accent = accent,
        armed = armed,
        modifier = modifier.weight(weight),
        gesture = {
            detectTapGestures(
                onPress = {
                    latestTick()
                    latestPress()
                    tryAwaitRelease()
                },
            )
        },
    )
}

@Composable
private fun RowScope.ModifierKeycap(
    label: String,
    armed: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    onClickTick: () -> Unit,
) {
    val latestClick by rememberUpdatedState(onClick)
    val latestLong by rememberUpdatedState(onLongClick)
    val latestTick by rememberUpdatedState(onClickTick)
    KeycapFrame(
        label = label,
        description = "$label modifier. Long-press to lock.",
        accent = false,
        armed = armed,
        modifier = Modifier.weight(1f),
        gesture = {
            detectTapGestures(
                onTap = {
                    latestTick()
                    latestClick()
                },
                onLongPress = {
                    latestTick()
                    latestLong()
                },
            )
        },
    )
}

/**
 * Backspace key: one press immediately, then repeats while the finger stays
 * down. The desktop receives ordered `key` frames, so a hold cannot overtake
 * pending text.
 */
@Composable
private fun RowScope.RepeatKeycap(
    label: String,
    description: String,
    onPressTick: () -> Unit,
    onPress: () -> Unit,
    onRepeat: () -> Unit,
) {
    val latestPress by rememberUpdatedState(onPress)
    val latestRepeat by rememberUpdatedState(onRepeat)
    val latestPressTick by rememberUpdatedState(onPressTick)
    KeycapFrame(
        label = label,
        description = description,
        modifier = Modifier.weight(1f),
        gesture = {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                down.consume()
                latestPressTick()
                latestPress()
                var waitMs = 430L
                while (true) {
                    val event = withTimeoutOrNull(waitMs) {
                        awaitPointerEvent(PointerEventPass.Initial)
                    }
                    if (event == null) {
                        latestRepeat()
                        waitMs = 70L
                    } else {
                        event.changes.forEach { change -> change.consume() }
                        if (event.changes.none { change -> change.pressed }) break
                    }
                }
            }
        },
    )
}

@Composable
private fun FunctionRow(
    start: Int,
    onPress: (Int) -> Unit,
    onPressTick: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        for (index in start until start + 6) {
            val latestPress by rememberUpdatedState(onPress)
            val latestTick by rememberUpdatedState(onPressTick)
            KeycapFrame(
                label = "F$index",
                description = "Function key F$index",
                modifier = Modifier.weight(1f),
                gesture = {
                    detectTapGestures(
                        onPress = {
                            latestTick()
                            latestPress(index)
                            tryAwaitRelease()
                        },
                    )
                },
            )
        }
    }
}

@Composable
private fun KeycapFrame(
    label: String,
    description: String,
    modifier: Modifier,
    accent: Boolean = false,
    armed: Boolean = false,
    gesture: suspend androidx.compose.ui.input.pointer.PointerInputScope.() -> Unit,
) {
    val shape = RoundedCornerShape(4.dp)
    val background = when {
        accent -> Accent
        armed -> AccentWash
        else -> PanelRaised
    }
    val foreground = when {
        accent -> AccentInk
        armed -> AccentHigh
        else -> TextSecondary
    }
    val border = if (accent || armed) Accent else HairlineStrong
    Box(
        modifier
            .focusProperties { canFocus = false }
            .height(46.dp)
            .clip(shape)
            .background(background)
            .border(1.dp, border, shape)
            .pointerInput(label, accent, armed) { gesture() }
            .semantics {
                role = Role.Button
                contentDescription = description
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = foreground,
            fontFamily = ConsoleMono,
            fontSize = 11.sp,
            fontWeight = if (accent || armed) FontWeight.Medium else FontWeight.Normal,
            maxLines = 1,
        )
    }
}
