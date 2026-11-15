@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.phonedek.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Full-screen phone keyboard that behaves like a physical keyboard.
 *
 * Every key sends its own down/up frames as the finger moves, so typing is
 * live and a held Shift/Tab really stays down on the PC. There is no text
 * field and no system IME on this surface: the phone shows exactly one
 * keyboard. Clipboard text is available through PASTE for longer or CJK text.
 */
@Composable
fun KeyboardPadOverlay(
    viewModel: MainViewModel,
    options: KeyboardPadOptions,
    status: KeyboardStatus,
    capable: Boolean,
    modifier: Modifier = Modifier,
) {
    var symbols by remember { mutableStateOf(false) }
    var fnOpen by remember { mutableStateOf(false) }
    var downKeys by remember { mutableStateOf(emptySet<String>()) }
    var latchedKeys by remember { mutableStateOf(emptySet<String>()) }
    var note by remember { mutableStateOf("") }
    var modifierTouched by remember { mutableStateOf(false) }
    var pressStartedAt by remember { mutableStateOf(emptyMap<String, Long>()) }

    val haptics = LocalHapticFeedback.current
    val clipboard = LocalClipboardManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val direct = options.direct

    val shiftActive = "SHIFT" in downKeys || "SHIFT" in latchedKeys
    val shiftArmed = "SHIFT" in latchedKeys

    fun tick() {
        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    }

    fun send(keys: List<String>, action: String, repeat: Int = 1) {
        if (!capable) return
        viewModel.sendKeyboardKey(keys, repeat = repeat, action = action)
    }

    /**
     * Legacy desktops (keyboard-v1) treat every key frame as a one-shot press.
     * Build the chord locally so modifiers still affect the key, without
     * streaming down/up frames they would double-fire.
     */
    fun chordFor(key: String): List<String> = buildList {
        for (modifier in KEYBOARD_MODIFIERS) {
            if (modifier in downKeys || modifier in latchedKeys) add(modifier)
        }
        if (key !in this) add(key)
    }.take(KEYBOARD_MAX_KEYS)

    /** Release all one-shot modifiers. Safe to call more than once. */
    fun releaseLatched() {
        if (latchedKeys.isEmpty()) return
        val released = latchedKeys
        latchedKeys = emptySet()
        for (key in released) {
            if (direct && key in downKeys) send(listOf(key), "up")
        }
        downKeys = downKeys - released
        note = "MODIFIERS RELEASED"
    }

    /** A normal key goes down on touch and up on release. */
    fun tapDown(key: String) {
        if (key in downKeys) return
        tick()
        modifierTouched = true
        if (direct) {
            send(listOf(key), "down")
        } else {
            send(chordFor(key), "press")
        }
        downKeys = downKeys + key
    }

    fun tapUp(key: String) {
        if (key !in downKeys) return
        if (direct) send(listOf(key), "up")
        downKeys = downKeys - key
        if (key !in KEYBOARD_MODIFIERS) releaseLatched()
    }

    /**
     * Shift/Ctrl/Alt/Win are physically held while the finger stays down. A
     * quick tap latches one for the next key instead, which is how a phone
     * keyboard makes Ctrl+C comfortable without a second finger.
     */
    fun modifierDown(key: String) {
        if (key in latchedKeys) {
            // Second tap on an armed modifier disarms it.
            if (direct) send(listOf(key), "up")
            latchedKeys = latchedKeys - key
            downKeys = downKeys - key
            note = ""
            tick()
            return
        }
        if (key in downKeys) return
        tick()
        modifierTouched = false
        if (direct) send(listOf(key), "down")
        downKeys = downKeys + key
        pressStartedAt = pressStartedAt + (key to System.currentTimeMillis())
    }

    fun modifierUp(key: String) {
        if (key !in downKeys) return
        val started = pressStartedAt[key] ?: 0L
        val quick = System.currentTimeMillis() - started < 320
        downKeys = downKeys - key
        pressStartedAt = pressStartedAt - key
        if (quick && !modifierTouched) {
            // Keep it down; the next key release sends the matching key-up.
            latchedKeys = latchedKeys + key
            downKeys = downKeys + key
            note = "$key LATCHED"
        } else {
            if (direct) send(listOf(key), "up")
            note = ""
        }
    }

    /** Backspace and the arrows repeat while held; Tab holds its down state. */
    fun repeatDown(key: String, holdDown: Boolean) {
        tick()
        modifierTouched = true
        if (!direct) {
            send(chordFor(key), "press")
            return
        }
        if (holdDown) {
            downKeys = downKeys + key
            send(listOf(key), "down")
        } else {
            send(listOf(key), "press")
        }
    }

    fun repeatTick(key: String, holdDown: Boolean) {
        if (!direct) {
            send(chordFor(key), "press")
            return
        }
        if (holdDown) {
            // Repeated key-down frames emulate the OS auto-repeat without
            // giving up the physical held state.
            send(listOf(key), "down")
        } else {
            send(listOf(key), "press")
        }
    }

    fun repeatUp(key: String, holdDown: Boolean) {
        if (!direct || !holdDown) return
        if (key in downKeys) {
            send(listOf(key), "up")
            downKeys = downKeys - key
        }
    }

    fun pasteClipboard() {
        releaseLatched()
        val text = clipboard.getText()?.text.orEmpty()
        if (text.isEmpty()) {
            note = "CLIPBOARD EMPTY"
            return
        }
        tick()
        viewModel.sendKeyboardText(text)
        note = "PASTED ${text.length} CHARS"
    }

    fun toggleSymbols() {
        tick()
        symbols = !symbols
        note = if (symbols) "DIGITS + SYMBOLS" else "LETTERS"
    }

    fun toggleFn() {
        tick()
        fnOpen = !fnOpen
    }

    // The panel owns the whole keyboard. If a text field on another screen left
    // the system IME open, hide it so two keyboards never stack.
    LaunchedEffect(Unit) {
        keyboardController?.hide()
    }

    // A forgotten latched modifier must not stay down on the PC. The desktop
    // also has a watchdog, but six seconds is local and predictable.
    LaunchedEffect(latchedKeys) {
        if (latchedKeys.isEmpty()) return@LaunchedEffect
        delay(6_000)
        if (latchedKeys.isNotEmpty()) releaseLatched()
    }

    // A physically held key (W in a game, Shift for a long selection) must
    // outlive the desktop's 15 s watchdog. Keepalive is a keyboard-v2 feature.
    LaunchedEffect(direct) {
        if (!direct) return@LaunchedEffect
        while (true) {
            delay(5_000)
            viewModel.keepKeyboardAlive()
        }
    }

    BackHandler { viewModel.closeKeyboardPad() }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, viewModel) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                viewModel.closeKeyboardPad(cancel = true)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    DisposableEffect(viewModel) {
        onDispose { viewModel.closeKeyboardPad(cancel = true) }
    }

    Box(
        modifier
            .fillMaxSize()
            .background(Ink)
            // The deck pager is still composed underneath; consume the Final
            // pass so a key gesture cannot also flip a deck page.
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
                .navigationBarsPadding()
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            KeyboardHeader(
                label = options.label,
                status = status,
                capable = capable,
                direct = direct,
                note = note,
                onPaste = ::pasteClipboard,
                onClose = { viewModel.closeKeyboardPad() },
            )

            Spacer(Modifier.height(10.dp))

            Box(
                Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentAlignment = Alignment.BottomCenter,
            ) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .widthIn(max = 760.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    if (fnOpen) {
                        FunctionRow(start = 1, shiftActive = shiftActive, enabled = capable, onKey = ::tapDown, onUp = ::tapUp)
                        FunctionRow(start = 7, shiftActive = shiftActive, enabled = capable, onKey = ::tapDown, onUp = ::tapUp)
                    }

                    if (symbols) {
                        SymbolLayer(
                            shiftActive = shiftActive,
                            shiftArmed = shiftArmed,
                            enabled = capable,
                            isDown = { it in downKeys },
                            onTapDown = ::tapDown,
                            onTapUp = ::tapUp,
                            onModifierDown = ::modifierDown,
                            onModifierUp = ::modifierUp,
                            onRepeatDown = ::repeatDown,
                            onRepeatTick = ::repeatTick,
                            onRepeatUp = ::repeatUp,
                            onSymbols = ::toggleSymbols,
                            onPaste = ::pasteClipboard,
                        )
                    } else {
                        LetterLayer(
                            shiftActive = shiftActive,
                            shiftArmed = shiftArmed,
                            enabled = capable,
                            isDown = { it in downKeys },
                            onTapDown = ::tapDown,
                            onTapUp = ::tapUp,
                            onModifierDown = ::modifierDown,
                            onModifierUp = ::modifierUp,
                            onRepeatDown = ::repeatDown,
                            onRepeatTick = ::repeatTick,
                            onRepeatUp = ::repeatUp,
                            onSymbols = ::toggleSymbols,
                            onPaste = ::pasteClipboard,
                        )
                    }

                    ToolbarRow(
                        shiftActive = shiftActive,
                        fnOpen = fnOpen,
                        enabled = capable,
                        isDown = { it in downKeys },
                        isLatched = { it in latchedKeys },
                        onTapDown = ::tapDown,
                        onTapUp = ::tapUp,
                        onModifierDown = ::modifierDown,
                        onModifierUp = ::modifierUp,
                        onRepeatDown = ::repeatDown,
                        onRepeatTick = ::repeatTick,
                        onRepeatUp = ::repeatUp,
                        onFn = ::toggleFn,
                    )
                }
            }

            Spacer(Modifier.height(6.dp))
        }
    }
}

/* ------------------------------------------------------------------ */
/* Layout                                                             */
/* ------------------------------------------------------------------ */

private sealed interface PadAction {
    data class Tap(val key: String) : PadAction
    data class Modifier(val key: String) : PadAction
    /** repeat=false: press repeats. repeat=true: down is held, repeats are down frames. */
    data class Repeat(val key: String, val holdDown: Boolean) : PadAction
    data object Symbols : PadAction
    data object Fn : PadAction
    data object Paste : PadAction
}

private data class PadKey(
    val label: String,
    val action: PadAction,
    val shiftedLabel: String? = null,
    val weight: Float = 1f,
    val accent: Boolean = false,
)

private fun letter(label: String) = PadKey(label, PadAction.Tap(label))

private fun digit(label: String, shifted: String) =
    PadKey(label, PadAction.Tap(label), shiftedLabel = shifted)

@Composable
private fun LetterLayer(
    shiftActive: Boolean,
    shiftArmed: Boolean,
    enabled: Boolean,
    isDown: (String) -> Boolean,
    onTapDown: (String) -> Unit,
    onTapUp: (String) -> Unit,
    onModifierDown: (String) -> Unit,
    onModifierUp: (String) -> Unit,
    onRepeatDown: (String, Boolean) -> Unit,
    onRepeatTick: (String, Boolean) -> Unit,
    onRepeatUp: (String, Boolean) -> Unit,
    onSymbols: () -> Unit,
    onPaste: () -> Unit,
) {
    KeyRow(
        keys = listOf(
            letter("Q"), letter("W"), letter("E"), letter("R"), letter("T"),
            letter("Y"), letter("U"), letter("I"), letter("O"), letter("P"),
        ),
        shiftActive = shiftActive,
        shiftArmed = shiftArmed,
        enabled = enabled,
        isDown = isDown,
        onTapDown = onTapDown,
        onTapUp = onTapUp,
        onModifierDown = onModifierDown,
        onModifierUp = onModifierUp,
        onRepeatDown = onRepeatDown,
        onRepeatTick = onRepeatTick,
        onRepeatUp = onRepeatUp,
        onSymbols = onSymbols,
        onPaste = onPaste,
    )
    KeyRow(
        keys = listOf(
            letter("A"), letter("S"), letter("D"), letter("F"), letter("G"),
            letter("H"), letter("J"), letter("K"), letter("L"),
        ),
        shiftActive = shiftActive,
        shiftArmed = shiftArmed,
        enabled = enabled,
        isDown = isDown,
        onTapDown = onTapDown,
        onTapUp = onTapUp,
        onModifierDown = onModifierDown,
        onModifierUp = onModifierUp,
        onRepeatDown = onRepeatDown,
        onRepeatTick = onRepeatTick,
        onRepeatUp = onRepeatUp,
        onSymbols = onSymbols,
        onPaste = onPaste,
        leadingStagger = 0.5f,
    )
    KeyRow(
        keys = listOf(
            PadKey("⇧", PadAction.Modifier("SHIFT"), weight = 1.4f),
            letter("Z"), letter("X"), letter("C"), letter("V"),
            letter("B"), letter("N"), letter("M"),
            PadKey("⌫", PadAction.Repeat("BACKSPACE", holdDown = false), weight = 1.4f),
        ),
        shiftActive = shiftActive,
        shiftArmed = shiftArmed,
        enabled = enabled,
        isDown = isDown,
        onTapDown = onTapDown,
        onTapUp = onTapUp,
        onModifierDown = onModifierDown,
        onModifierUp = onModifierUp,
        onRepeatDown = onRepeatDown,
        onRepeatTick = onRepeatTick,
        onRepeatUp = onRepeatUp,
        onSymbols = onSymbols,
        onPaste = onPaste,
    )
    KeyRow(
        keys = listOf(
            PadKey("?123", PadAction.Symbols, weight = 1.4f),
            PadKey(",", PadAction.Tap(",")),
            PadKey("SPACE", PadAction.Tap("SPACE"), weight = 3.6f),
            PadKey(".", PadAction.Tap(".")),
            PadKey("⏎", PadAction.Tap("ENTER"), weight = 1.4f, accent = true),
        ),
        shiftActive = shiftActive,
        shiftArmed = shiftArmed,
        enabled = enabled,
        isDown = isDown,
        onTapDown = onTapDown,
        onTapUp = onTapUp,
        onModifierDown = onModifierDown,
        onModifierUp = onModifierUp,
        onRepeatDown = onRepeatDown,
        onRepeatTick = onRepeatTick,
        onRepeatUp = onRepeatUp,
        onSymbols = onSymbols,
        onPaste = onPaste,
    )
}

@Composable
private fun SymbolLayer(
    shiftActive: Boolean,
    shiftArmed: Boolean,
    enabled: Boolean,
    isDown: (String) -> Boolean,
    onTapDown: (String) -> Unit,
    onTapUp: (String) -> Unit,
    onModifierDown: (String) -> Unit,
    onModifierUp: (String) -> Unit,
    onRepeatDown: (String, Boolean) -> Unit,
    onRepeatTick: (String, Boolean) -> Unit,
    onRepeatUp: (String, Boolean) -> Unit,
    onSymbols: () -> Unit,
    onPaste: () -> Unit,
) {
    KeyRow(
        keys = listOf(
            digit("1", "!"), digit("2", "@"), digit("3", "#"), digit("4", "$"),
            digit("5", "%"), digit("6", "^"), digit("7", "&"), digit("8", "*"),
            digit("9", "("), digit("0", ")"),
        ),
        shiftActive = shiftActive,
        shiftArmed = shiftArmed,
        enabled = enabled,
        isDown = isDown,
        onTapDown = onTapDown,
        onTapUp = onTapUp,
        onModifierDown = onModifierDown,
        onModifierUp = onModifierUp,
        onRepeatDown = onRepeatDown,
        onRepeatTick = onRepeatTick,
        onRepeatUp = onRepeatUp,
        onSymbols = onSymbols,
        onPaste = onPaste,
    )
    KeyRow(
        keys = listOf(
            PadKey("-", PadAction.Tap("-"), shiftedLabel = "_"),
            PadKey("=", PadAction.Tap("="), shiftedLabel = "+"),
            PadKey("[", PadAction.Tap("["), shiftedLabel = "{"),
            PadKey("]", PadAction.Tap("]"), shiftedLabel = "}"),
            PadKey("\\", PadAction.Tap("\\"), shiftedLabel = "|"),
            PadKey(";", PadAction.Tap(";"), shiftedLabel = ":"),
            PadKey("'", PadAction.Tap("'"), shiftedLabel = "\""),
            PadKey(",", PadAction.Tap(","), shiftedLabel = "<"),
            PadKey(".", PadAction.Tap("."), shiftedLabel = ">"),
            PadKey("/", PadAction.Tap("/"), shiftedLabel = "?"),
        ),
        shiftActive = shiftActive,
        shiftArmed = shiftArmed,
        enabled = enabled,
        isDown = isDown,
        onTapDown = onTapDown,
        onTapUp = onTapUp,
        onModifierDown = onModifierDown,
        onModifierUp = onModifierUp,
        onRepeatDown = onRepeatDown,
        onRepeatTick = onRepeatTick,
        onRepeatUp = onRepeatUp,
        onSymbols = onSymbols,
        onPaste = onPaste,
    )
    KeyRow(
        keys = listOf(
            PadKey("⇧", PadAction.Modifier("SHIFT"), weight = 1.4f),
            PadKey("`", PadAction.Tap("`"), shiftedLabel = "~"),
            PadKey("SPACE", PadAction.Tap("SPACE"), weight = 3.4f),
            PadKey("⌫", PadAction.Repeat("BACKSPACE", holdDown = false), weight = 1.4f),
            PadKey("⏎", PadAction.Tap("ENTER"), weight = 1.4f, accent = true),
        ),
        shiftActive = shiftActive,
        shiftArmed = shiftArmed,
        enabled = enabled,
        isDown = isDown,
        onTapDown = onTapDown,
        onTapUp = onTapUp,
        onModifierDown = onModifierDown,
        onModifierUp = onModifierUp,
        onRepeatDown = onRepeatDown,
        onRepeatTick = onRepeatTick,
        onRepeatUp = onRepeatUp,
        onSymbols = onSymbols,
        onPaste = onPaste,
    )
    KeyRow(
        keys = listOf(
            PadKey("ABC", PadAction.Symbols, weight = 1.4f),
            PadKey("PASTE", PadAction.Paste, weight = 1.8f),
            PadKey("TAB", PadAction.Repeat("TAB", holdDown = true), weight = 1.4f),
        ),
        shiftActive = shiftActive,
        shiftArmed = shiftArmed,
        enabled = enabled,
        isDown = isDown,
        onTapDown = onTapDown,
        onTapUp = onTapUp,
        onModifierDown = onModifierDown,
        onModifierUp = onModifierUp,
        onRepeatDown = onRepeatDown,
        onRepeatTick = onRepeatTick,
        onRepeatUp = onRepeatUp,
        onSymbols = onSymbols,
        onPaste = onPaste,
    )
}

@Composable
private fun ToolbarRow(
    shiftActive: Boolean,
    fnOpen: Boolean,
    enabled: Boolean,
    isDown: (String) -> Boolean,
    isLatched: (String) -> Boolean,
    onTapDown: (String) -> Unit,
    onTapUp: (String) -> Unit,
    onModifierDown: (String) -> Unit,
    onModifierUp: (String) -> Unit,
    onRepeatDown: (String, Boolean) -> Unit,
    onRepeatTick: (String, Boolean) -> Unit,
    onRepeatUp: (String, Boolean) -> Unit,
    onFn: () -> Unit,
) {
    KeyRow(
        keys = listOf(
            PadKey("ESC", PadAction.Tap("ESC")),
            PadKey("TAB", PadAction.Repeat("TAB", holdDown = true)),
            PadKey("CTRL", PadAction.Modifier("CTRL")),
            PadKey("ALT", PadAction.Modifier("ALT")),
            PadKey("WIN", PadAction.Modifier("WIN")),
            PadKey(if (fnOpen) "FN•" else "FN", PadAction.Fn, weight = 0.9f),
            PadKey("←", PadAction.Repeat("LEFT", holdDown = false)),
            PadKey("↑", PadAction.Repeat("UP", holdDown = false)),
            PadKey("↓", PadAction.Repeat("DOWN", holdDown = false)),
            PadKey("→", PadAction.Repeat("RIGHT", holdDown = false)),
        ),
        shiftActive = shiftActive,
        shiftArmed = false,
        enabled = enabled,
        isDown = { key -> isDown(key) },
        isLatched = isLatched,
        onTapDown = onTapDown,
        onTapUp = onTapUp,
        onModifierDown = onModifierDown,
        onModifierUp = onModifierUp,
        onRepeatDown = onRepeatDown,
        onRepeatTick = onRepeatTick,
        onRepeatUp = onRepeatUp,
        onSymbols = {},
        onFn = onFn,
        onPaste = {},
        compact = true,
    )
}

@Composable
private fun FunctionRow(
    start: Int,
    shiftActive: Boolean,
    enabled: Boolean,
    onKey: (String) -> Unit,
    onUp: (String) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for (index in start until start + 6) {
            Keycap(
                label = "F$index",
                description = "Function key F$index",
                modifier = Modifier.weight(1f),
                enabled = enabled,
                compact = true,
                onActivate = {
                    onKey("F$index")
                    onUp("F$index")
                },
                gesture = downUpGesture(
                    onDown = { onKey("F$index") },
                    onUp = { onUp("F$index") },
                ),
            )
        }
    }
}

@Composable
private fun KeyRow(
    keys: List<PadKey>,
    shiftActive: Boolean,
    shiftArmed: Boolean,
    enabled: Boolean,
    isDown: (String) -> Boolean,
    isLatched: (String) -> Boolean = { false },
    onTapDown: (String) -> Unit,
    onTapUp: (String) -> Unit,
    onModifierDown: (String) -> Unit,
    onModifierUp: (String) -> Unit,
    onRepeatDown: (String, Boolean) -> Unit,
    onRepeatTick: (String, Boolean) -> Unit,
    onRepeatUp: (String, Boolean) -> Unit,
    onSymbols: () -> Unit,
    onFn: () -> Unit = {},
    onPaste: () -> Unit,
    leadingStagger: Float = 0f,
    compact: Boolean = false,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (leadingStagger > 0f) Spacer(Modifier.weight(leadingStagger))
        for (key in keys) {
            val label = if (shiftActive && key.shiftedLabel != null) key.shiftedLabel else key.label
            when (val action = key.action) {
                is PadAction.Modifier -> {
                    val armed = isDown(action.key) || isLatched(action.key)
                    Keycap(
                        label = label,
                        description = "${action.key} modifier. Tap to latch, hold to keep down.",
                        modifier = Modifier.weight(key.weight),
                        accent = key.accent,
                        armed = armed,
                        enabled = enabled,
                        compact = compact,
                        onActivate = {
                            onModifierDown(action.key)
                            onModifierUp(action.key)
                        },
                        gesture = downUpGesture(
                            onDown = { onModifierDown(action.key) },
                            onUp = { onModifierUp(action.key) },
                        ),
                    )
                }

                is PadAction.Tap -> {
                    Keycap(
                        label = label,
                        description = label,
                        modifier = Modifier.weight(key.weight),
                        accent = key.accent,
                        armed = isDown(action.key),
                        enabled = enabled,
                        compact = compact,
                        onActivate = {
                            onTapDown(action.key)
                            onTapUp(action.key)
                        },
                        gesture = downUpGesture(
                            onDown = { onTapDown(action.key) },
                            onUp = { onTapUp(action.key) },
                        ),
                    )
                }

                is PadAction.Repeat -> {
                    RepeatKeycap(
                        label = label,
                        description = if (action.holdDown) "Hold $label; repeats while held" else "$label; repeats while held",
                        modifier = Modifier.weight(key.weight),
                        enabled = enabled,
                        compact = compact,
                        onDown = { onRepeatDown(action.key, action.holdDown) },
                        onRepeat = { onRepeatTick(action.key, action.holdDown) },
                        onUp = { onRepeatUp(action.key, action.holdDown) },
                        onActivate = {
                            onRepeatDown(action.key, action.holdDown)
                            onRepeatUp(action.key, action.holdDown)
                        },
                    )
                }

                PadAction.Symbols -> {
                    Keycap(
                        label = label,
                        description = "Switch between letters and symbols",
                        modifier = Modifier.weight(key.weight),
                        enabled = enabled,
                        compact = compact,
                        onActivate = onSymbols,
                        gesture = tapGesture(onSymbols),
                    )
                }

                PadAction.Fn -> {
                    Keycap(
                        label = label,
                        description = "Function keys",
                        modifier = Modifier.weight(key.weight),
                        enabled = enabled,
                        compact = compact,
                        armed = isDown("FN"),
                        onActivate = onFn,
                        gesture = tapGesture(onFn),
                    )
                }

                PadAction.Paste -> {
                    Keycap(
                        label = label,
                        description = "Paste the phone clipboard on the PC",
                        modifier = Modifier.weight(key.weight),
                        enabled = enabled,
                        compact = compact,
                        onActivate = onPaste,
                        gesture = tapGesture(onPaste),
                    )
                }
            }
        }
        if (leadingStagger > 0f) Spacer(Modifier.weight(leadingStagger))
    }
}

/* ------------------------------------------------------------------ */
/* Header and key frames                                              */
/* ------------------------------------------------------------------ */

@Composable
private fun KeyboardHeader(
    label: String,
    status: KeyboardStatus,
    capable: Boolean,
    direct: Boolean,
    note: String,
    onPaste: () -> Unit,
    onClose: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = if (direct) "KEY 01 · DIRECT" else "KEY 01 · COMPAT",
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
            if (note.isNotEmpty()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = note,
                    color = AccentHigh,
                    fontFamily = ConsoleMono,
                    fontSize = 8.sp,
                    letterSpacing = 1.0.sp,
                    maxLines = 1,
                )
            }
        }

        Text(
            text = when {
                !capable -> "NO CAP"
                status == KeyboardStatus.OPENING -> "SYNC"
                status == KeyboardStatus.TX_ERROR -> "TX ERR"
                else -> "LIVE"
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
            modifier = Modifier.padding(horizontal = 8.dp),
        )

        Box(
            Modifier
                .height(36.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(PanelRaised)
                .border(1.dp, HairlineStrong, RoundedCornerShape(4.dp))
                .semantics {
                    contentDescription = "Paste phone clipboard"
                    role = Role.Button
                    onClick(label = "Paste") {
                        onPaste()
                        true
                    }
                }
                .pointerInput(Unit) { detectTapGestures(onTap = { onPaste() }) }
                .padding(horizontal = 10.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "PASTE",
                color = TextSecondary,
                fontFamily = ConsoleMono,
                fontSize = 9.sp,
                letterSpacing = 1.0.sp,
            )
        }

        Box(
            Modifier
                .height(36.dp)
                .padding(start = 6.dp)
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
                .pointerInput(Unit) { detectTapGestures(onTap = { onClose() }) }
                .padding(horizontal = 12.dp),
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
private fun Keycap(
    label: String,
    description: String,
    modifier: Modifier,
    enabled: Boolean,
    compact: Boolean,
    accent: Boolean = false,
    armed: Boolean = false,
    onActivate: (() -> Unit)? = null,
    gesture: suspend androidx.compose.ui.input.pointer.PointerInputScope.() -> Unit,
) {
    val latestGesture by rememberUpdatedState(gesture)
    val shape = RoundedCornerShape(4.dp)
    val background = when {
        !enabled -> Panel
        accent -> Accent
        armed -> AccentWash
        else -> PanelRaised
    }
    val foreground = when {
        !enabled -> TextFaint
        accent -> AccentInk
        armed -> AccentHigh
        else -> TextSecondary
    }
    val border = if (enabled && (accent || armed)) Accent else HairlineStrong
    val semanticsModifier = if (onActivate != null && enabled) {
        val activate: () -> Unit = onActivate ?: {}
        Modifier.semantics {
            role = Role.Button
            contentDescription = description
            onClick(label = description) {
                activate()
                true
            }
        }
    } else {
        Modifier.semantics {
            role = Role.Button
            contentDescription = description
        }
    }
    Box(
        modifier
            .height(if (compact) 38.dp else 44.dp)
            .clip(shape)
            .background(background)
            .border(1.dp, border, shape)
            // The armed/down visuals change while a finger is down. They must
            // not restart the gesture, or the matching key-up is cancelled and
            // the PC is left with a stuck key.
            .pointerInput(enabled) {
                if (enabled) latestGesture()
            }
            .then(semanticsModifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = foreground,
            fontFamily = ConsoleMono,
            fontSize = if (compact || label.length > 2) 9.sp else 12.sp,
            fontWeight = if (accent || armed) FontWeight.Medium else FontWeight.Normal,
            maxLines = 1,
        )
    }
}

@Composable
private fun RepeatKeycap(
    label: String,
    description: String,
    modifier: Modifier,
    enabled: Boolean,
    compact: Boolean,
    onDown: () -> Unit,
    onRepeat: () -> Unit,
    onUp: () -> Unit,
    onActivate: (() -> Unit)? = null,
) {
    Keycap(
        label = label,
        description = description,
        modifier = modifier,
        enabled = enabled,
        compact = compact,
        onActivate = onActivate,
        gesture = {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                down.consume()
                onDown()
                var waitMs = 430L
                while (true) {
                    val event = withTimeoutOrNull(waitMs) {
                        awaitPointerEvent(PointerEventPass.Initial)
                    }
                    if (event == null) {
                        onRepeat()
                        waitMs = 70L
                    } else {
                        event.changes.forEach { change -> change.consume() }
                        if (event.changes.none { change -> change.pressed }) break
                    }
                }
                onUp()
            }
        },
    )
}

private fun downUpGesture(
    onDown: () -> Unit,
    onUp: () -> Unit,
): suspend androidx.compose.ui.input.pointer.PointerInputScope.() -> Unit = {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false)
        down.consume()
        onDown()
        waitForUpOrCancellation()
        onUp()
    }
}

private fun tapGesture(onTap: () -> Unit): suspend androidx.compose.ui.input.pointer.PointerInputScope.() -> Unit = {
    detectTapGestures(onTap = { onTap() })
}
