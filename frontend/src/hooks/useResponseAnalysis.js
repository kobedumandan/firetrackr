import { useEffect, useState } from 'react'
import { fetchOperationalDetail } from '../api'

export default function useResponseAnalysis(fireId) {
  const [result, setResult] = useState(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener('operational-times-updated', refresh)
    return () => window.removeEventListener('operational-times-updated', refresh)
  }, [])
  useEffect(() => {
    let alive = true
    fetchOperationalDetail(fireId).then(
      detail => { if (alive) setResult({ fireId, detail }) },
      error => { if (alive) setResult(previous => ({ fireId, detail: previous?.fireId === fireId ? previous.detail : null, error: error.message })) },
    )
    return () => { alive = false }
  }, [fireId, revision])
  return {
    detail: result?.fireId === fireId ? result.detail : null,
    error: result?.fireId === fireId ? result.error : null,
    onRetry: () => setRevision(value => value + 1),
    onSaved: detail => setResult({ fireId, detail }),
  }
}
