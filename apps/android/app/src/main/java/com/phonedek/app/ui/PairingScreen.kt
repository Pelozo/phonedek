package com.phonedek.app.ui

import android.os.SystemClock
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleStartEffect
import com.phonedek.app.net.DiscoveredServer
import com.phonedek.app.net.DiscoveryClient
import kotlinx.coroutines.delay

@Composable
fun PairingScreen(
    state: UiState,
    onConnect: (host: String, port: Int, token: String, name: String?) -> Unit,
    onClearError: () -> Unit,
) {
    val context = LocalContext.current
    val keyboard = LocalSoftwareKeyboardController.current
    val scope = rememberCoroutineScope()

    var host by rememberSaveable { mutableStateOf("") }
    var port by rememberSaveable { mutableStateOf("47654") }
    var token by rememberSaveable { mutableStateOf("") }
    var showToken by rememberSaveable { mutableStateOf(false) }
    var selectedName by rememberSaveable { mutableStateOf<String?>(null) }
    var hostError by rememberSaveable { mutableStateOf<String?>(null) }
    var portError by rememberSaveable { mutableStateOf<String?>(null) }
    var tokenError by rememberSaveable { mutableStateOf<String?>(null) }
    var hint by rememberSaveable { mutableStateOf<String?>(null) }
    var discoveryError by rememberSaveable { mutableStateOf<String?>(null) }
    var appliedDraftNonce by rememberSaveable { mutableStateOf(0L) }

    val tokenFocus = remember { FocusRequester() }
    val servers = remember { mutableStateMapOf<String, DiscoveredServer>() }
    var discoveryRunning by remember { mutableStateOf(false) }
    val discovery = remember { DiscoveryClient(context) }

    LifecycleStartEffect(Unit) {
        discoveryRunning = true
        discovery.start(
            scope = scope,
            onServer = { server -> servers[server.key] = server },
            onError = { message -> discoveryError = message },
        )
        onStopOrDispose {
            discoveryRunning = false
            discovery.stop()
        }
    }

    LaunchedEffect(Unit) {
        while (true) {
            delay(3_000)
            val cutoff = SystemClock.elapsedRealtime() - 12_000
            val stale = servers.values.filter { it.lastSeen < cutoff }.map { it.key }
            stale.forEach { servers.remove(it) }
        }
    }

    val draft = state.pairingDraft
    LaunchedEffect(draft?.nonce) {
        if (draft != null && draft.nonce != appliedDraftNonce) {
            appliedDraftNonce = draft.nonce
            host = draft.host
            port = draft.port.toString()
            token = draft.token
            selectedName = draft.name
            if (draft.token.isBlank()) tokenFocus.requestFocus()
        }
    }

    val submit: () -> Unit = {
        val hostValue = host.trim()
        val portValue = port.toIntOrNull()
        val tokenValue = token.trim()
        val hostProblem = if (hostValue.isEmpty()) "Enter the host or IP address." else null
        val portProblem = if (portValue == null || portValue !in 1..65535) {
            "Use 1–65535."
        } else {
            null
        }
        val tokenProblem = if (tokenValue.isEmpty()) "Enter the pairing token." else null
        hostError = hostProblem
        portError = portProblem
        tokenError = tokenProblem
        if (hostProblem == null && portProblem == null && tokenProblem == null) {
            keyboard?.hide()
            onConnect(hostValue, portValue!!, tokenValue, selectedName)
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .drawBehind {
                drawRect(Brush.verticalGradient(listOf(Navy900, Navy950, Color(0xFF05080F))))
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(Emerald400.copy(alpha = 0.15f), Color.Transparent),
                        center = Offset(size.width * 0.86f, size.height * 0.02f),
                        radius = size.maxDimension * 0.62f,
                    ),
                    radius = size.maxDimension * 0.62f,
                    center = Offset(size.width * 0.86f, size.height * 0.02f),
                )
            },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .safeDrawingPadding()
                .padding(horizontal = 22.dp)
                .padding(top = 28.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            DeckMark(size = 62.dp)
            Spacer(Modifier.height(14.dp))
            Text(
                text = "PhoneDeck",
                style = androidx.compose.material3.MaterialTheme.typography.displaySmall,
                color = Color(0xFFF8FAFC),
            )
            Spacer(Modifier.height(5.dp))
            Text(
                text = "Your phone, as a wireless Stream Deck for your PC.",
                color = Slate500,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(26.dp))

            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val wide = maxWidth >= 720.dp
                if (wide) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(18.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        PairingPanel(Modifier.weight(1.05f)) {
                            PairingForm(
                                host = host,
                                port = port,
                                token = token,
                                showToken = showToken,
                                hostError = hostError,
                                portError = portError,
                                tokenError = tokenError,
                                hint = hint,
                                busy = state.pairingBusy,
                                serverError = state.pairingError,
                                tokenFocus = tokenFocus,
                                onHostChange = {
                                    host = it
                                    hostError = null
                                    hint = null
                                    onClearError()
                                },
                                onPortChange = {
                                    port = it.filter(Char::isDigit).take(5)
                                    portError = null
                                    onClearError()
                                },
                                onTokenChange = {
                                    token = it
                                    tokenError = null
                                    hint = null
                                    onClearError()
                                },
                                onToggleToken = { showToken = !showToken },
                                onSubmit = submit,
                            )
                        }
                        PairingPanel(Modifier.weight(0.95f)) {
                            DiscoveryPanel(
                                servers = servers.values.sortedBy { it.name.lowercase() },
                                running = discoveryRunning,
                                error = discoveryError,
                                onSelect = { server ->
                                    host = server.host
                                    port = server.port.toString()
                                    selectedName = server.name
                                    hostError = null
                                    portError = null
                                    if (token.isBlank()) {
                                        hint = "Enter the token shown in PhoneDeck on ${server.name}."
                                        tokenFocus.requestFocus()
                                    } else {
                                        keyboard?.hide()
                                        onConnect(server.host, server.port, token.trim(), server.name)
                                    }
                                },
                            )
                        }
                    }
                } else {
                    Column(Modifier.fillMaxWidth()) {
                        PairingPanel(Modifier.fillMaxWidth()) {
                            PairingForm(
                                host = host,
                                port = port,
                                token = token,
                                showToken = showToken,
                                hostError = hostError,
                                portError = portError,
                                tokenError = tokenError,
                                hint = hint,
                                busy = state.pairingBusy,
                                serverError = state.pairingError,
                                tokenFocus = tokenFocus,
                                onHostChange = {
                                    host = it
                                    hostError = null
                                    hint = null
                                    onClearError()
                                },
                                onPortChange = {
                                    port = it.filter(Char::isDigit).take(5)
                                    portError = null
                                    onClearError()
                                },
                                onTokenChange = {
                                    token = it
                                    tokenError = null
                                    hint = null
                                    onClearError()
                                },
                                onToggleToken = { showToken = !showToken },
                                onSubmit = submit,
                            )
                        }
                        Spacer(Modifier.height(16.dp))
                        PairingPanel(Modifier.fillMaxWidth()) {
                            DiscoveryPanel(
                                servers = servers.values.sortedBy { it.name.lowercase() },
                                running = discoveryRunning,
                                error = discoveryError,
                                onSelect = { server ->
                                    host = server.host
                                    port = server.port.toString()
                                    selectedName = server.name
                                    hostError = null
                                    portError = null
                                    if (token.isBlank()) {
                                        hint = "Enter the token shown in PhoneDeck on ${server.name}."
                                        tokenFocus.requestFocus()
                                    } else {
                                        keyboard?.hide()
                                        onConnect(server.host, server.port, token.trim(), server.name)
                                    }
                                },
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(20.dp))
            Text(
                text = "Tip: scan the QR code in PhoneDeck on your PC to pair instantly.",
                color = Slate500.copy(alpha = 0.8f),
                fontSize = 11.sp,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun PairingPanel(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(22.dp),
        color = Navy800.copy(alpha = 0.9f),
        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.07f)),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            content = content,
        )
    }
}

@Composable
private fun PairingForm(
    host: String,
    port: String,
    token: String,
    showToken: Boolean,
    hostError: String?,
    portError: String?,
    tokenError: String?,
    hint: String?,
    busy: Boolean,
    serverError: String?,
    tokenFocus: FocusRequester,
    onHostChange: (String) -> Unit,
    onPortChange: (String) -> Unit,
    onTokenChange: (String) -> Unit,
    onToggleToken: () -> Unit,
    onSubmit: () -> Unit,
) {
    Text(
        text = "Pair with your PC",
        color = Color(0xFFF1F5F9),
        fontSize = 18.sp,
        fontWeight = FontWeight.SemiBold,
    )
    Spacer(Modifier.height(3.dp))
    Text(
        text = "Use the details shown in PhoneDeck on your desktop.",
        color = Slate500,
        fontSize = 12.sp,
    )
    Spacer(Modifier.height(16.dp))

    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(
            value = host,
            onValueChange = onHostChange,
            modifier = Modifier.weight(1f),
            label = { Text("Host or IP") },
            placeholder = { Text("192.168.1.42") },
            singleLine = true,
            isError = hostError != null,
            shape = RoundedCornerShape(12.dp),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Uri,
                imeAction = ImeAction.Next,
            ),
        )
        OutlinedTextField(
            value = port,
            onValueChange = onPortChange,
            modifier = Modifier.width(114.dp),
            label = { Text("Port") },
            singleLine = true,
            isError = portError != null,
            shape = RoundedCornerShape(12.dp),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Number,
                imeAction = ImeAction.Next,
            ),
        )
    }
    if (hostError != null || portError != null) {
        Spacer(Modifier.height(4.dp))
        Text(
            text = hostError ?: portError.orEmpty(),
            color = Red400,
            fontSize = 11.sp,
        )
    }

    Spacer(Modifier.height(10.dp))
    OutlinedTextField(
        value = token,
        onValueChange = onTokenChange,
        modifier = Modifier
            .fillMaxWidth()
            .focusRequester(tokenFocus),
        label = { Text("Pairing token") },
        placeholder = { Text("Paste the token from your PC") },
        singleLine = true,
        isError = tokenError != null,
        shape = RoundedCornerShape(12.dp),
        visualTransformation = if (showToken) {
            VisualTransformation.None
        } else {
            PasswordVisualTransformation()
        },
        trailingIcon = {
            Text(
                text = if (showToken) "Hide" else "Show",
                color = Slate300,
                fontSize = 11.sp,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .clickable(onClick = onToggleToken)
                    .padding(horizontal = 8.dp, vertical = 6.dp)
                    .semantics {
                        contentDescription = if (showToken) "Hide token" else "Show token"
                    },
            )
        },
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Password,
            imeAction = ImeAction.Done,
        ),
        keyboardActions = KeyboardActions(onDone = { onSubmit() }),
    )
    if (tokenError != null) {
        Spacer(Modifier.height(4.dp))
        Text(tokenError, color = Red400, fontSize = 11.sp)
    }

    if (hint != null) {
        Spacer(Modifier.height(8.dp))
        Text(hint, color = Amber400, fontSize = 11.sp)
    }
    if (serverError != null) {
        Spacer(Modifier.height(8.dp))
        Text(
            text = "⚠  $serverError",
            color = Red400,
            fontSize = 12.sp,
            lineHeight = 16.sp,
        )
    }

    Spacer(Modifier.height(14.dp))
    Button(
        onClick = onSubmit,
        enabled = !busy,
        modifier = Modifier
            .fillMaxWidth()
            .height(50.dp),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = Emerald400,
            contentColor = Color(0xFF03130D),
            disabledContainerColor = Emerald400.copy(alpha = 0.35f),
            disabledContentColor = Color(0xFF03130D).copy(alpha = 0.7f),
        ),
    ) {
        if (busy) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                color = Color(0xFF03130D),
                strokeWidth = 2.dp,
            )
            Spacer(Modifier.width(9.dp))
            Text("Connecting…", fontWeight = FontWeight.SemiBold)
        } else {
            Text("Save & connect", fontWeight = FontWeight.SemiBold)
        }
    }
    Spacer(Modifier.height(9.dp))
    Text(
        text = "The token stays on your local network and is only sent to this PC.",
        color = Slate500.copy(alpha = 0.85f),
        fontSize = 10.sp,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun DiscoveryPanel(
    servers: List<DiscoveredServer>,
    running: Boolean,
    error: String?,
    onSelect: (DiscoveredServer) -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = "Nearby PCs",
            color = Color(0xFFF1F5F9),
            fontSize = 18.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f),
        )
        if (running) {
            Box(
                Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(Emerald400),
            )
        }
    }
    Spacer(Modifier.height(3.dp))
    Text(
        text = if (servers.isEmpty()) {
            "Searching your Wi-Fi network…"
        } else {
            "${servers.size} ${if (servers.size == 1) "PC" else "PCs"} found"
        },
        color = Slate500,
        fontSize = 12.sp,
    )
    Spacer(Modifier.height(14.dp))

    if (servers.isEmpty()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(Navy950.copy(alpha = 0.7f))
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                color = Emerald400,
                strokeWidth = 2.dp,
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = "Looking for the desktop app on this network…",
                color = Slate300,
                fontSize = 12.sp,
            )
        }
    } else {
        servers.forEach { server ->
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .clickable { onSelect(server) },
                shape = RoundedCornerShape(14.dp),
                color = Navy950,
                border = BorderStroke(1.dp, Color.White.copy(alpha = 0.07f)),
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(34.dp)
                            .clip(CircleShape)
                            .background(Emerald400.copy(alpha = 0.12f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("🖥️", fontSize = 16.sp)
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = server.name,
                            color = Color(0xFFE2E8F0),
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = "${server.host}:${server.port}",
                            color = Slate500,
                            fontSize = 11.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Text(
                        text = "Pair",
                        color = Emerald400,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }

    if (error != null) {
        Spacer(Modifier.height(6.dp))
        Text(
            text = error,
            color = Amber400,
            fontSize = 11.sp,
            lineHeight = 15.sp,
        )
    }

    Spacer(Modifier.height(10.dp))
    Text(
        text = "Can't find it? Check that both devices are on the same Wi-Fi and " +
            "that PhoneDeck is running on your PC.",
        color = Slate500.copy(alpha = 0.85f),
        fontSize = 10.sp,
        lineHeight = 14.sp,
    )
}
