import { useCallback, useEffect, useState } from 'react'
import { fetchIncidentWorkflow, performWorkflowAction, confirmDispatchClearance } from '../api'

export default function useIncidentWorkflow(fireId, revision = 0, onChanged) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { const result = await fetchIncidentWorkflow(fireId); setData(result); setError('') }
    catch (failure) { setError(failure.message) }
  }, [fireId])
  useEffect(() => {
    if (fireId == null) return
    let alive = true
    fetchIncidentWorkflow(fireId).then(result => { if (alive) { setData(result); setError('') } })
      .catch(failure => { if (alive) setError(failure.message) })
    const refresh = () => load()
    window.addEventListener('operational-times-updated', refresh)
    return () => { alive = false; window.removeEventListener('operational-times-updated', refresh) }
  }, [fireId, revision, load])

  async function submit(path, body) {
    if (busy) throw new Error('Another response update is saving. Try again shortly.')
    setBusy(true); setError('')
    try {
      await performWorkflowAction(path, body)
      const result = await fetchIncidentWorkflow(fireId)
      setData(result); onChanged?.(result.incident)
    } catch (failure) { setError(failure.message); throw failure }
    finally { setBusy(false) }
  }
  async function clear(dispatch, reason) {
    if (busy) throw new Error('Another response update is saving. Try again shortly.')
    if (!reason?.trim()) throw new Error('Record the radio source / clearance reason.')
    setBusy(true); setError('')
    try {
      await confirmDispatchClearance(dispatch.dispatch_id, { occurred_at: new Date().toISOString(), idempotency_key: crypto.randomUUID(), reason: reason.trim() })
      const result = await fetchIncidentWorkflow(fireId); setData(result); onChanged?.(result.incident)
    } catch (failure) { setError(failure.message); throw failure }
    finally { setBusy(false) }
  }
  return { data: data?.incident.fire_id === fireId ? data : null, error, busy, load, submit, clear }
}
