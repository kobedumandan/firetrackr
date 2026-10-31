import { useEffect, useState } from 'react'
import { fetchResponseDispatch } from '../api'

export default function useDispatchDetail(id) {
  const [result, setResult] = useState(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener('operational-times-updated', refresh)
    return () => window.removeEventListener('operational-times-updated', refresh)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    fetchResponseDispatch(id, controller.signal).then(
      data => { if (!controller.signal.aborted) setResult({ id, data }) },
      error => {
        if (!controller.signal.aborted) setResult(previous => ({ id, data: previous?.id === id ? previous.data : null, error: error.message }))
      },
    )
    return () => controller.abort()
  }, [id, revision])
  return {
    data: result?.id === id ? result.data : null,
    error: result?.id === id ? result.error : null,
    onRetry: () => setRevision(value => value + 1),
  }
}
