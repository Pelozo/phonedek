package com.phonedek.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.phonedek.app.data.BackgroundDto
import com.phonedek.app.data.Pairing
import com.phonedek.app.net.assetUrl
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

sealed interface BackgroundSpec {
    val overlay: Float

    data class Solid(
        val color: Color,
        override val overlay: Float,
    ) : BackgroundSpec

    data class Gradient(
        val from: Color,
        val to: Color,
        val angle: Float,
        override val overlay: Float,
    ) : BackgroundSpec

    data class Image(
        val url: String,
        val token: String,
        val fit: ContentScale,
        val fallback: Color,
        override val overlay: Float,
    ) : BackgroundSpec
}

fun parseHexColor(value: String?, fallback: Color): Color {
    val hex = value?.trim()?.removePrefix("#") ?: return fallback
    val expanded = when (hex.length) {
        3 -> hex.map { "$it$it" }.joinToString("")
        6, 8 -> hex
        else -> return fallback
    }
    val parsed = expanded.toLongOrNull(16) ?: return fallback
    return when (expanded.length) {
        6 -> Color(
            red = ((parsed shr 16) and 0xFF).toInt(),
            green = ((parsed shr 8) and 0xFF).toInt(),
            blue = (parsed and 0xFF).toInt(),
        )

        8 -> Color(
            red = ((parsed shr 24) and 0xFF).toInt(),
            green = ((parsed shr 16) and 0xFF).toInt(),
            blue = ((parsed shr 8) and 0xFF).toInt(),
            alpha = (parsed and 0xFF).toInt(),
        )

        else -> fallback
    }
}

fun backgroundSpec(
    background: BackgroundDto?,
    pairing: Pairing?,
    fallback: Color,
): BackgroundSpec {
    if (background == null) return BackgroundSpec.Solid(fallback, 0f)
    val overlay = (background.overlay ?: 0f).coerceIn(0f, 1f)

    return when (background.type) {
        "gradient" -> BackgroundSpec.Gradient(
            from = parseHexColor(background.from, fallback),
            to = parseHexColor(background.to, fallback),
            angle = (background.angle ?: 135f).coerceIn(0f, 360f),
            overlay = overlay,
        )

        "image" -> {
            val url = pairing?.let {
                background.asset?.takeIf(String::isNotBlank)?.let { asset ->
                    assetUrl(it.host, it.port, asset)
                }
            }
            if (url == null) {
                BackgroundSpec.Solid(fallback, overlay)
            } else {
                BackgroundSpec.Image(
                    url = url,
                    token = pairing?.token.orEmpty(),
                    fit = if (background.fit == "contain") ContentScale.Fit else ContentScale.Crop,
                    fallback = fallback,
                    overlay = overlay,
                )
            }
        }

        else -> BackgroundSpec.Solid(
            color = parseHexColor(background.color, fallback),
            overlay = overlay,
        )
    }
}

@Composable
fun BackgroundLayer(spec: BackgroundSpec, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Box(modifier) {
        when (spec) {
            is BackgroundSpec.Solid -> {
                Box(Modifier.fillMaxSize().background(spec.color))
            }

            is BackgroundSpec.Gradient -> {
                Box(
                    Modifier
                        .fillMaxSize()
                        .drawBehind { drawDeckGradient(spec) },
                )
            }

            is BackgroundSpec.Image -> {
                Box(Modifier.fillMaxSize().background(spec.fallback))
                val request = remember(spec.url, spec.token) {
                    ImageRequest.Builder(context)
                        .data(spec.url)
                        .apply {
                            if (spec.token.isNotBlank()) {
                                addHeader("Authorization", "Bearer ${spec.token}")
                            }
                        }
                        .crossfade(180)
                        .build()
                }
                AsyncImage(
                    model = request,
                    contentDescription = null,
                    contentScale = spec.fit,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }

        if (spec.overlay > 0f) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = spec.overlay)),
            )
        }
    }
}

private fun DrawScope.drawDeckGradient(spec: BackgroundSpec.Gradient) {
    val radians = Math.toRadians(spec.angle.toDouble())
    val dx = sin(radians).toFloat()
    val dy = -cos(radians).toFloat()
    val length = abs(size.width * dx) + abs(size.height * dy)
    val center = Offset(size.width / 2f, size.height / 2f)
    val start = Offset(center.x - dx * length / 2f, center.y - dy * length / 2f)
    val end = Offset(center.x + dx * length / 2f, center.y + dy * length / 2f)
    drawRect(Brush.linearGradient(listOf(spec.from, spec.to), start, end))
}
