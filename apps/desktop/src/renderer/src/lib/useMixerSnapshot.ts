import { useCallback, useEffect, useRef, useState } from 'react'
import type { MixerSnapshot } from '@phonedek/shared'

export interface MixerSnapshotState {
  snapshot: MixerSnapshot | null
  loading: boolean
  loaded: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Reads the per-app mixer snapshot for a picker/Inspector. It stays idle until
 * an app-volume control, action or status tile asks for it, so macOS and
 * unsupported hosts never hit the IPC on every editor render.
 */
export function useMixerSnapshot(enabled = true): MixerSnapshotState {
  const [snapshot, setSnapshot] = useState<MixerSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nonce = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const request = ++nonce.current
    setLoading(true)
    setError(null)
    try {
      const next = await window.phonedek.getMixerSnapshot()
      if (request === nonce.current) setSnapshot(next)
    } catch (cause) {
      if (request === nonce.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (request === nonce.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setSnapshot(null)
      setError(null)
      setLoading(false)
      return
    }
    void refresh()
  }, [enabled, refresh])

  return {
    snapshot,
    loading,
    loaded: snapshot !== null,
    error,
    refresh,
  }
}
