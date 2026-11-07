package com.phonedek.app

import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.os.Bundle
import android.view.OrientationEventListener
import android.view.Surface
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.phonedek.app.data.DEFAULT_HTTP_PORT
import com.phonedek.app.ui.LocalButtonContentRotation
import com.phonedek.app.ui.MainViewModel
import com.phonedek.app.ui.PhoneDeckApp
import com.phonedek.app.ui.buttonContentRotation
import com.phonedek.app.util.Diag

class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels()

    // Physical device orientation in degrees (0/90/180/270), independent of the
    // landscape-locked activity configuration.
    private var physicalOrientation by mutableIntStateOf(
        OrientationEventListener.ORIENTATION_UNKNOWN,
    )
    private var lastOrientationBucket = Int.MIN_VALUE
    private var lastBrightnessOverride: Float? = null
    private val orientationListener by lazy {
        object : OrientationEventListener(this) {
            override fun onOrientationChanged(orientation: Int) {
                if (orientation == OrientationEventListener.ORIENTATION_UNKNOWN) {
                    physicalOrientation = OrientationEventListener.ORIENTATION_UNKNOWN
                    lastOrientationBucket = Int.MIN_VALUE
                    return
                }
                val bucket = ((orientation + 45) / 90) % 4
                if (bucket != lastOrientationBucket) {
                    lastOrientationBucket = bucket
                    physicalOrientation = bucket * 90
                }
            }
        }
    }

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
            val view = LocalView.current
            val displayRotation = view.display?.rotation ?: Surface.ROTATION_0
            // Onboarding and pairing stay responsive to portrait. The deck is
            // landscape-locked only once a phone has been paired.
            val lockDeckLandscape = state.lockLandscape && state.pairing != null
            val contentRotation = if (state.ready) {
                buttonContentRotation(
                    physicalOrientation = physicalOrientation,
                    displayRotation = displayRotation,
                    lockLandscape = lockDeckLandscape,
                    enabled = state.rotateContentInPortrait,
                )
            } else {
                0f
            }
            LaunchedEffect(lockDeckLandscape) {
                this@MainActivity.requestedOrientation = if (lockDeckLandscape) {
                    ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                } else {
                    ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                }
                Diag.i("Orientation lock landscape=$lockDeckLandscape paired=${state.pairing != null}")
            }
            LaunchedEffect(state.phoneBrightness) {
                applyPhoneBrightness(state.phoneBrightness)
            }
            CompositionLocalProvider(
                LocalButtonContentRotation provides contentRotation,
            ) {
                PhoneDeckApp(viewModel = viewModel, state = state)
            }
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

    override fun onResume() {
        super.onResume()
        if (orientationListener.canDetectOrientation()) {
            orientationListener.enable()
        } else {
            physicalOrientation = OrientationEventListener.ORIENTATION_UNKNOWN
            lastOrientationBucket = Int.MIN_VALUE
        }
    }

    override fun onPause() {
        orientationListener.disable()
        super.onPause()
    }

    override fun onStart() {
        super.onStart()
        Diag.i("Activity start")
        applyWindowBrightness(lastBrightnessOverride)
        viewModel.onForeground()
    }

    override fun onStop() {
        Diag.i("Activity stop")
        applyWindowBrightness(null)
        viewModel.onBackground()
        super.onStop()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun applyPhoneBrightness(level: Float?) {
        val normalized = level
            ?.takeIf { it.isFinite() }
            ?.coerceIn(0f, 1f)
        lastBrightnessOverride = normalized
        applyWindowBrightness(normalized)
    }

    private fun applyWindowBrightness(level: Float?) {
        try {
            // Mutate the existing attributes so FLAG_KEEP_SCREEN_ON and other
            // window flags are preserved.
            val attributes = window.attributes
            attributes.screenBrightness = level
                ?.takeIf { it.isFinite() }
                ?.coerceIn(0f, 1f)
                ?: WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
            window.attributes = attributes
        } catch (error: WindowManager.BadTokenException) {
            Diag.w("Could not apply phone brightness (bad window token): ${error.message}")
        } catch (error: IllegalStateException) {
            Diag.w("Could not apply phone brightness (window state): ${error.message}")
        } catch (error: Exception) {
            Diag.w("Could not apply phone brightness: ${error.message}")
        }
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
