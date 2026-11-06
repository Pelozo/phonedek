package com.phonedek.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Composable
fun DeckMark(
    modifier: Modifier = Modifier,
    size: Dp = 56.dp,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.28f))
            .background(Brush.linearGradient(listOf(Emerald400, Color(0xFF059669))))
            .border(1.dp, Color.White.copy(alpha = 0.16f), RoundedCornerShape(size * 0.28f)),
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val side = this.size.minDimension
            val padding = side * 0.22f
            val gap = side * 0.09f
            val cell = (side - padding * 2 - gap) / 2f
            val radius = CornerRadius(cell * 0.24f)
            val dark = Color(0xFF042416)

            drawRoundRect(
                color = dark,
                topLeft = Offset(padding, padding),
                size = Size(cell, cell),
                cornerRadius = radius,
            )
            drawRoundRect(
                color = dark,
                topLeft = Offset(padding + cell + gap, padding),
                size = Size(cell, cell),
                cornerRadius = radius,
            )
            drawRoundRect(
                color = dark,
                topLeft = Offset(padding, padding + cell + gap),
                size = Size(cell, cell),
                cornerRadius = radius,
            )
            drawRoundRect(
                color = Color(0xFFA7F3D0),
                topLeft = Offset(padding + cell + gap, padding + cell + gap),
                size = Size(cell, cell),
                cornerRadius = radius,
            )
        }
    }
}
