package com.phonedek.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val Navy950 = Color(0xFF080D19)
val Navy900 = Color(0xFF0B1220)
val Navy800 = Color(0xFF0F172A)
val Navy700 = Color(0xFF1E293B)
val Slate500 = Color(0xFF64748B)
val Slate300 = Color(0xFFCBD5E1)
val Emerald400 = Color(0xFF34D399)
val Emerald500 = Color(0xFF10B981)
val Amber400 = Color(0xFFFBBF24)
val Red400 = Color(0xFFF87171)

private val DeckColors = darkColorScheme(
    primary = Emerald400,
    onPrimary = Color(0xFF03130D),
    primaryContainer = Color(0xFF0B3B2A),
    onPrimaryContainer = Color(0xFFA7F3D0),
    secondary = Color(0xFF38BDF8),
    onSecondary = Color(0xFF04131C),
    secondaryContainer = Color(0xFF0C4A6E),
    onSecondaryContainer = Color(0xFFBAE6FD),
    background = Navy950,
    onBackground = Color(0xFFE2E8F0),
    surface = Navy800,
    onSurface = Color(0xFFE2E8F0),
    surfaceVariant = Navy700,
    onSurfaceVariant = Color(0xFF94A3B8),
    outline = Color(0xFF334155),
    outlineVariant = Color(0xFF1E293B),
    error = Red400,
    onError = Color(0xFF2A0808),
    errorContainer = Color(0xFF3F1212),
    onErrorContainer = Color(0xFFFECACA),
    scrim = Color.Black,
)

private val DeckTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 32.sp,
        lineHeight = 36.sp,
        letterSpacing = (-0.5).sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        lineHeight = 28.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 19.sp,
        lineHeight = 24.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 21.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 12.sp,
        lineHeight = 17.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        letterSpacing = 0.2.sp,
    ),
)

@Composable
fun PhoneDeckTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DeckColors,
        typography = DeckTypography,
        content = content,
    )
}
