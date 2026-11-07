package com.phonedek.app.ui

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Monospace used for telemetry, labels, counts and IDs on the console. */
val ConsoleMono = FontFamily.Monospace

/** Numbered section header ending in a hairline rule. */
@Composable
fun ConsoleSectionLabel(
    index: String,
    label: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = index,
            color = TextFaint,
            fontFamily = ConsoleMono,
            fontSize = 10.sp,
            letterSpacing = 1.sp,
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = label,
            color = TextMuted,
            fontFamily = ConsoleMono,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.1.sp,
        )
        Spacer(Modifier.width(10.dp))
        Box(
            Modifier
                .weight(1f)
                .height(1.dp)
                .background(Hairline),
        )
    }
}

/** Panel/modal title with the 3x18dp signal rule to its left. */
@Composable
fun ConsoleTitleRule(
    title: String,
    modifier: Modifier = Modifier,
    color: Color = Accent,
) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .width(3.dp)
                .height(18.dp)
                .background(color),
        )
        Spacer(Modifier.width(10.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            color = TextPrimary,
        )
    }
}

/** Status LED. Always pair it with a text label. */
@Composable
fun ConsoleLed(
    color: Color,
    modifier: Modifier = Modifier,
    size: Dp = 6.dp,
) {
    Box(
        Modifier
            .size(size)
            .then(modifier)
            .background(color, CircleShape),
    )
}

private val SwitchTrackShape = RoundedCornerShape(4.dp)
private val SwitchThumbShape = RoundedCornerShape(2.dp)

/**
 * Squared console toggle: 40x22dp track, 14dp thumb, 48dp touch target.
 * The visual stays compact while the whole 48dp square is toggleable.
 */
@Composable
fun ConsoleSwitch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    contentDescription: String? = null,
) {
    val thumbOffset by animateDpAsState(
        targetValue = if (checked) 20.dp else 0.dp,
        animationSpec = tween(durationMillis = 110),
        label = "console-switch-thumb",
    )

    Box(
        modifier = modifier
            .size(48.dp)
            .toggleable(
                value = checked,
                enabled = enabled,
                role = Role.Switch,
                onValueChange = onCheckedChange,
            )
            .semantics {
                stateDescription = if (checked) "On" else "Off"
                if (contentDescription != null) {
                    this.contentDescription = contentDescription
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .size(width = 40.dp, height = 22.dp)
                .background(
                    color = if (checked) AccentWash else PanelRaised,
                    shape = SwitchTrackShape,
                )
                .border(
                    width = 1.dp,
                    color = if (checked) Accent else HairlineStrong,
                    shape = SwitchTrackShape,
                ),
        ) {
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .padding(start = 3.dp)
                    .offset(x = thumbOffset)
                    .size(14.dp)
                    .background(
                        color = if (checked) Accent else TextMuted,
                        shape = SwitchThumbShape,
                    ),
            )
        }
    }
}
