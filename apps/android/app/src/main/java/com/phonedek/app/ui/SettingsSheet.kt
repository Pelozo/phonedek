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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phonedek.app.BuildConfig
import com.phonedek.app.util.Diag

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
        containerColor = Navy800,
        contentColor = Color(0xFFE2E8F0),
        scrimColor = Color.Black.copy(alpha = 0.6f),
        dragHandle = {
            BottomSheetDefaults.DragHandle(color = Color.White.copy(alpha = 0.18f))
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp)
                .padding(bottom = 26.dp)
                .navigationBarsPadding(),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Settings",
                    style = androidx.compose.material3.MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onDismiss) { Text("Close") }
            }

            Spacer(Modifier.height(6.dp))

            Surface(
                shape = RoundedCornerShape(16.dp),
                color = Navy950,
                border = BorderStroke(1.dp, Color.White.copy(alpha = 0.07f)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        text = "SERVER",
                        color = Slate500,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 0.8.sp,
                    )
                    Spacer(Modifier.height(5.dp))
                    Text(
                        text = pairing?.serverName ?: "Not paired",
                        color = Color(0xFFE2E8F0),
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (pairing != null) {
                        Spacer(Modifier.height(2.dp))
                        Text(
                            text = "${pairing.host}:${pairing.port}",
                            color = Slate500,
                            fontSize = 12.sp,
                        )
                    }
                }
            }

            Spacer(Modifier.height(14.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(
                    onClick = onReconnect,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Reconnect")
                }
                OutlinedButton(
                    onClick = { confirmChange = true },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Red400),
                    border = BorderStroke(1.dp, Red400.copy(alpha = 0.4f)),
                ) {
                    Text("Change server")
                }
            }

            Spacer(Modifier.height(20.dp))
            HorizontalDivider(color = Color.White.copy(alpha = 0.07f))
            Spacer(Modifier.height(16.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "Keep screen on",
                        color = Color(0xFFE2E8F0),
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        text = "Prevents the phone from sleeping while the deck is open.",
                        color = Slate500,
                        fontSize = 12.sp,
                    )
                }
                Switch(
                    checked = state.keepScreenOn,
                    onCheckedChange = onKeepScreenOn,
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Color(0xFF03130D),
                        checkedTrackColor = Emerald400,
                        uncheckedThumbColor = Slate300,
                        uncheckedTrackColor = Navy700,
                        uncheckedBorderColor = Color.White.copy(alpha = 0.16f),
                    ),
                )
            }

            Spacer(Modifier.height(18.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "Hide top bar when connected",
                        color = Color(0xFFE2E8F0),
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        text = "Uses the full screen for the deck. A gear button stays " +
                            "in the top-right, so Settings are always one tap away.",
                        color = Slate500,
                        fontSize = 12.sp,
                    )
                }
                Switch(
                    checked = state.hideTopBarWhenConnected,
                    onCheckedChange = onHideTopBarWhenConnected,
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Color(0xFF03130D),
                        checkedTrackColor = Emerald400,
                        uncheckedThumbColor = Slate300,
                        uncheckedTrackColor = Navy700,
                        uncheckedBorderColor = Color.White.copy(alpha = 0.16f),
                    ),
                )
            }

            Spacer(Modifier.height(20.dp))
            HorizontalDivider(color = Color.White.copy(alpha = 0.07f))
            Spacer(Modifier.height(16.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "DIAGNOSTICS",
                        color = Slate500,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 0.8.sp,
                    )
                    Text(
                        text = "Pairing and connection events (last 25).",
                        color = Slate500,
                        fontSize = 11.sp,
                    )
                }
                TextButton(onClick = { logs = Diag.snapshot() }) { Text("Refresh") }
                TextButton(onClick = { clipboard.setText(AnnotatedString(Diag.snapshot())) }) {
                    Text("Copy")
                }
            }

            Surface(
                shape = RoundedCornerShape(12.dp),
                color = Navy950,
                border = BorderStroke(1.dp, Color.White.copy(alpha = 0.07f)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                SelectionContainer {
                    Text(
                        text = logs.lines().takeLast(25).joinToString("\n")
                            .ifBlank { "No diagnostics yet. Try pairing, then press Refresh." },
                        color = Slate300,
                        fontFamily = FontFamily.Monospace,
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
                }) { Text("Clear") }
                Text(
                    text = "adb logcat -s PhoneDeck",
                    color = Slate500,
                    fontSize = 10.sp,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier.padding(top = 14.dp),
                )
            }

            Spacer(Modifier.height(18.dp))
            Text(
                text = "PhoneDeck ${BuildConfig.VERSION_NAME}  •  protocol 1",
                color = Slate500,
                fontSize = 11.sp,
            )
        }
    }

    if (confirmChange) {
        AlertDialog(
            onDismissRequest = { confirmChange = false },
            containerColor = Navy800,
            titleContentColor = Color(0xFFE2E8F0),
            textContentColor = Slate300,
            title = { Text("Change server?") },
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
                    Text("Change server", color = Red400)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmChange = false }) { Text("Cancel") }
            },
        )
    }
}
