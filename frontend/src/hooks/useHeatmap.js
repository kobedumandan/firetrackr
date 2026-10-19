import { useCallback, useEffect, useState } from 'react'
import { fetchHeatmap } from '../api'

export function useHeatmap(enabled, revision) {
  const [state, setState] = useState({ points: [], status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const refresh = useCallback(() => setAttempt(value => value + 1), [])
  useEffect(() => {
    if (!enabled) return
    let disposed = false, request = 0, controller
    async function load() {
      const id = ++request
      controller?.abort()
      controller = new AbortController()
      const signal = controller.signal
      await Promise.resolve()
      if (disposed || id !== request) return
      setState(previous => ({ ...previous, status: 'loading' }))
      try {
        const points = await fetchHeatmap(signal)
        if (!Array.isArray(points)) throw new Error('Invalid heatmap response')
        if (!disposed && id === request) setState({ points, status: 'ready' })
      } catch (error) {
        if (!disposed && id === request && error.name !== 'AbortError') {
          setState({ points: [], status: 'error' })
        }
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    load()
    const timer = setInterval(onVisible, 120000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      controller?.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, revision, attempt])
  return { ...state, refresh }
}
