package com.phonedek.app

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.phonedek.app.data.DEFAULT_HTTP_PORT
import com.phonedek.app.ui.MainViewModel
import com.phonedek.app.ui.PhoneDeckApp
import com.phonedek.app.util.Diag

class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemBars()

        setContent {
            val state by viewModel.state.collectAsStateWithLifecycle()
            PhoneDeckApp(viewModel = viewModel, state = state)
        }

        Diag.i("MainActivity created; deep-link=${intent.data != null}")
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        Diag.i("New intent received; deep-link=${intent.data != null}")
        handleIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        Diag.i("Activity start")
        viewModel.onForeground()
    }

    override fun onStop() {
        Diag.i("Activity stop")
        viewModel.onBackground()
        super.onStop()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        val data = intent.data ?: return
        if (data.scheme != "phonedek" || data.host != "pair") return

        val host = data.getQueryParameter("host")?.trim().orEmpty()
        val token = data.getQueryParameter("token")?.trim().orEmpty()
        val port = data.getQueryParameter("port")?.toIntOrNull() ?: DEFAULT_HTTP_PORT
        val name = data.getQueryParameter("name")
        val version = data.getQueryParameter("v")

        Diag.i(
            "Pairing link: scheme=${data.scheme} uriHost=${data.host} hostParam=\"$host\" " +
                "port=$port token=${Diag.maskToken(token)} name=\"${name ?: ""}\" v=${version ?: "?"}",
        )

        // Consume the link so an activity recreation cannot trigger pairing again.
        intent.data = null

        if (version != null && version != "1") {
            viewModel.reportMessage(
                "This pairing link uses protocol v$version, which this app does not support.",
            )
            return
        }
        if (host.isBlank()) {
            Diag.w("Pairing link has a blank host parameter")
            viewModel.reportMessage("The pairing link is missing the server address.")
            return
        }
        viewModel.handleDeepLink(host, port, token, name)
    }
}
