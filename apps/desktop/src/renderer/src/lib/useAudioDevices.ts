import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioDevicesResult } from '../../../shared/api'

export interface AudioDevicesState {
  result: AudioDevicesResult | null
  loading: boolean
  loaded: boolean
  error: string | null
  /** Local clock when the last successful/failed read landed. */
  loadedAt: number | null
  refresh: (force?: boolean) => Promise<AudioDevicesResult | null>
}

/**
 * One-shot audio endpoint list for the editor. It reads only while a picker or
 * audio-device card is mounted; this is configuration UI, not a live panel.
 * `refresh(true)` bypasses the controller's 2 s cache.
 */
export function useAudioDevices(active: boolean): AudioDevicesState {
  const [result, setResult] = useState<AudioDevicesResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const nonce = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async (force = false): Promise<AudioDevicesResult | null> => {
    const request = ++nonce.current
    setLoading(true)
    setError(null)
    try {
      const next = await window.phonedek.getAudioDevices(force)
      if (!mounted.current || request !== nonce.current) return null
      setResult(next)
      setLoadedAt(Date.now())
      if (!next.ok) setError(next.error ?? 'Could not read audio devices')
      return next
    } catch (cause) {
      if (mounted.current && request === nonce.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoadedAt(Date.now())
      }
      return null
    } finally {
      if (mounted.current && request === nonce.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!active) {
      setResult(null)
      setError(null)
      setLoadedAt(null)
      setLoading(false)
      return
    }
    void refresh(false)
  }, [active, refresh])

  return { result, loading, loaded: loadedAt !== null, error, loadedAt, refresh }
}
