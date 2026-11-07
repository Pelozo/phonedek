package com.phonedek.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phonedek.app.data.DeckButton
import com.phonedek.app.data.DeckPage
import com.phonedek.app.data.DeckProfile
import com.phonedek.app.data.Pairing
import com.phonedek.app.data.ProfileTheme
import com.phonedek.app.net.ConnectionStatus
import kotlinx.coroutines.flow.distinctUntilChanged

private val TopBarHeight = 54.dp

/**
 * Height reserved for the floating chrome when the top bar is hidden. The
 * settings gear and the compact page indicator live in this strip so they
 * never cover deck buttons, yet it is much smaller than the full top bar.
 */
private val HiddenChromeHeight = 40.dp

@Composable
fun DeckScreen(state: UiState, viewModel: MainViewModel) {
    var showSettings by rememberSaveable { mutableStateOf(false) }

    val config = state.config
    val profile = config?.profiles?.firstOrNull { it.id == state.activeProfileId }
        ?: config?.profiles?.firstOrNull { it.id == config.defaultProfileId }
        ?: config?.profiles?.firstOrNull()
    val pages = profile?.pages.orEmpty()
    val page = pages.getOrNull(resolvePageIndex(pages, state.activePageId, profile?.defaultPageId))

    val theme = profile?.theme ?: ProfileTheme()
    val pageBackground = page?.background ?: theme.background
    val background = remember(pageBackground, state.pairing) {
        backgroundSpec(pageBackground, state.pairing, Navy950)
    }

    // The bar is chrome for an unpaired/connecting deck; once the connection is
    // healthy it can get out of the way (default). Reconnecting brings it back.
    val hideTopBar = state.hideTopBarWhenConnected &&
        state.connection == ConnectionStatus.CONNECTED
    val topInset by animateDpAsState(
        targetValue = if (hideTopBar) HiddenChromeHeight else TopBarHeight,
        label = "deck-top-inset",
    )

    Box(Modifier.fillMaxSize()) {
        if (profile != null && pages.isNotEmpty()) {
            // Each page paints its own full-bleed background *under* the bar,
            // so the backdrop slides with the pager instead of going stale.
            DeckPager(
                profile = profile,
                activePageId = state.activePageId,
                pairing = state.pairing,
                topInset = topInset,
                onPageSettled = { pageId -> viewModel.onPageSelected(profile.id, pageId) },
                onPress = viewModel::onButtonPressed,
            )
        } else {
            BackgroundLayer(background, Modifier.fillMaxSize())
            DeckEmptyState(
                state = state,
                topInset = topInset,
                onOpenSettings = { showSettings = true },
            )
        }

        AnimatedVisibility(
            visible = !hideTopBar,
            modifier = Modifier.align(Alignment.TopCenter),
            enter = fadeIn() + slideInVertically { -it },
            exit = fadeOut() + slideOutVertically { -it },
        ) {
            DeckTopBar(
                state = state,
                profile = profile,
                page = page,
                onOpenSettings = { showSettings = true },
            )
        }

        AnimatedVisibility(
            visible = hideTopBar,
            modifier = Modifier.align(Alignment.TopCenter),
            enter = fadeIn(),
            exit = fadeOut(),
        ) {
            HiddenChrome(
                status = state.connection,
                pages = pages,
                activePageId = page?.id,
                onOpenSettings = { showSettings = true },
            )
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
            onHideTopBarWhenConnected = viewModel::setHideTopBarWhenConnected,
        )
    }
}

/**
 * Compact chrome for the hidden-bar mode: page dots stay available in the
 * centre and a small gear (with the live connection dot) opens Settings.
 * The container itself is not clickable, so swipes pass through to the pager.
 */
@Composable
private fun HiddenChrome(
    status: ConnectionStatus,
    pages: List<DeckPage>,
    activePageId: String?,
    onOpenSettings: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxWidth()
            .windowInsetsPadding(
                WindowInsets.safeDrawing.only(
                    WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
                ),
            )
            .height(HiddenChromeHeight),
    ) {
        PageIndicator(
            pages = pages,
            activePageId = activePageId,
            modifier = Modifier
                .align(Alignment.Center)
                .clip(RoundedCornerShape(50))
                .background(Color.Black.copy(alpha = 0.22f))
                .padding(horizontal = 10.dp, vertical = 6.dp),
        )

        FloatingSettingsButton(
            status = status,
            onOpenSettings = onOpenSettings,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .padding(end = 8.dp),
        )
    }
}

@Composable
private fun FloatingSettingsButton(
    status: ConnectionStatus,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val (label, color) = statusLabelAndColor(status)

    Box(
        modifier = modifier
            .size(32.dp)
            .clip(CircleShape)
            .background(Navy900.copy(alpha = 0.55f))
            .border(1.dp, Color.White.copy(alpha = 0.12f), CircleShape)
            .clickable(role = Role.Button, onClick = onOpenSettings)
            .semantics {
                contentDescription = "Open settings. Connection: $label."
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "⚙\uFE0E",
            fontSize = 16.sp,
            color = Slate300,
        )
        Box(
            Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 3.dp, bottom = 3.dp)
                .size(8.dp)
                .clip(CircleShape)
                .background(color),
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
    // Only a soft scrim: the page background remains visible and keeps moving
    // under the bar during a swipe, so the chrome never shows a stale colour.
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    listOf(
                        Color.Black.copy(alpha = 0.55f),
                        Color.Black.copy(alpha = 0.08f),
                    ),
                ),
            )
            .windowInsetsPadding(
                WindowInsets.safeDrawing.only(
                    WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
                ),
            ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(TopBarHeight)
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
    val (label, color) = statusLabelAndColor(status)

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

private fun statusLabelAndColor(status: ConnectionStatus): Pair<String, Color> = when (status) {
    ConnectionStatus.CONNECTED -> "Connected" to Emerald400
    ConnectionStatus.CONNECTING -> "Connecting" to Amber400
    ConnectionStatus.RECONNECTING -> "Reconnecting" to Amber400
    ConnectionStatus.OFFLINE -> "Offline" to Red400
}

/**
 * Swipeable deck pages. The pager state is recreated whenever the profile or
 * the set of page ids changes, which keeps deletions/profile switches on a
 * valid page without racing the state->pager sync. Stable page ids keep the
 * state alive for ordinary next/prev/goto navigation.
 */
@Composable
private fun DeckPager(
    profile: DeckProfile,
    activePageId: String?,
    pairing: Pairing?,
    topInset: Dp,
    onPageSettled: (String) -> Unit,
    onPress: (DeckButton) -> Unit,
) {
    val pages = profile.pages
    val pageIds = pages.map { it.id }

    key(profile.id, pageIds) {
        val pagerState = rememberPagerState(
            initialPage = resolvePageIndex(pages, activePageId, profile.defaultPageId),
            pageCount = { pages.size },
        )

        // True from the moment the user starts dragging until the page
        // settles. Programmatic scrolls never touch this, so a canceled
        // animation cannot write an intermediate page back into app state.
        var userScroll by remember { mutableStateOf(false) }
        // Page index the pager is currently animating toward because app state
        // changed (button action / server navigate). While set, only a settle
        // on the state's target is accepted.
        var programmaticTarget by remember { mutableStateOf<Int?>(null) }

        val latestPages by rememberUpdatedState(pages)
        val latestActivePageId by rememberUpdatedState(activePageId)

        LaunchedEffect(pagerState) {
            pagerState.interactionSource.interactions.collect { interaction ->
                when (interaction) {
                    is DragInteraction.Start -> {
                        userScroll = true
                        programmaticTarget = null // user takes over the animation
                    }

                    is DragInteraction.Cancel -> userScroll = false
                    is DragInteraction.Stop -> Unit // fling still settling
                }
            }
        }

        // Reconcile pager settles with app state. A user drag always wins;
        // a programmatic animation may only settle on the page state already
        // selected; any other settle (accessibility/semantics scroll) is
        // applied normally.
        LaunchedEffect(pagerState) {
            snapshotFlow { pagerState.settledPage }
                .distinctUntilChanged()
                .collect { index ->
                    val settled = latestPages.getOrNull(index) ?: return@collect
                    val statePageId = latestActivePageId
                    if (userScroll) {
                        userScroll = false
                        programmaticTarget = null
                        onPageSettled(settled.id)
                    } else if (programmaticTarget != null) {
                        if (statePageId == null || settled.id == statePageId) {
                            programmaticTarget = null
                            onPageSettled(settled.id)
                        }
                    } else {
                        onPageSettled(settled.id)
                    }
                }
        }

        // State changed from a button action or a server navigate message:
        // animate the pager instead of silently swapping the page.
        LaunchedEffect(activePageId, pageIds) {
            userScroll = false
            val target = resolvePageIndex(pages, activePageId, profile.defaultPageId)
            if (target == pagerState.currentPage) {
                programmaticTarget = null
            } else {
                programmaticTarget = target
                pagerState.animateScrollToPage(target)
            }
        }

        HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxSize(),
            beyondViewportPageCount = 1,
            // A single-page deck must not swallow horizontal drags.
            userScrollEnabled = pages.size > 1,
            key = { index -> pages.getOrNull(index)?.id ?: index },
        ) { index ->
            val current = pages.getOrNull(index) ?: return@HorizontalPager
            DeckPageContent(
                profile = profile,
                page = current,
                pairing = pairing,
                topInset = topInset,
                onPress = onPress,
            )
        }
    }
}

@Composable
private fun DeckPageContent(
    profile: DeckProfile,
    page: DeckPage,
    pairing: Pairing?,
    topInset: Dp,
    onPress: (DeckButton) -> Unit,
) {
    val spec = remember(page.background, profile.theme.background, pairing) {
        backgroundSpec(page.background ?: profile.theme.background, pairing, Navy950)
    }

    Box(Modifier.fillMaxSize()) {
        // Full-bleed: this backdrop sits behind the transparent top bar too.
        BackgroundLayer(spec, Modifier.fillMaxSize())
        DeckGrid(
            profile = profile,
            page = page,
            pairing = pairing,
            topInset = topInset,
            onPress = onPress,
        )
    }
}

@Composable
private fun DeckGrid(
    profile: DeckProfile,
    page: DeckPage,
    pairing: Pairing?,
    topInset: Dp,
    onPress: (DeckButton) -> Unit,
) {
    val grid = profile.grid
    val bySlot = remember(page.buttons) { page.buttons.associateBy { it.slot } }

    Column(
        modifier = Modifier
            .fillMaxSize()
            // Safe-area handling stays here so the background above can bleed
            // to the screen edges while buttons avoid notches and the chrome.
            .safeDrawingPadding()
            .padding(top = topInset)
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
private fun DeckEmptyState(
    state: UiState,
    topInset: Dp,
    onOpenSettings: () -> Unit,
) {
    val waiting = state.connection == ConnectionStatus.CONNECTING ||
        state.connection == ConnectionStatus.RECONNECTING

    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .padding(top = topInset)
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
