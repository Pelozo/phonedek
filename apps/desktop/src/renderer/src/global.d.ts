import type { PhoneDeckApi } from '../../shared/api'

declare global {
  interface Window {
    phonedek: PhoneDeckApi
  }
}

export {}
