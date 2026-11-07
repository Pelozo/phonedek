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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

private val MarkTile = Color(0xFF0B0A09)
private val WarmKey = Color(0xFFF1ECE2)

/** 2x2 key-grid mark: dark chassis tile, three warm-white keys, one signal key. */
@Composable
fun DeckMark(
    modifier: Modifier = Modifier,
    size: Dp = 56.dp,
) {
    val shape = RoundedCornerShape(10.dp)
    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(MarkTile)
            .border(1.dp, HairlineStrong, shape),
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val side = this.size.minDimension
            val padding = side * 0.20f
            val gap = side * 0.075f
            val cell = (side - padding * 2 - gap) / 2f
            val radius = CornerRadius(cell * 0.14f)

            fun key(column: Int, row: Int, color: Color) {
                drawRoundRect(
                    color = color,
                    topLeft = Offset(
                        padding + column * (cell + gap),
                        padding + row * (cell + gap),
                    ),
                    size = Size(cell, cell),
                    cornerRadius = radius,
                )
            }

            key(column = 0, row = 0, color = WarmKey)
            key(column = 1, row = 0, color = WarmKey)
            key(column = 0, row = 1, color = WarmKey)
            key(column = 1, row = 1, color = Accent)
        }
    }
}
