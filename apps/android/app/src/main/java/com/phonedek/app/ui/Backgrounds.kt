package com.phonedek.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.phonedek.app.data.BackgroundDto
import com.phonedek.app.data.Pairing
import com.phonedek.app.net.assetUrl
import com.phonedek.app.util.Diag
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

    data class Video(
        val url: String,
        val token: String,
        val fit: ContentScale,
        val loop: Boolean,
        val muted: Boolean,
        val autoplay: Boolean,
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
    val overlay = (background.overlay ?: 0f).coerceIn(0f, 0.95f)

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
                    assetUrl(it.host, it.port, asset, it.token)
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

        "video" -> {
            val current = pairing
            val url = current?.let {
                background.asset?.takeIf(String::isNotBlank)?.let { asset ->
                    assetUrl(it.host, it.port, asset, it.token)
                }
            }
            if (url == null) {
                BackgroundSpec.Solid(fallback, overlay)
            } else {
                BackgroundSpec.Video(
                    url = url,
                    token = current?.token.orEmpty(),
                    fit = if (background.fit == "contain") ContentScale.Fit else ContentScale.Crop,
                    loop = background.loop,
                    muted = background.muted,
                    autoplay = background.autoplay,
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
fun BackgroundLayer(
    spec: BackgroundSpec,
    modifier: Modifier = Modifier,
    isActive: Boolean = true,
) {
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

            is BackgroundSpec.Video -> {
                Box(Modifier.fillMaxSize().background(spec.fallback))
                VideoSurface(
                    url = spec.url,
                    fit = spec.fit,
                    loop = spec.loop,
                    muted = spec.muted,
                    autoplay = spec.autoplay,
                    isActive = isActive,
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

/**
 * Small Media3 surface shared by video backgrounds and video button icons.
 * The caller keeps its solid/emoji fallback behind this view and provides
 * [onError], which fires after the player has been paused and hidden.
 */
@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun VideoSurface(
    url: String,
    fit: ContentScale,
    loop: Boolean,
    muted: Boolean,
    autoplay: Boolean,
    isActive: Boolean,
    modifier: Modifier = Modifier,
    onError: () -> Unit = {},
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var failed by remember(url) { mutableStateOf(false) }
    val currentOnError by rememberUpdatedState(onError)
    val currentActive by rememberUpdatedState(isActive)
    val currentFailed by rememberUpdatedState(failed)
    val exoPlayer = remember(url) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            repeatMode = if (loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
            volume = if (muted) 0f else 1f
            playWhenReady = autoplay && isActive
        }
    }

    LaunchedEffect(exoPlayer) {
        exoPlayer.prepare()
    }

    DisposableEffect(exoPlayer, lifecycleOwner) {
        val listener = object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                val message = error.message?.let(Diag::redactUrl) ?: "no message"
                Diag.w("Video playback failed (${error.errorCodeName}): $message")
                failed = true
                exoPlayer.pause()
                currentOnError()
            }
        }
        val lifecycleObserver = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> exoPlayer.pause()
                Lifecycle.Event.ON_START -> {
                    if (currentActive && autoplay && !currentFailed) exoPlayer.play()
                }
                else -> Unit
            }
        }
        exoPlayer.addListener(listener)
        lifecycleOwner.lifecycle.addObserver(lifecycleObserver)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(lifecycleObserver)
            exoPlayer.removeListener(listener)
            exoPlayer.release()
        }
    }

    LaunchedEffect(exoPlayer, isActive, autoplay, loop, muted, failed) {
        exoPlayer.repeatMode = if (loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
        exoPlayer.volume = if (muted) 0f else 1f
        if (failed || !isActive || !autoplay) {
            exoPlayer.pause()
        } else {
            exoPlayer.play()
        }
    }

    if (!failed) {
        AndroidView(
            modifier = modifier,
            factory = { viewContext ->
                PlayerView(viewContext).apply {
                    useController = false
                    isClickable = false
                    isFocusable = false
                    importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO
                    resizeMode = resizeModeFor(fit)
                    setShutterBackgroundColor(android.graphics.Color.TRANSPARENT)
                    player = exoPlayer
                }
            },
            update = { view ->
                view.player = exoPlayer
                view.resizeMode = resizeModeFor(fit)
            },
        )
    }
}

@androidx.annotation.OptIn(UnstableApi::class)
private fun resizeModeFor(fit: ContentScale): Int =
    if (fit == ContentScale.Fit) {
        AspectRatioFrameLayout.RESIZE_MODE_FIT
    } else {
        AspectRatioFrameLayout.RESIZE_MODE_ZOOM
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
