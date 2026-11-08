import { useEffect, useRef, useState } from 'react'
import AnalysisIcon from '../components/AnalysisIcon'
import ResponsePerformanceView from '../components/ResponsePerformanceView'
import ResponseAnalysisPage from './ResponseAnalysisPage'
import DispatchDetailsPage from './DispatchDetailsPage'
import PlanningPage from './PlanningPage'
import OperationalReports from '../components/OperationalReports'
import '../styles/MetricsPage.css'
import '../styles/AnalysisPage.css'

const TABS = [
  { key: 'response', label: 'Response & Operations', icon: 'response' },
  { key: 'coverage', label: 'Coverage Planning', icon: 'coverage' },
  { key: 'reports', label: 'Operational Reports', icon: 'chart' },
]

export default function AnalysisPage({ theme, tab = 'response', onTabChange, onOpenIncident, detailView: routedDetail = null, onDetailChange, section = null, sectionFocusNonce = 0 }) {
  // Preserve navigation from older callers that still request the timing tab.
  const activeTab = tab === 'operational' ? 'response' : tab
  const tabListRef = useRef(null)
  const [localDetailView, setLocalDetailView] = useState(null)
  const detailView = onDetailChange ? routedDetail : localDetailView
  const setDetailView = onDetailChange || setLocalDetailView
  const recordTriggerRef = useRef(null)
  useEffect(() => {
    if (detailView == null && recordTriggerRef.current?.isConnected) {
      recordTriggerRef.current.focus({ preventScroll: true })
      recordTriggerRef.current = null
    }
  }, [detailView])
  function openDetails(kind, id, fireId) {
    recordTriggerRef.current = document.activeElement
    setDetailView({ kind, id, fireId })
  }
  useEffect(() => {
    tabListRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeTab])
  function moveTab(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = TABS.findIndex(item => item.key === activeTab)
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length
    const next = TABS[nextIndex].key
    onTabChange(next)
    event.currentTarget.querySelector(`#analysis-${next}-tab`)?.focus()
  }
  return <div className="analysis-page">
    <div className="analysis-workspace" hidden={detailView != null}>
    <header className="m-header analysis-header">
      <div className="m-title-row"><div><span className="m-title">Analysis</span><svg className="unfold_icon" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-120 300-300l58-58 122 122 122-122 58 58-180 180ZM358-598l-58-58 180-180 180 180-58 58-122-122-122 122Z" /></svg></div></div>
      <div ref={tabListRef} className="analysis-tabs" role="tablist" aria-label="Analysis views" onKeyDown={moveTab}>
        {TABS.map(item => <button key={item.key} id={`analysis-${item.key}-tab`} role="tab" aria-selected={activeTab === item.key} tabIndex={activeTab === item.key ? 0 : -1} aria-controls="analysis-panel" onClick={() => onTabChange(item.key)}><AnalysisIcon name={item.icon} />{item.label}</button>)}
      </div>
    </header>
    <div id="analysis-panel" role="tabpanel" aria-labelledby={`analysis-${activeTab}-tab`} className="analysis-panel">
      {activeTab === 'response' ? <ResponsePerformanceView onOpenAnalysis={id => openDetails('incident', id)} onOpenDispatch={(id, fireId) => openDetails('dispatch', id, fireId)} /> : activeTab === 'reports' ? <OperationalReports /> : <PlanningPage />}
    </div>
    </div>
    {detailView?.kind === 'incident' && <ResponseAnalysisPage key={detailView.id} fireId={detailView.id} theme={theme} onBack={() => setDetailView(null)} onOpenIncident={onOpenIncident} section={section} sectionFocusNonce={sectionFocusNonce} />}
    {detailView?.kind === 'dispatch' && (detailView.fireId != null
      ? <ResponseAnalysisPage key={`dispatch-${detailView.id}`} fireId={detailView.fireId} initialDispatchId={detailView.id} theme={theme} backLabel="Dispatch observations" onBack={() => setDetailView(null)} onOpenIncident={onOpenIncident} />
      : <DispatchDetailsPage key={detailView.id} id={detailView.id} theme={theme} onBack={() => setDetailView(null)} onOpenIncident={onOpenIncident} />)}
  </div>
}
