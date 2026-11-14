import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS_CATEGORY,
  SETTINGS_CATEGORIES,
  isSettingsCategoryId,
  resolveSettingsCategory,
  settingsCategory,
} from '../src/renderer/src/lib/settingsCategories'

describe('Settings categories', () => {
  it('keeps the console order and stable deep-link ids', () => {
    expect(SETTINGS_CATEGORIES.map((category) => category.id)).toEqual([
      'general',
      'input',
      'integrations',
      'phone',
      'about',
    ])
    expect(DEFAULT_SETTINGS_CATEGORY).toBe('general')
  })

  it('numbers every category once and describes it', () => {
    const indices = SETTINGS_CATEGORIES.map((category) => category.index)
    expect(indices).toEqual(['01', '02', '03', '04', '05'])
    expect(new Set(indices).size).toBe(indices.length)
    for (const category of SETTINGS_CATEGORIES) {
      expect(category.label.trim()).not.toBe('')
      expect(category.description.trim()).not.toBe('')
    }
  })

  it('validates values that arrive from deep links', () => {
    expect(isSettingsCategoryId('integrations')).toBe(true)
    expect(isSettingsCategoryId('updates')).toBe(false)
    expect(isSettingsCategoryId(null)).toBe(false)
    expect(resolveSettingsCategory('phone')).toBe('phone')
    expect(resolveSettingsCategory('unknown')).toBe(DEFAULT_SETTINGS_CATEGORY)
    expect(resolveSettingsCategory(undefined)).toBe(DEFAULT_SETTINGS_CATEGORY)
  })

  it('looks up a category with a safe General fallback', () => {
    expect(settingsCategory('about').label).toBe('About')
    expect(settingsCategory('about').index).toBe('05')
  })
})
