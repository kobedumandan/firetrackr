import DetailsLayout from '../layout/DetailsLayout'
import SettingsLoading from '../components/SettingsLoading'
import useDispatchDetail from '../hooks/useDispatchDetail'
import ResponseAnalysisPage from './ResponseAnalysisPage'

// Resolve older entry points that only know a dispatch ID into the shared review.
export default function DispatchDetailsPage({ id, theme, onBack, onOpenIncident, backLabel = 'Dispatch observations' }) {
  const { data, error, onRetry } = useDispatchDetail(id)
  if (data) return <ResponseAnalysisPage fireId={data.fire_id} initialDispatchId={id} initialDispatchDetail={data} theme={theme} onBack={onBack} onOpenIncident={onOpenIncident} backLabel={backLabel} />
  return <main className="response-analysis-page"><DetailsLayout onBack={onBack} backLabel={backLabel}>
    {error ? <div className="rar-notice rar-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Retry</button></div> : <SettingsLoading message="Loading response analysis…" compact />}
  </DetailsLayout></main>
}
