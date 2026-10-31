import AppModal from './AppModal'
import AnalysisIcon from './AnalysisIcon'
import ResponseAnalysisContent from './ResponseAnalysisContent'
import useResponseAnalysis from '../hooks/useResponseAnalysis'

export default function ResponseAnalysisModal({ fireId, theme, onClose, onOpenDispatch }) {
  const analysis = useResponseAnalysis(fireId)
  const { detail } = analysis
  return <AppModal eyebrow={`INCIDENT REVIEW / INC-${fireId}`} title="Response Analysis" subtitle={detail ? `${detail.barangay || 'Barangay unknown'} · ${detail.response_kind || 'Unclassified response'}` : 'Routes, response timing and operational evidence'} width={1280} className="ota-dialog ram-dialog" onClose={onClose} manageFocus>
    <ResponseAnalysisContent key={fireId} fireId={fireId} theme={theme} onOpenDispatch={onOpenDispatch} {...analysis} />
    <div className="eim-footer ram-footer"><span><AnalysisIcon name="info" />All timestamps in Philippine time (UTC+8)</span><button type="button" className="apm-btn-cancel" onClick={onClose}>Close analysis</button></div>
  </AppModal>
}
