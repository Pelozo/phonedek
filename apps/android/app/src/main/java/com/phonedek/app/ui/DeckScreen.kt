package com.phonedek.app.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phonedek.app.data.DeckPage
import com.phonedek.app.data.DeckProfile
import com.phonedek.app.data.ProfileTheme
import com.phonedek.app.net.ConnectionStatus

@Composable
fun DeckScreen(state: UiState, viewModel: MainViewModel) {
    var showSettings by rememberSaveable { mutableStateOf(false) }

    val config = state.config
    val profile = config?.profiles?.firstOrNull { it.id == state.activeProfileId }
        ?: config?.profiles?.firstOrNull { it.id == config.defaultProfileId }
        ?: config?.profiles?.firstOrNull()
    val page = profile?.pages?.firstOrNull { it.id == state.activePageId }
        ?: profile?.pages?.firstOrNull { it.id == profile.defaultPageId }
        ?: profile?.pages?.firstOrNull()

    val theme = profile?.theme ?: ProfileTheme()
    val pageBackground = page?.background ?: theme.background
    val background = remember(pageBackground, state.pairing) {
        backgroundSpec(pageBackground, state.pairing, Navy950)
    }

    Box(Modifier.fillMaxSize()) {
        BackgroundLayer(background, Modifier.fillMaxSize())

        Column(
            Modifier
                .fillMaxSize()
                .safeDrawingPadding(),
        ) {
            DeckTopBar(
                state = state,
                profile = profile,
                page = page,
                onOpenSettings = { showSettings = true },
            )

            Box(Modifier.fillMaxWidth().weight(1f)) {
                if (profile != null && page != null) {
                    DeckGrid(
                        profile = profile,
                        page = page,
                        pairing = state.pairing,
                        onPress = viewModel::onButtonPressed,
                    )
                } else {
                    DeckEmptyState(
                        state = state,
                        onOpenSettings = { showSettings = true },
                    )
                }
            }
        }
    }

    if (showSettings) {
        SettingsSheet(
            state = state,
            onDismiss = { showSettings = false },
            onReconnect = {
                showSettings = false
                viewModel.reconnect()
            },
            onChangeServer = {
                showSettings = false
                viewModel.forgetServer()
            },
            onKeepScreenOn = viewModel::setKeepScreenOn,
        )
    }
}

@Composable
private fun DeckTopBar(
    state: UiState,
    profile: DeckProfile?,
    page: DeckPage?,
    onOpenSettings: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(54.dp)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = state.pairing?.serverName ?: state.config?.serverName ?: "PhoneDeck",
                color = Color(0xFFE2E8F0),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = page?.name ?: profile?.name ?: "No deck",
                color = Slate500,
                fontSize = 10.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        PageIndicator(
            pages = profile?.pages.orEmpty(),
            activePageId = page?.id,
            modifier = Modifier.padding(horizontal = 8.dp),
        )

        StatusPill(
            status = state.connection,
            onOpenSettings = onOpenSettings,
        )

        Spacer(Modifier.width(4.dp))

        Box(
            modifier = Modifier
                .size(38.dp)
                .clip(CircleShape)
                .clickable(role = Role.Button, onClick = onOpenSettings)
                .semantics { contentDescription = "Open settings" },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "⚙\uFE0E",
                fontSize = 18.sp,
                color = Slate300,
            )
        }
    }
}

@Composable
private fun PageIndicator(
    pages: List<DeckPage>,
    activePageId: String?,
    modifier: Modifier = Modifier,
) {
    if (pages.size <= 1) return
    val activeIndex = pages.indexOfFirst { it.id == activePageId }.coerceAtLeast(0)

    Row(
        modifier = modifier.semantics {
            contentDescription = "Page ${activeIndex + 1} of ${pages.size}: ${pages[activeIndex].name}"
        },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (pages.size <= 8) {
            pages.forEachIndexed { index, _ ->
                Box(
                    Modifier
                        .height(5.dp)
                        .width(if (index == activeIndex) 15.dp else 5.dp)
                        .clip(CircleShape)
                        .background(
                            if (index == activeIndex) Emerald400
                            else Color.White.copy(alpha = 0.22f),
                        ),
                )
            }
        } else {
            Text(
                text = "${activeIndex + 1}/${pages.size}",
                color = Slate500,
                fontSize = 10.sp,
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun StatusPill(
    status: ConnectionStatus,
    onOpenSettings: () -> Unit,
) {
    val (label, color) = when (status) {
        ConnectionStatus.CONNECTED -> "Connected" to Emerald400
        ConnectionStatus.CONNECTING -> "Connecting" to Amber400
        ConnectionStatus.RECONNECTING -> "Reconnecting" to Amber400
        ConnectionStatus.OFFLINE -> "Offline" to Red400
    }

    val shape = RoundedCornerShape(50)
    Row(
        modifier = Modifier
            .clip(shape)
            .background(color.copy(alpha = 0.12f))
            .border(1.dp, color.copy(alpha = 0.35f), shape)
            .combinedClickable(
                role = Role.Button,
                onClickLabel = "Open settings",
                onLongClickLabel = "Open settings",
                onLongClick = onOpenSettings,
                onClick = onOpenSettings,
            )
            .semantics { contentDescription = "Connection status: $label. Open settings." }
            .padding(horizontal = 9.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(6.dp)
                .clip(CircleShape)
                .background(color),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = label,
            color = color,
            fontSize = 10.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
}

@Composable
private fun DeckGrid(
    profile: DeckProfile,
    page: DeckPage,
    pairing: com.phonedek.app.data.Pairing?,
    onPress: (com.phonedek.app.data.DeckButton) -> Unit,
) {
    val grid = profile.grid
    val bySlot = remember(page.buttons) { page.buttons.associateBy { it.slot } }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(grid.padding.dp),
        verticalArrangement = Arrangement.spacedBy(grid.gap.dp),
    ) {
        repeat(grid.rows) { row ->
            Row(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(grid.gap.dp),
            ) {
                repeat(grid.columns) { column ->
                    val slot = row * grid.columns + column
                    val button = bySlot[slot]
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight(),
                    ) {
                        if (button != null) {
                            DeckButtonView(
                                button = button,
                                page = page,
                                theme = profile.theme,
                                pairing = pairing,
                                onPress = { onPress(button) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DeckEmptyState(state: UiState, onOpenSettings: () -> Unit) {
    val waiting = state.connection == ConnectionStatus.CONNECTING ||
        state.connection == ConnectionStatus.RECONNECTING

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (waiting) {
            CircularProgressIndicator(
                color = Emerald400,
                strokeWidth = 2.dp,
                modifier = Modifier.size(30.dp),
            )
            Spacer(Modifier.height(20.dp))
        } else {
            Text("📡", fontSize = 42.sp)
            Spacer(Modifier.height(14.dp))
        }

        Text(
            text = if (waiting) "Waiting for your PC…" else "No deck loaded",
            color = Color(0xFFE2E8F0),
            fontSize = 18.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = if (waiting) {
                "The first config will appear as soon as the connection is ready."
            } else {
                "Open PhoneDeck on your PC, check that both devices are on the same Wi-Fi, then try again."
            },
            color = Slate500,
            fontSize = 13.sp,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        if (!waiting) {
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = onOpenSettings,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Emerald400,
                    contentColor = Color(0xFF03130D),
                ),
            ) {
                Text("Open settings")
            }
        }
    }
}
