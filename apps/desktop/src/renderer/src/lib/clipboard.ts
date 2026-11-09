import type { CellSpan, DeckButton, DeckConfig, DeckPage, GridSettings } from '@phonedek/shared'
import {
  addButton,
  buttonSpan,
  canPlaceButton,
  getPage,
  getProfile,
  newId,
  pageGrid,
  removeButton,
} from '@phonedek/shared'

/**
 * Editor-local clipboard, copy/cut/paste and cross-page move helpers.
 *
 * Everything in this module is pure so the placement rules can be unit-tested
 * without a DOM. The React layer owns the clipboard itself and only calls
 * these functions with a snapshot of the current config.
 */

/** `span-reduced` means the preferred footprint had no room and 1×1 was used. */
export type PlacementFallback = 'none' | 'span-reduced'

export interface ButtonPlacement {
  slot: number
  span: CellSpan
  fallback: PlacementFallback
}

export type PasteButtonResult =
  | {
      ok: true
      config: DeckConfig
      button: DeckButton
      fallback: PlacementFallback
    }
  | { ok: false; error: string }

export type MoveButtonResult =
  | {
      ok: true
      config: DeckConfig
      button: DeckButton
      fallback: PlacementFallback
    }
  | { ok: false; error: string }

export type CutButtonResult =
  | { ok: true; config: DeckConfig; button: DeckButton }
  | { ok: false; error: string }

function normalizeSpan(span: CellSpan): CellSpan {
  return {
    columns: Math.max(1, Math.min(10, Math.round(span.columns))),
    rows: Math.max(1, Math.min(10, Math.round(span.rows))),
  }
}

function isEmptyConfig(config: DeckConfig | null | undefined): boolean {
  return !config || config.profiles.length === 0
}

function everyButton(config: DeckConfig): DeckButton[] {
  return config.profiles.flatMap((profile) => profile.pages.flatMap((page) => page.buttons))
}

/** A stable editor id that is not used anywhere in the config. */
export function freshButtonId(config: DeckConfig): string {
  const used = new Set(everyButton(config).map((button) => button.id))
  let id = newId('btn')
  while (used.has(id)) id = newId('btn')
  return id
}

/**
 * Deep-clone a button (actions, control, span, media icon/background, labels)
 * and give it a new id. The clone keeps the source slot until it is placed.
 */
export function cloneButtonForPaste(button: DeckButton, id: string = newId('btn')): DeckButton {
  return { ...structuredClone(button), id }
}

/**
 * Find where a footprint can go. The preferred slot wins when it is free,
 * otherwise the first free slot in row-major order is used.
 */
export function findFreeSlotForSpan(
  buttons: readonly DeckButton[],
  grid: GridSettings,
  span: CellSpan,
  preferredSlot?: number,
): number | null {
  const total = Math.max(1, Math.round(grid.columns) * Math.round(grid.rows))
  const wanted = normalizeSpan(span)
  if (
    preferredSlot !== undefined &&
    Number.isInteger(preferredSlot) &&
    preferredSlot >= 0 &&
    preferredSlot < total &&
    canPlaceButton(buttons, preferredSlot, wanted, grid)
  ) {
    return preferredSlot
  }
  for (let slot = 0; slot < total; slot += 1) {
    if (canPlaceButton(buttons, slot, wanted, grid)) return slot
  }
  return null
}

/**
 * Decide the slot and span for an incoming button.
 *
 * 1. Keep the source span at the same slot when it fits.
 * 2. Otherwise use the first free slot for the source span.
 * 3. Otherwise fall back to 1×1 (same slot first, then first free cell).
 *
 * Returns null when even a 1×1 button does not fit.
 */
export function placeButtonInPage(
  page: DeckPage,
  grid: GridSettings,
  button: DeckButton,
): ButtonPlacement | null {
  const preferred = buttonSpan(button)
  const direct = findFreeSlotForSpan(page.buttons, grid, preferred, button.slot)
  if (direct !== null) {
    return { slot: direct, span: preferred, fallback: 'none' }
  }

  if (preferred.columns !== 1 || preferred.rows !== 1) {
    const unit: CellSpan = { columns: 1, rows: 1 }
    const fallbackSlot = findFreeSlotForSpan(page.buttons, grid, unit, button.slot)
    if (fallbackSlot !== null) {
      return { slot: fallbackSlot, span: unit, fallback: 'span-reduced' }
    }
  }

  return null
}

function applyPlacement(button: DeckButton, placement: ButtonPlacement): DeckButton {
  const next: DeckButton = { ...structuredClone(button), slot: placement.slot }
  if (placement.span.columns === 1 && placement.span.rows === 1) {
    if (button.span) next.span = { columns: 1, rows: 1 }
    else delete next.span
  } else {
    next.span = { ...placement.span }
  }
  return next
}

function locateButton(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  buttonId: string,
): { page: DeckPage; button: DeckButton } | null {
  const profile = getProfile(config, profileId)
  const page = profile ? getPage(profile, pageId) : undefined
  const button = page?.buttons.find((item) => item.id === buttonId)
  return page && button ? { page, button } : null
}

/**
 * Copy a button onto a page with a fresh id. The preferred span is kept when
 * it fits; otherwise the button is pasted as 1×1 and `fallback` is
 * `span-reduced`. Existing buttons are never overwritten.
 */
export function pasteButtonIntoPage(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  button: DeckButton,
): PasteButtonResult {
  if (isEmptyConfig(config)) return { ok: false, error: 'No profiles are available' }
  const profile = getProfile(config, profileId)
  if (!profile) return { ok: false, error: 'Unknown profile' }
  const page = getPage(profile, pageId)
  if (!page) return { ok: false, error: 'Unknown page' }

  const placement = placeButtonInPage(page, pageGrid(profile, page), button)
  if (!placement) {
    return {
      ok: false,
      error: 'No free cell is left on this page. Resize the grid or remove a button first.',
    }
  }

  const pasted = applyPlacement(cloneButtonForPaste(button, freshButtonId(config)), placement)
  return {
    ok: true,
    config: addButton(config, profileId, pageId, pasted),
    button: pasted,
    fallback: placement.fallback,
  }
}

/** Remove a button and return a deep copy for the editor clipboard. */
export function cutButtonFromPage(
  config: DeckConfig,
  profileId: string,
  pageId: string,
  buttonId: string,
): CutButtonResult {
  const found = locateButton(config, profileId, pageId, buttonId)
  if (!found) return { ok: false, error: 'Unknown button' }
  return {
    ok: true,
    config: removeButton(config, profileId, pageId, buttonId),
    button: structuredClone(found.button),
  }
}

function idExistsOutsideSource(
  config: DeckConfig,
  id: string,
  sourceProfileId: string,
  sourcePageId: string,
): boolean {
  return config.profiles.some((profile) =>
    profile.pages.some((page) =>
      page.buttons.some(
        (button) =>
          button.id === id &&
          !(profile.id === sourceProfileId && page.id === sourcePageId),
      ),
    ),
  )
}

/**
 * Move a button to another page (optionally in another profile).
 *
 * The id is preserved when it is unique across the config; a fresh id is
 * generated only if the target config already uses it. Placement follows the
 * same same-slot → first-free → 1×1 fallback rules as paste. When nothing
 * fits, the original config is returned untouched with an error.
 */
export function moveButtonToPage(
  config: DeckConfig,
  sourceProfileId: string,
  sourcePageId: string,
  targetProfileId: string,
  targetPageId: string,
  buttonId: string,
): MoveButtonResult {
  if (isEmptyConfig(config)) return { ok: false, error: 'No profiles are available' }
  if (sourceProfileId === targetProfileId && sourcePageId === targetPageId) {
    return { ok: false, error: 'Choose a different page to move this component to.' }
  }

  const found = locateButton(config, sourceProfileId, sourcePageId, buttonId)
  if (!found) return { ok: false, error: 'Unknown button' }

  const targetProfile = getProfile(config, targetProfileId)
  if (!targetProfile) return { ok: false, error: 'Unknown target profile' }
  const targetPage = getPage(targetProfile, targetPageId)
  if (!targetPage) return { ok: false, error: 'Unknown target page' }

  const placement = placeButtonInPage(targetPage, pageGrid(targetProfile, targetPage), found.button)
  if (!placement) {
    return {
      ok: false,
      error: 'No free cell is left on the target page. The button was not moved.',
    }
  }

  const id = idExistsOutsideSource(config, found.button.id, sourceProfileId, sourcePageId)
    ? freshButtonId(config)
    : found.button.id
  const moved = applyPlacement({ ...structuredClone(found.button), id }, placement)

  // Remove first, then add to the target. Placement was computed against the
  // target page, which the removal does not touch, so the footprint stays free.
  const next = addButton(
    removeButton(config, sourceProfileId, sourcePageId, buttonId),
    targetProfileId,
    targetPageId,
    moved,
  )
  return { ok: true, config: next, button: moved, fallback: placement.fallback }
}
