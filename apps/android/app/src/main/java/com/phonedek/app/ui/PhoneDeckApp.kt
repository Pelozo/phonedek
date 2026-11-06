package com.phonedek.app.ui

import androidx.compose.foundation.background
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun PhoneDeckApp(viewModel: MainViewModel, state: UiState) {
    val snackbarHostState = remember { SnackbarHostState() }

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
        Box(Modifier.fillMaxSize().background(Navy950)) {
            KeepScreenOn(state.ready && state.pairing != null && state.keepScreenOn)

            when {
                !state.ready -> SplashScreen()
                state.pairing == null -> PairingScreen(
                    state = state,
                    onConnect = viewModel::connect,
                    onClearError = viewModel::clearPairingError,
                )

                else -> DeckScreen(state, viewModel)
            }

            SnackbarHost(
                hostState = snackbarHostState,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
            ) { data ->
                Snackbar(
                    snackbarData = data,
                    containerColor = Navy700,
                    contentColor = Color(0xFFE2E8F0),
                    shape = RoundedCornerShape(12.dp),
                    actionContentColor = Emerald400,
                    dismissActionContentColor = Slate300,
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
            .background(Brush.verticalGradient(listOf(Navy900, Navy950))),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            DeckMark(size = 68.dp)
            Spacer(Modifier.height(16.dp))
            Text(
                text = "PhoneDeck",
                color = Color(0xFFF8FAFC),
                fontSize = 23.sp,
            )
            Spacer(Modifier.height(18.dp))
            CircularProgressIndicator(
                color = Emerald400,
                strokeWidth = 2.dp,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}
