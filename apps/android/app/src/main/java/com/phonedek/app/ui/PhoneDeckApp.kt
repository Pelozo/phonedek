package com.phonedek.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun PhoneDeckApp(viewModel: MainViewModel, state: UiState) {
    val snackbarHostState = remember { SnackbarHostState() }
    var showOnboardingGuide by rememberSaveable { mutableStateOf(false) }

    BackHandler(enabled = showOnboardingGuide) {
        showOnboardingGuide = false
    }

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is UiEvent.Message -> snackbarHostState.showSnackbar(
                    message = event.text,
                    duration = SnackbarDuration.Short,
                )
            }
        }
    }

    PhoneDeckTheme {
        Box(Modifier.fillMaxSize().background(Ink)) {
            KeepScreenOn(state.ready && state.pairing != null && state.keepScreenOn)

            when {
                !state.ready -> SplashScreen()

                !state.onboardingSeen -> OnboardingScreen(
                    isReopen = state.pairing != null,
                    onStartPairing = viewModel::completeOnboarding,
                    onSkip = viewModel::completeOnboarding,
                    onClose = viewModel::completeOnboarding,
                )

                state.pairing == null -> PairingScreen(
                    state = state,
                    onConnect = viewModel::connect,
                    onClearError = viewModel::clearPairingError,
                    onShowSetupGuide = { showOnboardingGuide = true },
                )

                else -> DeckScreen(
                    state = state,
                    viewModel = viewModel,
                    onShowSetupGuide = { showOnboardingGuide = true },
                )
            }

            if (showOnboardingGuide) {
                OnboardingScreen(
                    isReopen = true,
                    onStartPairing = {},
                    onSkip = {},
                    onClose = { showOnboardingGuide = false },
                    modifier = Modifier.fillMaxSize(),
                )
            }

            SnackbarHost(
                hostState = snackbarHostState,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
            ) { data ->
                val shape = RoundedCornerShape(4.dp)
                Snackbar(
                    snackbarData = data,
                    modifier = Modifier.border(1.dp, Hairline, shape),
                    shape = shape,
                    containerColor = PanelRaised,
                    contentColor = TextSecondary,
                    actionContentColor = Accent,
                    dismissActionContentColor = TextMuted,
                )
            }
        }
    }
}

@Composable
private fun KeepScreenOn(enabled: Boolean) {
    val view = LocalView.current
    DisposableEffect(enabled) {
        view.keepScreenOn = enabled
        onDispose { view.keepScreenOn = false }
    }
}

@Composable
private fun SplashScreen() {
    Box(
        Modifier
            .fillMaxSize()
            .background(Ink),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            DeckMark(size = 64.dp)
            Spacer(Modifier.height(16.dp))
            Text(
                text = "PhoneDeck",
                color = TextPrimary,
                fontSize = 24.sp,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "WIRELESS DECK CONSOLE",
                color = TextMuted,
                fontFamily = ConsoleMono,
                fontSize = 9.sp,
                letterSpacing = 1.6.sp,
            )
            Spacer(Modifier.height(22.dp))
            CircularProgressIndicator(
                color = Accent,
                strokeWidth = 2.dp,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}
