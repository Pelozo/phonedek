package com.phonedek.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phonedek.app.util.Diag

@Composable
fun DiagnosticsDialog(onDismiss: () -> Unit) {
    var logs by remember { mutableStateOf(Diag.snapshot()) }
    val clipboard = LocalClipboardManager.current

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Navy800,
        titleContentColor = Color(0xFFE2E8F0),
        textContentColor = Slate300,
        title = { Text("PhoneDeck diagnostics") },
        text = {
            Column {
                Text(
                    text = "Last 40 pairing/connection events. PINs are never logged.",
                    color = Slate500,
                    fontSize = 11.sp,
                )
                Spacer(Modifier.height(8.dp))
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = Navy950,
                    border = BorderStroke(1.dp, Color.White.copy(alpha = 0.07f)),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    SelectionContainer {
                        Text(
                            text = logs.lines().takeLast(40).joinToString("\n")
                                .ifBlank { "No diagnostics yet. Try pairing, then reopen this dialog." },
                            color = Slate300,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 8.sp,
                            lineHeight = 11.sp,
                            modifier = Modifier.padding(10.dp),
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "adb logcat -s PhoneDeck",
                    color = Slate500,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 9.sp,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Close") }
        },
        dismissButton = {
            TextButton(onClick = {
                clipboard.setText(AnnotatedString(Diag.snapshot()))
                logs = Diag.snapshot()
            }) { Text("Copy") }
        },
    )
}
