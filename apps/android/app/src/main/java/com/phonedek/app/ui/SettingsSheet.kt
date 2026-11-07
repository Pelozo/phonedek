package com.phonedek.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phonedek.app.BuildConfig
import com.phonedek.app.util.Diag

private val SheetShape = RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp)
private val ControlShape = RoundedCornerShape(4.dp)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(
    state: UiState,
    onDismiss: () -> Unit,
    onReconnect: () -> Unit,
    onChangeServer: () -> Unit,
    onKeepScreenOn: (Boolean) -> Unit,
    onHideTopBarWhenConnected: (Boolean) -> Unit,
) {
    var confirmChange by remember { mutableStateOf(false) }
    var logs by remember { mutableStateOf(Diag.snapshot()) }
    val clipboard = LocalClipboardManager.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val pairing = state.pairing

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Panel,
        contentColor = TextSecondary,
        scrimColor = Color.Black.copy(alpha = 0.72f),
        shape = SheetShape,
        tonalElevation = 0.dp,
        dragHandle = {
            BottomSheetDefaults.DragHandle(color = HairlineStrong)
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 26.dp)
                .navigationBarsPadding(),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ConsoleTitleRule(
                    title = "Settings",
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onDismiss) {
                    Text("Close", color = TextMuted, fontSize = 12.sp)
                }
            }

            Spacer(Modifier.height(18.dp))
            ConsoleSectionLabel(index = "01", label = "SERVER")
            Spacer(Modifier.height(10.dp))

            Text(
                text = pairing?.serverName ?: "Not paired",
                color = if (pairing != null) TextPrimary else TextMuted,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (pairing != null) {
                Spacer(Modifier.height(3.dp))
                Text(
                    text = "${pairing.host}:${pairing.port}",
                    color = TextMuted,
                    fontFamily = ConsoleMono,
                    fontSize = 11.sp,
                    letterSpacing = 0.3.sp,
                )
            }

            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(
                    onClick = onReconnect,
                    modifier = Modifier
                        .weight(1f)
                        .height(40.dp),
                    shape = ControlShape,
                    border = BorderStroke(1.dp, HairlineStrong),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = TextSecondary),
                ) {
                    Text("Reconnect", fontSize = 12.sp)
                }
                OutlinedButton(
                    onClick = { confirmChange = true },
                    modifier = Modifier
                        .weight(1f)
                        .height(40.dp),
                    shape = ControlShape,
                    border = BorderStroke(1.dp, StatusDanger.copy(alpha = 0.55f)),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = StatusDanger),
                ) {
                    Text("Change server", fontSize = 12.sp)
                }
            }

            Spacer(Modifier.height(20.dp))
            HorizontalDivider(color = Hairline)
            Spacer(Modifier.height(16.dp))

            ConsoleSectionLabel(index = "02", label = "BEHAVIOR")
            Spacer(Modifier.height(4.dp))

            SettingToggle(
                title = "Keep screen on",
                description = "Prevents the phone from sleeping while the deck is open.",
                checked = state.keepScreenOn,
                onCheckedChange = onKeepScreenOn,
            )
            HorizontalDivider(color = Hairline)
            SettingToggle(
                title = "Hide all chrome when connected",
                description = "Uses the whole screen for the deck. Swipe down from the " +
                    "top edge to show the top bar and Settings again.",
                checked = state.hideTopBarWhenConnected,
                onCheckedChange = onHideTopBarWhenConnected,
            )

            Spacer(Modifier.height(20.dp))
            HorizontalDivider(color = Hairline)
            Spacer(Modifier.height(16.dp))

            ConsoleSectionLabel(index = "03", label = "DIAGNOSTICS")
            Spacer(Modifier.height(6.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Pairing and connection events (last 25).",
                    color = TextMuted,
                    fontSize = 11.sp,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { logs = Diag.snapshot() }) {
                    Text("Refresh", color = TextMuted, fontSize = 11.sp)
                }
                TextButton(onClick = { clipboard.setText(AnnotatedString(Diag.snapshot())) }) {
                    Text("Copy", color = Accent, fontSize = 11.sp)
                }
            }

            Surface(
                shape = ControlShape,
                color = InkDeep,
                border = BorderStroke(1.dp, Hairline),
                modifier = Modifier.fillMaxWidth(),
            ) {
                SelectionContainer {
                    Text(
                        text = logs.lines().takeLast(25).joinToString("\n")
                            .ifBlank { "No diagnostics yet. Try pairing, then press Refresh." },
                        color = TextSecondary,
                        fontFamily = ConsoleMono,
                        fontSize = 9.sp,
                        lineHeight = 13.sp,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                TextButton(onClick = {
                    Diag.clear()
                    logs = Diag.snapshot()
                }) {
                    Text("Clear", color = TextMuted, fontSize = 11.sp)
                }
                Text(
                    text = "adb logcat -s PhoneDeck",
                    color = TextFaint,
                    fontSize = 10.sp,
                    fontFamily = ConsoleMono,
                    modifier = Modifier.padding(top = 14.dp),
                )
            }

            Spacer(Modifier.height(18.dp))
            Text(
                text = "PhoneDeck ${BuildConfig.VERSION_NAME}  ·  protocol 1",
                color = TextFaint,
                fontFamily = ConsoleMono,
                fontSize = 10.sp,
                letterSpacing = 0.3.sp,
            )
        }
    }

    if (confirmChange) {
        AlertDialog(
            onDismissRequest = { confirmChange = false },
            shape = RoundedCornerShape(8.dp),
            containerColor = Panel,
            titleContentColor = TextPrimary,
            textContentColor = TextSecondary,
            title = { ConsoleTitleRule("Change server?", color = StatusDanger) },
            text = {
                Text(
                    "The saved server and PIN will be removed from this phone. " +
                        "You will need the QR code or PIN to pair again.",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmChange = false
                        onChangeServer()
                    },
                ) {
                    Text("Change server", color = StatusDanger, fontWeight = FontWeight.Medium)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmChange = false }) {
                    Text("Cancel", color = TextMuted)
                }
            },
        )
    }
}

@Composable
private fun SettingToggle(
    title: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                color = TextPrimary,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = description,
                color = TextMuted,
                fontSize = 11.sp,
                lineHeight = 15.sp,
            )
        }
        Spacer(Modifier.width(12.dp))
        ConsoleSwitch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            contentDescription = title,
        )
    }
}
