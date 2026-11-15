/** Curated copy shown by the What's New dialog for one app version. */
export interface WhatsNewEntry {
  title: string
  highlights: string[]
}

/**
 * Curated highlights keyed by release version. Add a new entry at the top for
 * each release; versions without a key fall back to the generic copy below.
 * Keep highlights short: the dialog is a summary, not release notes.
 */
const WHATS_NEW: Readonly<Record<string, WhatsNewEntry>> = {
  '0.13.2': {
    title: 'Live keyboard and What\u2019s New',
    highlights: [
      'The phone keyboard now types live: keys go down and up as you press them.',
      'Hold Shift, Ctrl, Alt or Tab; tap a modifier to latch it for the next key.',
      'One keyboard only: the full QWERTY panel replaces the phone IME.',
      'Scroll controls render as wheels, and horizontal scroll follows left/right drags.',
      'PhoneDeck now shows this What\u2019s New summary after an update.',
    ],
  },
  // 0.13.1 is the Windows helper hotfix after 0.13.0; include the headline
  // feature it shipped alongside so an update from 0.12 still reads well.
  '0.13.1': {
    title: 'Auto-profile return and Windows helper hotfix',
    highlights: [
      'Desktop profile actions can return phones to the profile you were using.',
      'Fixed the Windows keyboard helper failing to start on PowerShell 5.1.',
      'Stability improvements across pointer, keyboard and scroll input.',
    ],
  },
  '0.13.0': {
    title: 'Auto-profile return',
    highlights: [
      'Return to your usual profile after a game closes.',
      'Waits for the game to stay closed briefly, so alt-tabbing does not switch back early.',
      'Switching to another configured game takes priority over returning.',
    ],
  },
  '0.12.0': {
    title: 'Modifier scroll and Ctrl zoom',
    highlights: [
      'Hold a modifier while scrolling on a trackpad control.',
      'Hold Ctrl and scroll to zoom in supported apps.',
      'Horizontal scrolling works on modifier-aware controls.',
    ],
  },
  '0.11.0': {
    title: 'Hue and Nanoleaf lights',
    highlights: [
      'Discover Hue bridges and pair them with the physical link button.',
      'Add Nanoleaf panels with a local API token.',
      'Light brightness, temperature and power report back to the deck.',
    ],
  },
  '0.10.0': {
    title: 'Full-screen mixer and trackpad inertia',
    highlights: [
      'Open a full-screen per-app mixer from a mixer control on the phone.',
      'Trackpad scrolling keeps a bounded tail after you lift your fingers.',
      'Mixer faders follow the desktop mix at 20 Hz while open.',
    ],
  },
  '0.9.0': {
    title: 'Per-app volume and settings categories',
    highlights: [
      'Control the volume and mute of individual desktop apps.',
      'Choose a running app from a session picker when adding a control.',
      'Settings are grouped into General, Input, Integrations, Phone and About.',
    ],
  },
}

const GENERIC_WHATS_NEW: WhatsNewEntry = {
  title: 'Fixes and improvements',
  highlights: [
    'Bug fixes and stability improvements.',
    'Small refinements across the deck and settings.',
  ],
}

/** Trim whitespace and an optional leading `v`/`V` from a version string. */
export function normalizeVersion(version: string): string {
  return version.trim().replace(/^[vV]/, '')
}

export type WhatsNewDecision = 'first-run' | 'show' | 'none'

/**
 * Decide what the renderer should do at startup.
 *
 * - `first-run`: no stored version yet. Record the running version silently;
 *   a first install should not interrupt the user with a changelog.
 * - `show`: the stored version differs from the running one (an upgrade).
 * - `none`: this version was already seen.
 *
 * A missing running version is treated as `none` so an odd build cannot wipe
 * the stored marker or open an empty dialog.
 */
export function whatsNewDecision(
  lastSeenVersion: string | null | undefined,
  currentVersion: string,
): WhatsNewDecision {
  const current = normalizeVersion(currentVersion)
  if (!current) return 'none'
  const seen = normalizeVersion(lastSeenVersion ?? '')
  if (!seen) return 'first-run'
  return seen === current ? 'none' : 'show'
}

/** Curated entry for [version], or the generic "Fixes and improvements" copy. */
export function whatsNewFor(version: string): WhatsNewEntry {
  return WHATS_NEW[normalizeVersion(version)] ?? GENERIC_WHATS_NEW
}
