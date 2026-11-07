package com.phonedek.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phonedek.app.data.DeckButton
import com.phonedek.app.data.DeckPage
import com.phonedek.app.data.DeckProfile
import com.phonedek.app.data.Pairing
import com.phonedek.app.data.ProfileTheme
import com.phonedek.app.data.pageGrid
import com.phonedek.app.net.ConnectionStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlin.math.abs

private val TopBarHeight = 56.dp
private val ControlShape = RoundedCornerShape(4.dp)

/**
 * Full-screen deck mode. The top bar, page ticks and Settings control are all
 * removed; a downward swipe from the top edge temporarily brings the bar back.
 */
@Composable
fun DeckScreen(
    state: UiState,
    viewModel: MainViewModel,
    onShowSetupGuide: () -> Unit = {},
) {
    var showSettings by rememberSaveable { mutableStateOf(false) }
    var settingsChangeServerOnOpen by rememberSaveable { mutableStateOf(false) }
    var showDiagnostics by rememberSaveable { mutableStateOf(false) }
    var chromeRevealed by rememberSaveable { mutableStateOf(false) }
    var controlInteracting by remember { mutableStateOf(false) }
    var bannerHeightPx by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current

    val config = state.config
    val profile = config?.profiles?.firstOrNull { it.id == state.activeProfileId }
        ?: config?.profiles?.firstOrNull { it.id == config.defaultProfileId }
        ?: config?.profiles?.firstOrNull()
    val pages = profile?.pages.orEmpty()
    val page = pages.getOrNull(resolvePageIndex(pages, state.activePageId, profile?.defaultPageId))

    val theme = profile?.theme ?: ProfileTheme()
    val pageBackground = page?.background ?: theme.background
    val background = remember(pageBackground, state.pairing) {
        backgroundSpec(pageBackground, state.pairing, InkDeep)
    }

    // The bar is chrome for an unpaired/connecting deck; once the connection is
    // healthy it can get out of the way (default). Reconnecting brings it back.
    val canHideChrome = state.hideTopBarWhenConnected &&
        state.connection == ConnectionStatus.CONNECTED
    val hideTopBar = canHideChrome && !chromeRevealed
    val hasDeck = profile != null && pages.isNotEmpty()
    val showConnectionBanner = hasDeck && (
        state.connection == ConnectionStatus.OFFLINE ||
            state.connection == ConnectionStatus.RECONNECTING
        )
    val chromeInset = if (hideTopBar) 0.dp else TopBarHeight
    val bannerHeight = with(density) { bannerHeightPx.toDp() }
    val topInset by animateDpAsState(
        targetValue = chromeInset + if (showConnectionBanner) bannerHeight else 0.dp,
        label = "deck-top-inset",
    )

    // Leaving the connected state restores the bar and forgets a temporary reveal.
    LaunchedEffect(canHideChrome) {
        if (!canHideChrome) chromeRevealed = false
    }

    // A disappeared control view cannot leave the pager locked.
    LaunchedEffect(page?.id) {
        controlInteracting = false
    }

    // A revealed bar is temporary: it recedes again after a few seconds, or
    // immediately if the user opens Settings (the sheet keeps the controls).
    LaunchedEffect(chromeRevealed, showSettings) {
        if (chromeRevealed && !showSettings) {
            delay(8_000)
            chromeRevealed = false
        }
    }

    val openSettings: () -> Unit = {
        settingsChangeServerOnOpen = false
        showSettings = true
    }
    val changeServer: () -> Unit = {
        settingsChangeServerOnOpen = true
        showSettings = true
    }

    Box(
        Modifier
            .fillMaxSize()
            .revealChromeOnTopEdgeSwipe(enabled = hideTopBar && !controlInteracting) {
                chromeRevealed = true
            }
            .then(
                if (hideTopBar) {
                    Modifier.semantics {
                        customActions = listOf(
                            CustomAccessibilityAction("Show top bar") {
                                chromeRevealed = true
                                true
                            },
                        )
                    }
                } else {
                    Modifier
                },
            ),
    ) {
        if (profile != null && pages.isNotEmpty()) {
            // Each page paints its own full-bleed background *under* the bar,
            // so the backdrop slides with the pager instead of going stale.
            DeckPager(
                profile = profile,
                activePageId = state.activePageId,
                pairing = state.pairing,
                topInset = topInset,
                controlInteracting = controlInteracting,
                onPageSettled = { pageId -> viewModel.onPageSelected(profile.id, pageId) },
                onPress = viewModel::onButtonPressed,
                onControlInput = viewModel::onControlInput,
                onControlInteracting = { controlInteracting = it },
            )
        } else {
            BackgroundLayer(background, Modifier.fillMaxSize())
            DeckEmptyState(
                state = state,
                topInset = topInset,
                onRetry = viewModel::reconnect,
                onOpenSettings = openSettings,
                onChangeServer = changeServer,
                onShowDiagnostics = { showDiagnostics = true },
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
                onOpenSettings = openSettings,
            )
        }

        AnimatedVisibility(
            visible = showConnectionBanner,
            modifier = Modifier.align(Alignment.TopCenter),
            enter = fadeIn(),
            exit = fadeOut(),
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .windowInsetsPadding(
                        WindowInsets.safeDrawing.only(
                            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
                        ),
                    )
                    .padding(top = chromeInset),
            ) {
                ConnectionBanner(
                    state = state,
                    onRetry = viewModel::reconnect,
                    onOpenSettings = openSettings,
                    onChangeServer = changeServer,
                    modifier = Modifier.onSizeChanged { bannerHeightPx = it.height },
                )
            }
        }
    }

    if (showSettings) {
        SettingsSheet(
            state = state,
            onDismiss = {
                showSettings = false
                settingsChangeServerOnOpen = false
            },
            onReconnect = {
                showSettings = false
                settingsChangeServerOnOpen = false
                viewModel.reconnect()
            },
            onChangeServer = {
                showSettings = false
                settingsChangeServerOnOpen = false
                viewModel.forgetServer()
            },
            onKeepScreenOn = viewModel::setKeepScreenOn,
            onHideTopBarWhenConnected = viewModel::setHideTopBarWhenConnected,
            onLockLandscape = viewModel::setLockLandscape,
            onRotateContentInPortrait = viewModel::setRotateContentInPortrait,
            onSaveBackup = viewModel::saveBackup,
            onShowSetupGuide = {
                showSettings = false
                settingsChangeServerOnOpen = false
                onShowSetupGuide()
            },
            confirmChangeOnOpen = settingsChangeServerOnOpen,
        )
    }

    if (showDiagnostics) {
        DiagnosticsDialog(onDismiss = { showDiagnostics = false })
    }
}

/**
 * Watches pointer events without consuming them, so deck taps and page swipes
 * keep working. A downward drag that starts near the top edge reveals hidden
 * chrome; the bar then recedes on its own.
 */
private fun Modifier.revealChromeOnTopEdgeSwipe(
    enabled: Boolean,
    onReveal: () -> Unit,
): Modifier {
    if (!enabled) return this
    return pointerInput(enabled) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            if (down.position.y > 64.dp.toPx()) return@awaitEachGesture
            var dx = 0f
            var dy = 0f
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                dx += change.positionChange().x
                dy += change.positionChange().y
                if (dy > 24.dp.toPx() && dy > abs(dx)) {
                    onReveal()
                    break
                }
                if (!change.pressed) break
            }
        }
    }
}

@Composable
private fun DeckTopBar(
    state: UiState,
    profile: DeckProfile?,
    page: DeckPage?,
    onOpenSettings: () -> Unit,
) {
    // A near-black scrim keeps the deck content readable while the page
    // background continues to move underneath during a swipe.
    val deckLabel = listOfNotNull(profile?.name, page?.name)
        .distinct()
        .joinToString(" / ")
        .ifBlank { "NO DECK" }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(InkDeep.copy(alpha = 0.82f))
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
                    color = TextPrimary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = deckLabel,
                    color = TextMuted,
                    fontFamily = ConsoleMono,
                    fontSize = 9.5.sp,
                    letterSpacing = 0.8.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            PageIndicator(
                pages = profile?.pages.orEmpty(),
                activePageId = page?.id,
                modifier = Modifier.padding(horizontal = 8.dp),
            )

            StatusReadout(
                status = state.connection,
                onOpenSettings = onOpenSettings,
            )

            Spacer(Modifier.width(6.dp))

            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(ControlShape)
                    .background(Panel.copy(alpha = 0.55f))
                    .border(1.dp, HairlineStrong, ControlShape)
                    .clickable(role = Role.Button, onClick = onOpenSettings)
                    .semantics { contentDescription = "Open settings" },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "⚙\uFE0E",
                    fontSize = 15.sp,
                    color = TextSecondary,
                )
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(Hairline),
        )
    }
}

@Composable
private fun ConnectionBanner(
    state: UiState,
    onRetry: () -> Unit,
    onOpenSettings: () -> Unit,
    onChangeServer: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val offline = state.connection == ConnectionStatus.OFFLINE
    val ledColor = if (offline) StatusDanger else StatusWarn
    val title = when (state.connection) {
        ConnectionStatus.OFFLINE -> "PC UNREACHABLE"
        ConnectionStatus.RECONNECTING -> "CONNECTION LOST"
        ConnectionStatus.CONNECTING -> "CONNECTING"
        ConnectionStatus.CONNECTED -> "CONNECTED"
    }
    val pairing = state.pairing
    val server = pairing?.let { "${it.serverName} · ${it.host}:${it.port}" }
    val reason = state.pairingError?.takeIf { it.isNotBlank() }?.let { "Last error · $it" }
        ?: when (state.connection) {
            ConnectionStatus.OFFLINE ->
                "The desktop app isn't responding. Retry or check the PC."
            ConnectionStatus.RECONNECTING ->
                "The connection dropped. PhoneDeck is retrying automatically."
            ConnectionStatus.CONNECTING ->
                "Waiting for the desktop app to accept the connection."
            ConnectionStatus.CONNECTED -> ""
        }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(Panel)
            .semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ConsoleLed(color = ledColor, size = 6.dp)
                Spacer(Modifier.width(8.dp))
                Text(
                    text = title,
                    color = TextPrimary,
                    fontFamily = ConsoleMono,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.sp,
                )
                if (server != null) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = server,
                        color = TextMuted,
                        fontFamily = ConsoleMono,
                        fontSize = 9.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = reason,
                color = TextSecondary,
                fontSize = 12.sp,
                lineHeight = 16.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ConnectionActionButton(
                    label = "Retry",
                    onClick = onRetry,
                    modifier = Modifier.weight(1f),
                    primary = true,
                )
                ConnectionActionButton(
                    label = "Settings",
                    onClick = onOpenSettings,
                    modifier = Modifier.weight(1f),
                )
                if (pairing != null) {
                    ConnectionActionButton(
                        label = "Change server",
                        onClick = onChangeServer,
                        modifier = Modifier.weight(1f),
                        danger = true,
                    )
                }
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(Hairline),
        )
    }
}

@Composable
private fun ConnectionActionButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    danger: Boolean = false,
) {
    val contentPadding = PaddingValues(horizontal = 8.dp)
    if (primary) {
        Button(
            onClick = onClick,
            modifier = modifier.height(48.dp),
            shape = ControlShape,
            contentPadding = contentPadding,
            colors = ButtonDefaults.buttonColors(
                containerColor = Accent,
                contentColor = AccentInk,
            ),
        ) {
            Text(
                text = label,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    } else {
        OutlinedButton(
            onClick = onClick,
            modifier = modifier.height(48.dp),
            shape = ControlShape,
            border = BorderStroke(
                1.dp,
                if (danger) StatusDanger.copy(alpha = 0.55f) else HairlineStrong,
            ),
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = if (danger) StatusDanger else TextSecondary,
            ),
            contentPadding = contentPadding,
        ) {
            Text(
                text = label,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
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
                        .width(12.dp)
                        .height(2.dp)
                        .background(if (index == activeIndex) Accent else HairlineStrong),
                )
            }
        } else {
            Text(
                text = "${activeIndex + 1}/${pages.size}",
                color = TextMuted,
                fontFamily = ConsoleMono,
                fontSize = 9.sp,
                letterSpacing = 0.8.sp,
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun StatusReadout(
    status: ConnectionStatus,
    onOpenSettings: () -> Unit,
) {
    val (label, color) = statusLabelAndColor(status)

    Row(
        modifier = Modifier
            .clip(ControlShape)
            .background(Panel.copy(alpha = 0.45f))
            .border(1.dp, Hairline, ControlShape)
            .combinedClickable(
                role = Role.Button,
                onClickLabel = "Open settings",
                onLongClickLabel = "Open settings",
                onLongClick = onOpenSettings,
                onClick = onOpenSettings,
            )
            .semantics {
                contentDescription = "Connection status: ${label.lowercase()}. Open settings."
            }
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ConsoleLed(color = color, size = 5.dp)
        Spacer(Modifier.width(6.dp))
        Text(
            text = label,
            color = TextSecondary,
            fontFamily = ConsoleMono,
            fontSize = 9.sp,
            letterSpacing = 0.8.sp,
            maxLines = 1,
        )
    }
}

private fun statusLabelAndColor(status: ConnectionStatus): Pair<String, Color> = when (status) {
    ConnectionStatus.CONNECTED -> "CONNECTED" to Accent
    ConnectionStatus.CONNECTING -> "CONNECTING" to StatusWarn
    ConnectionStatus.RECONNECTING -> "RECONNECTING" to StatusWarn
    ConnectionStatus.OFFLINE -> "OFFLINE" to StatusDanger
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
    controlInteracting: Boolean,
    onPageSettled: (String) -> Unit,
    onPress: (DeckButton) -> Unit,
    onControlInput: (controlId: String, phase: String, delta: Float) -> Unit,
    onControlInteracting: (Boolean) -> Unit,
) {
    val pages = profile.pages
    val pageIds = pages.map { it.id }

    key(profile.id, pageIds) {
        val pagerState = rememberPagerState(
            initialPage = resolvePageIndex(pages, activePageId, profile.defaultPageId),
            pageCount = { pages.size },
        )
        // Only the settled page may play video; adjacent preloaded pages pause.
        val settledPage = pagerState.settledPage

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
            // A single-page deck must not swallow horizontal drags, and a
            // control drag owns horizontal gestures until it ends.
            userScrollEnabled = pages.size > 1 && !controlInteracting,
            key = { index -> pages.getOrNull(index)?.id ?: index },
        ) { index ->
            val current = pages.getOrNull(index) ?: return@HorizontalPager
            DeckPageContent(
                profile = profile,
                page = current,
                pairing = pairing,
                topInset = topInset,
                isActive = index == settledPage,
                onPress = onPress,
                onControlInput = onControlInput,
                onControlInteracting = onControlInteracting,
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
    isActive: Boolean,
    onPress: (DeckButton) -> Unit,
    onControlInput: (controlId: String, phase: String, delta: Float) -> Unit,
    onControlInteracting: (Boolean) -> Unit,
) {
    val spec = remember(page.background, profile.theme.background, pairing) {
        backgroundSpec(page.background ?: profile.theme.background, pairing, InkDeep)
    }

    Box(Modifier.fillMaxSize()) {
        // Full-bleed: this backdrop sits behind the transparent top bar too.
        BackgroundLayer(spec, Modifier.fillMaxSize(), isActive = isActive)
        DeckGrid(
            profile = profile,
            page = page,
            pairing = pairing,
            topInset = topInset,
            isActive = isActive,
            onPress = onPress,
            onControlInput = onControlInput,
            onControlInteracting = onControlInteracting,
        )
    }
}

@Composable
private fun DeckGrid(
    profile: DeckProfile,
    page: DeckPage,
    pairing: Pairing?,
    topInset: Dp,
    isActive: Boolean,
    onPress: (DeckButton) -> Unit,
    onControlInput: (controlId: String, phase: String, delta: Float) -> Unit,
    onControlInteracting: (Boolean) -> Unit,
) {
    val grid = pageGrid(profile, page)
    val capacity = grid.columns * grid.rows
    val bySlot = remember(page.buttons, grid) {
        // Defensive: configs are normalized on parse, but never render or
        // crash on a slot that the page's effective grid cannot hold.
        page.buttons.filter { it.slot in 0 until capacity }.associateBy { it.slot }
    }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            // Safe-area handling stays here so the background above can bleed
            // to the screen edges while buttons avoid notches and the chrome.
            .safeDrawingPadding()
            .padding(top = topInset)
            .padding(grid.padding.dp),
    ) {
        val gap = grid.gap.dp
        val cellWidth = ((maxWidth - gap * (grid.columns - 1)) / grid.columns)
            .coerceAtLeast(0.dp)

        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(gap),
        ) {
            repeat(grid.rows) { row ->
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    var column = 0
                    while (column < grid.columns) {
                        val slot = row * grid.columns + column
                        val button = bySlot[slot]
                        if (button != null) {
                            val spanColumns = (button.span?.columns ?: 1)
                                .coerceIn(1, grid.columns - column)
                            val spanRows = button.span?.rows ?: 1
                            val tileWidth = cellWidth * spanColumns +
                                gap * (spanColumns - 1)
                            Box(
                                modifier = Modifier
                                    .width(tileWidth)
                                    .fillMaxHeight(),
                            ) {
                                DeckButtonView(
                                    button = button,
                                    theme = profile.theme,
                                    pairing = pairing,
                                    isActive = isActive,
                                    onPress = { onPress(button) },
                                    onControlInput = onControlInput,
                                    onControlInteracting = onControlInteracting,
                                )
                                if (spanRows > 1) {
                                    Text(
                                        text = "ROWS $spanRows → 1",
                                        color = Color.White.copy(alpha = 0.55f),
                                        fontFamily = ConsoleMono,
                                        fontSize = 7.sp,
                                        maxLines = 1,
                                        modifier = Modifier
                                            .align(Alignment.BottomEnd)
                                            .padding(4.dp)
                                            .background(
                                                Color.Black.copy(alpha = 0.45f),
                                                RoundedCornerShape(2.dp),
                                            )
                                            .padding(horizontal = 3.dp, vertical = 1.dp),
                                    )
                                }
                            }
                            if (column + spanColumns < grid.columns) {
                                Spacer(Modifier.width(gap))
                            }
                            column += spanColumns
                        } else {
                            Spacer(Modifier.width(cellWidth))
                            if (column + 1 < grid.columns) {
                                Spacer(Modifier.width(gap))
                            }
                            column += 1
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
    onRetry: () -> Unit,
    onOpenSettings: () -> Unit,
    onChangeServer: () -> Unit,
    onShowDiagnostics: () -> Unit,
) {
    val waiting = state.connection == ConnectionStatus.CONNECTING ||
        state.connection == ConnectionStatus.RECONNECTING
    val offline = state.connection == ConnectionStatus.OFFLINE
    val pairing = state.pairing
    val title = when {
        waiting -> "Connecting to your PC…"
        offline -> "PC unreachable"
        else -> "No deck loaded"
    }
    val eyebrow = when {
        waiting -> "LINK / CONNECTING"
        offline -> "LINK / OFFLINE"
        else -> "LINK / EMPTY DECK"
    }
    val serverLabel = pairing?.let { "${it.serverName} at ${it.host}:${it.port}" }
    val reason = state.pairingError?.takeIf { it.isNotBlank() } ?: when {
        waiting -> "Waiting for ${pairing?.serverName ?: "your PC"} to send the deck."
        offline -> "The phone can't reach ${serverLabel ?: "the desktop app"}."
        else -> "The PC is connected, but no deck pages were received."
    }
    val ledColor = when {
        waiting -> StatusWarn
        offline -> StatusDanger
        else -> Accent
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .padding(top = topInset)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 28.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(46.dp)
                .background(InkDeep, RoundedCornerShape(8.dp))
                .border(1.dp, HairlineStrong, RoundedCornerShape(8.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier
                    .size(10.dp)
                    .background(
                        color = ledColor,
                        shape = RoundedCornerShape(1.dp),
                    ),
            )
        }
        Spacer(Modifier.height(12.dp))
        Text(
            text = eyebrow,
            color = TextMuted,
            fontFamily = ConsoleMono,
            fontSize = 9.sp,
            letterSpacing = 1.4.sp,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = title,
            color = TextPrimary,
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = reason,
            color = TextMuted,
            fontSize = 13.sp,
            lineHeight = 18.sp,
            textAlign = TextAlign.Center,
        )
        if (waiting) {
            Spacer(Modifier.height(16.dp))
            CircularProgressIndicator(
                color = Accent,
                strokeWidth = 2.dp,
                modifier = Modifier.size(18.dp),
            )
        }
        if (state.connection != ConnectionStatus.CONNECTED) {
            Spacer(Modifier.height(22.dp))
            SetupChecklist()
        }
        Spacer(Modifier.height(22.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ConnectionActionButton(
                label = "Retry",
                onClick = onRetry,
                modifier = Modifier.weight(1f),
                primary = true,
            )
            ConnectionActionButton(
                label = "Open settings",
                onClick = onOpenSettings,
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (pairing != null) {
                ConnectionActionButton(
                    label = "Change server",
                    onClick = onChangeServer,
                    modifier = Modifier.weight(1f),
                    danger = true,
                )
            }
            ConnectionActionButton(
                label = "Diagnostics / logs",
                onClick = onShowDiagnostics,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun SetupChecklist() {
    Column(Modifier.fillMaxWidth()) {
        ConsoleSectionLabel(index = "00", label = "SETUP CHECKLIST")
        Spacer(Modifier.height(2.dp))
        SetupStep(
            index = "01",
            title = "Same Wi-Fi",
            body = "Phone and PC are on the same Wi-Fi network.",
        )
        Box(Modifier.fillMaxWidth().height(1.dp).background(Hairline))
        SetupStep(
            index = "02",
            title = "Server running",
            body = "PhoneDeck is open on the PC and the deck is loaded.",
        )
        Box(Modifier.fillMaxWidth().height(1.dp).background(Hairline))
        SetupStep(
            index = "03",
            title = "PIN current",
            body = "Use the 4-digit PIN shown on the PC; re-pair if it changed.",
        )
        Box(Modifier.fillMaxWidth().height(1.dp).background(Hairline))
        SetupStep(
            index = "04",
            title = "Firewall",
            body = "Allow PhoneDeck through the PC firewall on a private network.",
        )
    }
}

@Composable
private fun SetupStep(index: String, title: String, body: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = index,
            color = TextFaint,
            fontFamily = ConsoleMono,
            fontSize = 9.sp,
            letterSpacing = 0.8.sp,
            modifier = Modifier.width(22.dp),
        )
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                color = TextPrimary,
                fontSize = 12.5.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(1.dp))
            Text(
                text = body,
                color = TextMuted,
                fontSize = 11.sp,
                lineHeight = 15.sp,
            )
        }
    }
}
