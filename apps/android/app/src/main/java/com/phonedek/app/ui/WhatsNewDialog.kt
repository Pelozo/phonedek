package com.phonedek.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.phonedek.app.data.whatsNewFor

private val WhatsNewPanelShape = RoundedCornerShape(8.dp)
private val WhatsNewControlShape = RoundedCornerShape(4.dp)

/**
 * Studio Console "What's New" surface. Dismissible by button, back gesture or
 * scrim tap; the content scrolls inside a capped-height panel so the deck is
 * never blocked permanently.
 */
@Composable
fun WhatsNewDialog(
    version: String,
    onDismiss: () -> Unit,
) {
    val entry = whatsNewFor(version)

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.72f))
                .safeDrawingPadding()
                .padding(16.dp),
            contentAlignment = Alignment.Center,
        ) {
            Surface(
                modifier = Modifier
                    .widthIn(max = 540.dp)
                    .fillMaxWidth()
                    .heightIn(max = 560.dp),
                shape = WhatsNewPanelShape,
                color = Panel,
                border = BorderStroke(1.dp, HairlineStrong),
                shadowElevation = 12.dp,
            ) {
                Column(Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(
                            start = 22.dp,
                            end = 22.dp,
                            top = 20.dp,
                            bottom = 16.dp,
                        ),
                    ) {
                        Text(
                            text = "WHAT'S NEW · $version",
                            color = Accent,
                            fontFamily = ConsoleMono,
                            fontSize = 9.sp,
                            letterSpacing = 1.4.sp,
                        )
                        Spacer(Modifier.height(8.dp))
                        ConsoleTitleRule(title = entry.title)
                    }

                    HorizontalDivider(color = Hairline)

                    Column(
                        modifier = Modifier
                            .weight(1f, fill = false)
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = 22.dp, vertical = 16.dp),
                    ) {
                        entry.highlights.forEachIndexed { index, highlight ->
                            HighlightRow(index = index + 1, text = highlight)
                            if (index != entry.highlights.lastIndex) {
                                Spacer(Modifier.height(12.dp))
                            }
                        }
                    }

                    HorizontalDivider(color = Hairline)

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            text = "PHONEDECK · v$version",
                            color = TextFaint,
                            fontFamily = ConsoleMono,
                            fontSize = 9.sp,
                            letterSpacing = 0.6.sp,
                        )
                        Button(
                            onClick = onDismiss,
                            modifier = Modifier.height(40.dp),
                            shape = WhatsNewControlShape,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Accent,
                                contentColor = AccentInk,
                            ),
                        ) {
                            Text(
                                text = "Close",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HighlightRow(index: Int, text: String) {
    Row(Modifier.fillMaxWidth()) {
        Text(
            text = index.toString().padStart(2, '0'),
            color = Accent,
            fontFamily = ConsoleMono,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.8.sp,
            modifier = Modifier
                .width(30.dp)
                .padding(top = 2.dp),
        )
        Text(
            text = text,
            color = TextSecondary,
            fontSize = 13.sp,
            lineHeight = 19.sp,
            modifier = Modifier.weight(1f),
        )
    }
}
