package com.phonedek.app.data

/** Copy shown by the What's New dialog for one app version. */
data class WhatsNewEntry(
    val title: String,
    val highlights: List<String>,
)

/**
 * Curated highlights keyed by release version. Add a new entry at the top for
 * each release; versions without a key fall back to [GENERIC_WHATS_NEW].
 */
private val WHATS_NEW: Map<String, WhatsNewEntry> = mapOf(
    "0.19.0" to WhatsNewEntry(
        title = "Quick Settings tile",
        highlights = listOf(
            "Pick one deck button or rig in Settings → Quick Settings and press it from the Android Quick Settings panel.",
            "The tile uses the cached deck and saved pairing; locked phones ask to unlock first.",
            "Pairing, missing-button, rate-limit and offline errors are shown directly.",
        ),
    ),
    "0.18.0" to WhatsNewEntry(
        title = "Mouse macros and global capture",
        highlights = listOf(
            "Macros can record clicks, double-clicks, drags, wheel and optional mouse movement.",
            "Global capture records keyboard and mouse in other apps; stop with Ctrl/Cmd+Alt+F10.",
            "Focused recording remains the fallback; PhoneDeck-focused input is ignored.",
        ),
    ),
    "0.17.0" to WhatsNewEntry(
        title = "Export for older desktops",
        highlights = listOf(
            "Settings → Backup can export a JSON deck with rigs, automation rules and rig buttons removed.",
            "The rest of the deck is unchanged, so an older PhoneDeck can import it safely.",
        ),
    ),
    "0.16.2" to WhatsNewEntry(
        title = "Streamer.bot and copy fixes",
        highlights = listOf(
            "Adding a Streamer.bot action no longer leaves the deck unsaved; choose its action before pressing.",
            "Fixed singular wording in automation delete confirmations.",
        ),
    ),
    "0.16.1" to WhatsNewEntry(
        title = "Streamer.bot and copy fixes",
        highlights = listOf(
            "Adding a Streamer.bot action no longer leaves the deck unsaved; choose its action before pressing.",
            "Fixed singular wording in automation delete confirmations.",
        ),
    ),
    "0.16.0" to WhatsNewEntry(
        title = "Automation rules",
        highlights = listOf(
            "Rules run on the PC when OBS, Twitch, a process or a phone changes state.",
            "Switch profiles/pages or run a rig from an automation rule.",
            "Automation stays off until you arm it on the PC; run history shows what fired.",
        ),
    ),
    "0.15.0" to WhatsNewEntry(
        title = "Rigs: guarded action sequences",
        highlights = listOf(
            "Build reusable rigs from OBS, Twitch, lights, audio, app volume, Streamer.bot and shortcut steps.",
            "Check OBS/Twitch/mic/light/app guards before a run; one tap runs the sequence.",
            "See live progress and the last-run result on the deck.",
        ),
    ),
    "0.14.0" to WhatsNewEntry(
        title = "Streamer.bot actions",
        highlights = listOf(
            "Buttons can trigger any action in your local Streamer.bot.",
            "Configure the WebSocket host and password in desktop Settings → Integrations.",
            "Pass arguments from the button and test the action from the editor.",
        ),
    ),
    "0.13.2" to WhatsNewEntry(
        title = "Live keyboard",
        highlights = listOf(
            "The phone keyboard now types live: each key sends its own down and up events.",
            "Hold Shift, Ctrl, Alt or Tab; tap a modifier to latch it for the next key.",
            "One keyboard only: the full QWERTY panel replaces the phone IME.",
            "Paste your phone clipboard on the PC; Backspace and arrows repeat while held.",
            "Scroll controls render as wheels, and horizontal scroll follows left/right drags.",
        ),
    ),
    // 0.13.1 is a patch after 0.13.0; include the headline feature plus the fix.
    "0.13.1" to WhatsNewEntry(
        title = "Auto-profile return",
        highlights = listOf(
            "Desktop profile actions can now return to the profile you were using.",
            "Windows keyboard helper now builds on older C# toolchains.",
            "Stability improvements across the deck.",
        ),
    ),
    "0.13.0" to WhatsNewEntry(
        title = "Auto-profile return",
        highlights = listOf(
            "Desktop profile actions can now return to the profile you were using.",
            "Automatic returns wait for the action to finish before switching back.",
        ),
    ),
    "0.12.0" to WhatsNewEntry(
        title = "Modifier scroll and Ctrl zoom",
        highlights = listOf(
            "Hold a modifier while scrolling on the trackpad.",
            "Hold Ctrl and scroll to zoom.",
            "Horizontal scrolling is supported on modifier-aware controls.",
        ),
    ),
    "0.11.0" to WhatsNewEntry(
        title = "Hue and Nanoleaf lights",
        highlights = listOf(
            "Hue and Nanoleaf light controls are available on the deck.",
            "Lights report their current state back to the control grid.",
        ),
    ),
    "0.10.0" to WhatsNewEntry(
        title = "Full-screen mixer and trackpad inertia",
        highlights = listOf(
            "Open the full-screen per-app mixer from a mixer control.",
            "Trackpad scrolling now keeps its momentum.",
        ),
    ),
    "0.9.0" to WhatsNewEntry(
        title = "Per-app volume and settings categories",
        highlights = listOf(
            "Set the volume of individual desktop apps.",
            "Settings are grouped into server, behavior, diagnostics, backup and about.",
        ),
    ),
)

private val GENERIC_WHATS_NEW = WhatsNewEntry(
    title = "Fixes and improvements",
    highlights = listOf(
        "Bug fixes and stability improvements.",
        "Small refinements across the deck and settings.",
    ),
)

internal fun normalizeVersion(version: String): String =
    version.trim().removePrefix("v").removePrefix("V")

/**
 * True only when the app already has prior use and the running version differs
 * from the stored one. A genuine first install (no stored version, no prior
 * use) must not open the dialog. A user upgrading from a build that predates
 * the stored key counts as prior use, so the first update still gets a prompt.
 */
fun shouldShowWhatsNew(
    lastSeenVersion: String?,
    currentVersion: String,
    hasPriorUse: Boolean = false,
): Boolean {
    val seen = lastSeenVersion?.trim().orEmpty()
    if (seen.isEmpty()) return hasPriorUse
    return normalizeVersion(seen) != normalizeVersion(currentVersion)
}

/** Curated entry for [version], or the generic "Fixes and improvements" copy. */
fun whatsNewFor(version: String): WhatsNewEntry =
    WHATS_NEW[normalizeVersion(version)] ?: GENERIC_WHATS_NEW
