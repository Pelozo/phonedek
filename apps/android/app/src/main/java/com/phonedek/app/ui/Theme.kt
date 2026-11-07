package com.phonedek.app.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Studio Console palette: warm ink chassis, hairline structure, one signal orange.
val Ink = Color(0xFF121110)
val InkDeep = Color(0xFF0D0C0B)
val Panel = Color(0xFF191715)
val PanelRaised = Color(0xFF211E1A)
val PanelHigh = Color(0xFF2A2621)
val Hairline = Color(0xFF332F29)
val HairlineStrong = Color(0xFF4A433A)
val TextPrimary = Color(0xFFF1ECE2)
val TextSecondary = Color(0xFFCEC7B9)
val TextMuted = Color(0xFF948D80)
val TextFaint = Color(0xFF857E70)
val Accent = Color(0xFFF26A2E)
val AccentHigh = Color(0xFFFF7D40)
val AccentInk = Color(0xFF1C0D05)
val AccentWash = Color(0x1AF26A2E)
val StatusOk = Color(0xFF83C092)
val StatusWarn = Color(0xFFD9A441)
val StatusDanger = Color(0xFFE0685E)
val StatusInfo = Color(0xFF86A9C4)

private val ConsoleColors = darkColorScheme(
    primary = Accent,
    onPrimary = AccentInk,
    primaryContainer = Accent,
    onPrimaryContainer = AccentInk,
    secondary = StatusInfo,
    onSecondary = InkDeep,
    secondaryContainer = PanelHigh,
    onSecondaryContainer = TextPrimary,
    tertiary = StatusOk,
    onTertiary = InkDeep,
    background = Ink,
    onBackground = TextPrimary,
    surface = Panel,
    onSurface = TextPrimary,
    surfaceVariant = PanelRaised,
    onSurfaceVariant = TextMuted,
    outline = HairlineStrong,
    outlineVariant = Hairline,
    error = StatusDanger,
    onError = InkDeep,
    errorContainer = StatusDanger.copy(alpha = 0.16f),
    onErrorContainer = TextPrimary,
    inverseSurface = TextPrimary,
    inverseOnSurface = Ink,
    inversePrimary = Accent,
    scrim = Color.Black,
)

private val ConsoleTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 28.sp,
        lineHeight = 32.sp,
        letterSpacing = (-0.2).sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 26.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 17.sp,
        lineHeight = 22.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
        lineHeight = 20.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 13.sp,
        lineHeight = 19.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 12.sp,
        lineHeight = 17.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.1.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        letterSpacing = 0.2.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 10.sp,
        lineHeight = 14.sp,
        letterSpacing = 1.1.sp,
    ),
)

private val ConsoleShapes = Shapes(
    extraSmall = RoundedCornerShape(2.dp),
    small = RoundedCornerShape(4.dp),
    medium = RoundedCornerShape(8.dp),
    large = RoundedCornerShape(10.dp),
    extraLarge = RoundedCornerShape(10.dp),
)

@Composable
fun PhoneDeckTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ConsoleColors,
        typography = ConsoleTypography,
        shapes = ConsoleShapes,
        content = content,
    )
}
