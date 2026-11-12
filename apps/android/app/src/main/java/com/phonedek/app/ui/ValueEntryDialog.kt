package com.phonedek.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog

private val PlateShape = RoundedCornerShape(8.dp)
private val PlateControlShape = RoundedCornerShape(4.dp)

/**
 * Flat Studio Console plate for entering an exact value (B7).
 *
 * The field is prefilled with the current value and selected, so typing
 * replaces it. Set stays disabled for empty/non-numeric input; an out-of-range
 * or off-step value is clamped and snapped before it is sent.
 */
@Composable
fun ValueEntryDialog(
    title: String,
    minValue: Float,
    maxValue: Float,
    step: Float,
    unit: String,
    initial: Float,
    onDismiss: () -> Unit,
    onConfirm: (Float) -> Unit,
) {
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val initialText = ValueEntry.formatNumber(initial)
    var field by remember {
        mutableStateOf(
            TextFieldValue(
                text = initialText,
                selection = TextRange(0, initialText.length),
            ),
        )
    }
    val parsed = ValueEntry.parse(field.text, minValue, maxValue, step)
    val rangeText = ValueEntry.rangeText(minValue, maxValue, unit)

    fun submit() {
        val next = parsed.value ?: return
        keyboard?.hide()
        onConfirm(next)
    }

    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = PlateShape,
            color = Panel,
            border = BorderStroke(1.dp, HairlineStrong),
            shadowElevation = 16.dp,
        ) {
            Column(Modifier.padding(horizontal = 18.dp, vertical = 16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .width(3.dp)
                            .height(18.dp)
                            .background(Accent),
                    )
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = "EXACT VALUE",
                            color = TextFaint,
                            fontFamily = ConsoleMono,
                            fontSize = 9.sp,
                            letterSpacing = 1.2.sp,
                            maxLines = 1,
                        )
                        Text(
                            text = title.ifBlank { "Control" },
                            color = TextPrimary,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "RANGE",
                        color = TextFaint,
                        fontFamily = ConsoleMono,
                        fontSize = 9.sp,
                        letterSpacing = 1.1.sp,
                    )
                    Spacer(Modifier.width(7.dp))
                    Text(
                        text = rangeText,
                        color = TextSecondary,
                        fontFamily = ConsoleMono,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        text = "STEP ${ValueEntry.formatNumber(step)}",
                        color = TextFaint,
                        fontFamily = ConsoleMono,
                        fontSize = 9.sp,
                        letterSpacing = 1.1.sp,
                    )
                }
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = field,
                    onValueChange = { field = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(focusRequester),
                    singleLine = true,
                    isError = parsed.invalid,
                    shape = PlateControlShape,
                    textStyle = TextStyle(
                        fontFamily = ConsoleMono,
                        fontWeight = FontWeight.Bold,
                        fontSize = 26.sp,
                        textAlign = TextAlign.Center,
                    ),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        disabledTextColor = TextFaint,
                        errorTextColor = TextPrimary,
                        focusedContainerColor = PanelRaised,
                        unfocusedContainerColor = PanelRaised,
                        errorContainerColor = PanelRaised,
                        cursorColor = Accent,
                        errorCursorColor = StatusDanger,
                        focusedBorderColor = Accent,
                        unfocusedBorderColor = HairlineStrong,
                        errorBorderColor = StatusDanger,
                    ),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Decimal,
                        imeAction = ImeAction.Done,
                    ),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                )
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(20.dp)
                        .padding(top = 3.dp),
                ) {
                    val note = when {
                        parsed.invalid -> "Enter a number"
                        parsed.adjusts -> "SETS ${ValueEntry.formatValue(parsed.value!!, unit)}"
                        else -> ""
                    }
                    if (note.isNotEmpty()) {
                        Text(
                            text = note,
                            color = if (parsed.invalid) StatusDanger else TextMuted,
                            fontFamily = ConsoleMono,
                            fontSize = 10.sp,
                            maxLines = 1,
                        )
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = onDismiss) {
                        Text("Cancel", color = TextMuted, fontSize = 12.sp)
                    }
                    Spacer(Modifier.width(6.dp))
                    Button(
                        onClick = { submit() },
                        enabled = parsed.canSet,
                        shape = PlateControlShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Accent,
                            contentColor = AccentInk,
                            disabledContainerColor = PanelHigh,
                            disabledContentColor = TextFaint,
                        ),
                    ) {
                        Text(
                            text = "Set",
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                        )
                    }
                }
            }
        }
    }
}
