package com.phonedek.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private const val DESKTOP_RELEASES_URL = "https://github.com/Pelozo/phonedek/releases/latest"
private val OnboardingButtonShape = RoundedCornerShape(4.dp)

@Composable
fun OnboardingScreen(
    isReopen: Boolean,
    onStartPairing: () -> Unit,
    onSkip: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val openDesktop = {
        runCatching {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(DESKTOP_RELEASES_URL)),
            )
        }
        Unit
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Ink)
            .safeDrawingPadding()
            .imePadding(),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp)
                .padding(top = 28.dp, bottom = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 680.dp).fillMaxWidth()) {
                DeckMark(size = 54.dp)
                Spacer(Modifier.height(16.dp))
                Text(
                    text = "FIRST SETUP",
                    color = TextMuted,
                    fontFamily = ConsoleMono,
                    fontSize = 9.sp,
                    letterSpacing = 1.6.sp,
                )
                Spacer(Modifier.height(5.dp))
                Text(
                    text = "Turn this phone into a deck",
                    style = androidx.compose.material3.MaterialTheme.typography.displaySmall,
                    color = TextPrimary,
                    modifier = Modifier.semantics { heading() },
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "PhoneDeck is a wireless Stream Deck. The PC runs your shortcuts; " +
                        "this phone is the keypad.",
                    color = TextMuted,
                    fontSize = 13.sp,
                    lineHeight = 19.sp,
                )

                Spacer(Modifier.height(22.dp))
                HorizontalDivider(color = Hairline)
                OnboardingStep(
                    number = "01",
                    title = "Run PhoneDeck on your PC",
                    body = "Install the Windows or macOS desktop app. It hosts the deck " +
                        "and runs your actions.",
                )
                HorizontalDivider(color = Hairline)
                OnboardingStep(
                    number = "02",
                    title = "Join the same Wi-Fi",
                    body = "Phone and PC on the same network. Allow Private-network " +
                        "firewall access on Windows.",
                )
                HorizontalDivider(color = Hairline)
                OnboardingStep(
                    number = "03",
                    title = "Pair from the desktop",
                    body = "Press Pair phone, then scan the QR code or enter the host and " +
                        "4-digit PIN here.",
                )
                HorizontalDivider(color = Hairline)
                OnboardingStep(
                    number = "04",
                    title = "Use the deck",
                    body = "Tap a key to run it on the PC, swipe for pages, and open the " +
                        "gear for settings. Keep the app open; taps go over the LAN.",
                )
                HorizontalDivider(color = Hairline)

                Spacer(Modifier.height(10.dp))
                TextButton(onClick = openDesktop) {
                    Text(
                        text = "GET THE DESKTOP APP →",
                        color = Accent,
                        fontFamily = ConsoleMono,
                        fontSize = 10.sp,
                        letterSpacing = 1.sp,
                    )
                }
            }
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp)
                .padding(bottom = 20.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(Modifier.widthIn(max = 680.dp).fillMaxWidth()) {
                HorizontalDivider(color = Hairline)
                Spacer(Modifier.height(16.dp))
                if (isReopen) {
                    Button(
                        onClick = onClose,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        shape = OnboardingButtonShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Accent,
                            contentColor = AccentInk,
                        ),
                    ) {
                        Text("Close", fontWeight = FontWeight.SemiBold)
                    }
                } else {
                    Button(
                        onClick = onStartPairing,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        shape = OnboardingButtonShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Accent,
                            contentColor = AccentInk,
                        ),
                    ) {
                        Text("Start pairing", fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = onSkip,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        shape = OnboardingButtonShape,
                        border = androidx.compose.foundation.BorderStroke(1.dp, HairlineStrong),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = TextSecondary),
                    ) {
                        Text("Skip")
                    }
                }
            }
        }
    }
}

@Composable
private fun OnboardingStep(
    number: String,
    title: String,
    body: String,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 14.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.Start,
    ) {
        Text(
            text = number,
            color = Accent,
            fontFamily = ConsoleMono,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.8.sp,
            modifier = Modifier.width(34.dp),
            textAlign = TextAlign.Start,
        )
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                color = TextPrimary,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.height(3.dp))
            Text(
                text = body,
                color = TextMuted,
                fontSize = 12.sp,
                lineHeight = 17.sp,
            )
        }
    }
}
