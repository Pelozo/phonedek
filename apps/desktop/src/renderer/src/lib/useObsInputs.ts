import { useCallback, useEffect, useRef, useState } from 'react'
import type { ObsInputView } from '../../../shared/api'

export interface ObsInputsState {
  inputs: ObsInputView[]
  loading: boolean
  loaded: boolean
  error: string | null
  refresh: () => Promise<ObsInputView[] | null>
}

/**
 * Fetch the scene-collection input list when a picker becomes active. Every
 * opening refreshes; the main process caches the list between calls.
 */
export function useObsInputs(active: boolean): ObsInputsState {
  const [inputs, setInputs] = useState<ObsInputView[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async (): Promise<ObsInputView[] | null> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.phonedek.listObsInputs()
      if (!mounted.current) return null
      if (!result.ok) {
        setError(result.error ?? 'Could not list OBS inputs')
        setLoaded(true)
        return null
      }
      const next = result.inputs ?? []
      setInputs(next)
      setLoaded(true)
      return next
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoaded(true)
      }
      return null
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (active) void refresh()
  }, [active, refresh])

  return { inputs, loading, loaded, error, refresh }
}
