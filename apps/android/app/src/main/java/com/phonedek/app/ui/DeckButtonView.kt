package com.phonedek.app.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.phonedek.app.data.DeckButton
import com.phonedek.app.data.MediaIconDto
import com.phonedek.app.data.Pairing
import com.phonedek.app.data.ProfileTheme
import com.phonedek.app.net.assetUrl

// Deck fills are user content. Keep the historical default so existing decks
// render exactly as before even though the surrounding chrome is now ink/orange.
private val LegacyDeckFallback = Color(0xFF1E293B)

@Composable
fun DeckButtonView(
    button: DeckButton,
    theme: ProfileTheme,
    pairing: Pairing?,
    onPress: () -> Unit,
    onControlInput: (
        controlId: String,
        phase: String,
        delta: Float?,
        value: Float?,
    ) -> Unit = { _, _, _, _ -> },
    onControlInteracting: (Boolean) -> Unit = {},
    isActive: Boolean = true,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val haptics = LocalHapticFeedback.current
    val contentRotation = LocalButtonContentRotation.current

    val media = button.iconMedia
    val mediaUrl = remember(media?.asset, pairing?.host, pairing?.port, pairing?.token) {
        media?.asset?.takeIf { it.isNotBlank() }?.let { asset ->
            pairing?.let { assetUrl(it.host, it.port, asset, it.token) }
        }
    }
    var mediaFailed by remember(media?.type, media?.asset, mediaUrl, pairing?.token) {
        mutableStateOf(false)
    }

    val background = button.background ?: theme.buttonBackground
    val fallback = parseHexColor(
        when (theme.buttonBackground?.type) {
            "color" -> theme.buttonBackground.color
            else -> null
        },
        LegacyDeckFallback,
    )
    val spec = remember(background, pairing, fallback) {
        backgroundSpec(background, pairing, fallback)
    }
    val textColor = parseHexColor(button.textColor ?: theme.textColor, Color.White)
    val shape = RoundedCornerShape(theme.buttonRadius.dp)
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.945f else 1f,
        animationSpec = spring(dampingRatio = 0.6f, stiffness = 800f),
        label = "deckButtonScale",
    )

    val description = listOfNotNull(button.icon, button.label, button.sublabel)
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .joinToString(", ")
        .ifBlank { "Button" }

    val control = button.control
    Box(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .clip(shape)
            .background(fallback)
            .border(1.dp, Color.White.copy(alpha = 0.07f), shape)
            // A control owns the whole tile gesture surface; its label remains
            // tappable for the optional tap action. Keeping clickable on the
            // parent would steal the slider/dial drag.
            .then(
                if (control == null) {
                    Modifier.clickable(
                        interactionSource = interaction,
                        indication = LocalIndication.current,
                        role = Role.Button,
                        onClickLabel = button.label.ifBlank { "Press button" },
                    ) {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        onPress()
                    }
                } else {
                    Modifier
                },
            )
            .semantics { contentDescription = description },
    ) {
        BackgroundLayer(spec, Modifier.fillMaxSize(), isActive = isActive)

        if (control?.kind == "trackpad") {
            TrackpadLauncher(
                label = button.label,
                sublabel = button.sublabel,
                textColor = textColor,
                contentRotation = contentRotation,
                interaction = interaction,
                onPress = onPress,
                modifier = Modifier.fillMaxSize(),
            )
        } else if (control != null) {
            DeckControlView(
                control = control,
                label = button.label,
                textColor = textColor,
                onInput = { phase, delta, value ->
                    onControlInput(button.id, phase, delta, value)
                },
                onInteractingChange = onControlInteracting,
                onTap = onPress,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            BoxWithConstraints(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 6.dp, vertical = 4.dp),
            ) {
            val density = LocalDensity.current
            val labelSize = with(density) {
                minOf(theme.fontSize.dp, maxHeight * 0.16f).toSp()
            }
            val iconExtent = minOf(maxHeight * 0.34f, 38.dp)
            val iconSize = with(density) { iconExtent.toSp() }
            val sublabelSize = labelSize * 0.8f
            val mediaFit = if (media?.fit == "contain") ContentScale.Fit else ContentScale.Crop

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer { rotationZ = contentRotation },
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (media != null && mediaUrl != null && !mediaFailed) {
                    ButtonMediaIcon(
                        media = media,
                        url = mediaUrl,
                        token = pairing?.token.orEmpty(),
                        fit = mediaFit,
                        isActive = isActive,
                        modifier = Modifier.size(iconExtent),
                        onError = { mediaFailed = true },
                    )
                    Spacer(Modifier.height(2.dp))
                } else {
                    button.icon?.takeIf { it.isNotBlank() }?.let { icon ->
                        Text(
                            text = icon,
                            color = textColor,
                            fontSize = iconSize,
                            lineHeight = iconSize,
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                        )
                        Spacer(Modifier.height(2.dp))
                    }
                }
                if (button.label.isNotBlank()) {
                    Text(
                        text = button.label,
                        color = textColor,
                        fontSize = labelSize,
                        lineHeight = labelSize * 1.08f,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                button.sublabel?.takeIf { it.isNotBlank() }?.let { sublabel ->
                    Spacer(Modifier.height(1.dp))
                    Text(
                        text = sublabel,
                        color = textColor.copy(alpha = 0.68f),
                        fontSize = sublabelSize,
                        lineHeight = sublabelSize * 1.1f,
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            }
        }

        if (pressed) {
            Box(Modifier.fillMaxSize().background(Color.White.copy(alpha = 0.06f)))
        }
    }
}

@Composable
private fun TrackpadLauncher(
    label: String,
    sublabel: String?,
    textColor: Color,
    contentRotation: Float,
    interaction: MutableInteractionSource,
    onPress: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = LocalHapticFeedback.current
    val title = label.trim().ifBlank { "TRACKPAD" }
    val caption = sublabel?.trim()?.takeIf { it.isNotEmpty() } ?: "TAP TO OPEN"
    BoxWithConstraints(modifier) {
        val glyph = minOf(maxHeight * 0.34f, 34.dp)
        Column(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer { rotationZ = contentRotation }
                .clickable(
                    interactionSource = interaction,
                    indication = LocalIndication.current,
                    role = Role.Button,
                    onClickLabel = "Open trackpad",
                ) {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onPress()
                },
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Canvas(Modifier.size(glyph)) {
                val inset = 2.dp.toPx()
                val width = size.width - inset * 2
                val height = size.height - inset * 2
                drawRoundRect(
                    color = textColor.copy(alpha = 0.5f),
                    topLeft = Offset(inset, inset),
                    size = Size(width, height),
                    cornerRadius = CornerRadius(height * 0.18f),
                    style = Stroke(width = 1.dp.toPx()),
                )
                drawLine(
                    color = textColor.copy(alpha = 0.35f),
                    start = Offset(inset + width * 0.2f, inset + height * 0.62f),
                    end = Offset(inset + width * 0.8f, inset + height * 0.62f),
                    strokeWidth = 1.dp.toPx(),
                )
                drawCircle(
                    color = Accent,
                    radius = 2.dp.toPx(),
                    center = Offset(inset + width * 0.5f, inset + height * 0.38f),
                )
            }
            Spacer(Modifier.height(3.dp))
            Text(
                text = title,
                color = textColor,
                fontSize = 10.sp,
                lineHeight = 12.sp,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = caption.uppercase(),
                color = textColor.copy(alpha = 0.6f),
                fontFamily = ConsoleMono,
                fontSize = 7.sp,
                lineHeight = 9.sp,
                letterSpacing = 1.sp,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun ButtonMediaIcon(
    media: MediaIconDto,
    url: String,
    token: String,
    fit: ContentScale,
    isActive: Boolean,
    modifier: Modifier = Modifier,
    onError: () -> Unit,
) {
    val context = LocalContext.current
    if (media.type == "video") {
        VideoSurface(
            url = url,
            fit = fit,
            loop = media.loop,
            muted = media.muted,
            autoplay = true,
            isActive = isActive,
            useTextureView = true,
            modifier = modifier,
            onError = onError,
        )
    } else {
        val request = remember(url, token) {
            ImageRequest.Builder(context)
                .data(url)
                .apply {
                    if (token.isNotBlank()) {
                        addHeader("Authorization", "Bearer $token")
                    }
                }
                .crossfade(120)
                .build()
        }
        AsyncImage(
            model = request,
            contentDescription = null,
            contentScale = fit,
            modifier = modifier,
            onError = { onError() },
        )
    }
}
