import { useEffect, useState } from 'react'
import KpiCard, { KPI_EMPTY } from '../components/KpiCard'
import AnalysisIcon from '../components/AnalysisIcon'
import OperationalTrendChart from '../components/OperationalTrendChart'
import ResponseAnalysisModal from '../components/ResponseAnalysisModal'
import { exportOperationalReport, fetchOperationalTimes, invalidateOperationalTimes } from '../api'
import CsvReviewModal from '../components/CsvReviewModal'
import { STAGES, dateTime, duration } from '../utils/operationalTimes'
import '../styles/MetricsPage.css'
import '../styles/OperationalTimePage.css'

const PERIOD_LABELS = { '1d': 'Past day', '1w': 'Past week', '1m': 'Past month', '6m': 'Past six months', '1y': 'Past year', all: 'All recorded dates' }
const STAGE_DESCRIPTIONS = { processing: 'Report receipt → dispatch', preparation: 'Dispatch → departure', travel: 'Departure → arrival', suppression: 'Suppression started → fire out' }

export default function OperationalTimePage({ theme }) {
  const [period, setPeriod] = useState('all')
  const [source, setSource] = useState('recorded')
  const [kind, setKind] = useState('operational')
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState(null)
  const [csv, setCsv] = useState(null)
  const [exportError, setExportError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const key = `${period}:${page}:${source}:${kind}:${revision}`
  const data = result?.key === key ? result.data : null
  const error = result?.key === key ? result.error : null
  const loading = !data && !error
  useEffect(() => {
    let alive = true
    fetchOperationalTimes(period, page, source, source === 'demo' ? 'all' : kind).then(data => { if (alive) setResult({ key, data }) }, error => { if (alive) setResult({ key, error: error.message }) })
    return () => { alive = false }
  }, [period, page, source, kind, key])
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1)
    window.addEventListener('operational-times-updated', refresh)
    const timer = setInterval(() => { if (!document.hidden) invalidateOperationalTimes() }, 60000)
    return () => { window.removeEventListener('operational-times-updated', refresh); clearInterval(timer) }
  }, [])
  const breakdown = data?.breakdown
  const currentPage = data?.page || page
  const totalPages = data?.total_pages || 1
  const pageNumbers = Array.from(new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1])).filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b)
  const total = STAGES.reduce((sum, stage) => sum + (breakdown?.seconds?.[stage.key] || 0), 0)
  const callToArrival = data?.summary?.cta
  const demo = source === 'demo'
  async function reviewCsv() {
    setExporting(true); setExportError(null)
    try {
      const query = new URLSearchParams({ start: data.start, end: data.end, kind: source === 'demo' ? 'all' : kind, source })
      setCsv(await exportOperationalReport('operational-times', query.toString()))
    } catch (err) { setExportError(err.message) }
    finally { setExporting(false) }
  }
  return <main className="ota-page">
    <div className="ota-body" aria-busy={loading}>
      <header className="m-view-heading ota-heading"><div><h1>Operational Time Analysis</h1><p>Understand where time is spent, from the first report to fire out.</p></div><span className="ota-timezone">Asia/Manila · PHT</span></header>
      <section className="ota-toolbar" aria-label="Analysis filters">
        <div className="ota-toolbar-heading"><span><AnalysisIcon name="filter" />Analysis window</span><span>{PERIOD_LABELS[period]}</span></div>
        <div className="ota-filter-row">
          <div className="ota-period-field"><span className="ota-field-label">Reporting period</span><div className="m-period-group" role="group" aria-label="Reporting period">
            {Object.keys(PERIOD_LABELS).map(p => <button key={p} className={`m-period-btn ${p === period ? 'active' : ''}`} aria-pressed={p === period} onClick={() => { setPeriod(p); setPage(1) }}>{p === 'all' ? 'All' : p}</button>)}
          </div></div>
          <label className="ota-source-field">Timing data<select aria-label="Timing data" value={source} onChange={e => { setSource(e.target.value); setPage(1) }}><option value="recorded">Recorded operational times</option><option value="demo">BFP history · synthesized demo times</option></select></label>
          <button className="ota-refresh" disabled={loading} onClick={invalidateOperationalTimes}><AnalysisIcon name="refresh" />Refresh</button>
        </div>
      </section>
      {demo && <aside className="ota-banner ota-demo"><AnalysisIcon name="info" /><div><strong>Demonstration timing</strong><p>Incident dates and causes come from the BFP workbook, but all response-stage durations are synthesized. These figures do not measure actual BFP performance. No real team or truck assignments are implied.</p></div></aside>}
      {error && <div className="ota-banner ota-error" role="alert"><AnalysisIcon name="info" /><div><strong>Could not load operational times</strong><p>{error}</p></div><button onClick={invalidateOperationalTimes}>Retry</button></div>}
      <label className="ota-source-field">Record population<select disabled={demo} value={kind} onChange={e => { setKind(e.target.value); setPage(1) }}>{['operational', 'drill', 'test', 'unknown', 'all'].map(k => <option key={k} value={k}>{k === 'unknown' ? 'Unclassified historical records' : k === 'all' ? 'All record kinds' : k}</option>)}</select></label>
      <button disabled={!data || exporting} onClick={reviewCsv}>{exporting ? 'Preparing…' : 'Review timing CSV'}</button>
      {exportError && <p role="alert">{exportError}</p>}
      {!demo && <section className="ota-card ota-summary" aria-label="Overall operation time"><div className="ota-summary-main"><h2>Overall operation time</h2><p>Report received → operation complete / all units cleared.</p><strong className="ota-summary-value">{duration(data?.summary?.operation?.seconds)}</strong><p>{data?.summary?.operation?.count || 0} incidents with recorded endpoints. Report submission and fire out do not imply operation completion.</p></div></section>}
      {loading && <span className="ota-sr-only" role="status">Loading operational records…</span>}
      {!error && <>
        {data?.missing_receipt_count > 0 && <aside className="ota-banner ota-data-note"><AnalysisIcon name="info" /><p><strong>{data.missing_receipt_count} records</strong> have no verified report receipt time. They are listed by incident occurrence date and excluded from period averages.</p></aside>}
        <section className="ota-card ota-summary" aria-label="Call-to-arrival summary">
          <div className="ota-summary-main"><div className="ota-section-head"><h2>Average call-to-arrival</h2><span className={`ota-tag${demo ? ' ota-demo-tag' : ''}`}>{demo ? 'Synthesized demo' : 'Recorded times'}</span></div>
            <p>Report receipt to the first eligible arrival.</p>
            {loading ? <span className="kpi-sk ota-value-skeleton" aria-hidden="true" /> : <strong className={`ota-summary-value${callToArrival?.seconds == null ? ' is-empty' : ''}`}>{duration(callToArrival?.seconds)}</strong>}
            <span className="ota-summary-caption">{loading ? 'Loading measurements' : `${callToArrival?.count || 0} ${demo ? 'simulated incident timelines' : 'incidents with measured call-to-arrival'}`}</span>
          </div>
          <div className="ota-coverage"><span className="ota-eyebrow">Analysis coverage</span><dl>
            <div><dt>Incidents in this window</dt><dd>{loading ? '—' : (data?.total || 0).toLocaleString()}</dd></div>
            <div><dt>Complete four-stage records</dt><dd>{loading ? '—' : (breakdown?.count || 0).toLocaleString()}</dd></div>
          </dl><p><AnalysisIcon name="info" />Call-to-arrival is measured independently of suppression.</p></div>
        </section>
        <section aria-label="Stage averages"><div className="ota-section-head ota-stage-heading"><div><h2>Time by response stage</h2><p>Mean durations from {demo ? 'synthesized demonstration timelines' : 'verified operational records'}.</p></div><span className="ota-tag">{PERIOD_LABELS[period]}</span></div>
          <div className="ota-kpis">{STAGES.map(s => {
            const stat = data?.summary?.[s.key]
            return <KpiCard key={s.key} loading={loading} label={s.label} icon={<AnalysisIcon name={s.key} />} accent="fire" value={stat?.seconds == null ? KPI_EMPTY : `${(stat.seconds / 60).toFixed(1)} min`}
              sub={<><span className="ota-stage-definition">{STAGE_DESCRIPTIONS[s.key]}</span><span className="ota-stage-count">{stat?.count || 0} {demo ? 'simulated incident timelines' : `recorded ${['preparation', 'travel'].includes(s.key) ? 'units' : 'incidents'}`}</span></>}
              trend={stat?.change_percent == null ? null : { dir: stat.change_percent > 0 ? 'up' : 'down', text: `${Math.abs(stat.change_percent).toFixed(1)}% vs previous period` }} />
          })}</div>
        </section>
        <section className="ota-card ota-breakdown-card"><div className="ota-section-head"><div><h2>Operational Time Breakdown</h2><p>{demo ? 'Synthesized timelines for' : 'First arriving unit in'} {breakdown?.count || 0} fire incidents with all four stages available.</p></div><span className="ota-tag">Common incident cohort</span></div>
          {loading ? <div className="kpi-sk ota-breakdown-skeleton" aria-hidden="true" /> : total > 0 ? <>
            <div className="ota-breakdown" role="img" aria-label="Share of measured time in each response stage">{STAGES.map(s => <span key={s.key} style={{ flex: breakdown.seconds[s.key] / total, background: s.color }} title={`${s.label}: ${duration(breakdown.seconds[s.key])} · ${(breakdown.seconds[s.key] / total * 100).toFixed(1)}%`} />)}</div>
            <div className="ota-breakdown-stats">{STAGES.map(s => <div key={s.key}><span className="ota-stage-name"><i style={{ background: s.color }} />{s.label}</span><strong>{duration(breakdown.seconds[s.key])}</strong><span>{(breakdown.seconds[s.key] / total * 100).toFixed(1)}% of measured stages</span></div>)}</div>
          </> : <div className="ota-empty"><AnalysisIcon name="chart" /><h3>{breakdown?.count > 0 ? 'Recorded stages total 0 min; percentage shares are undefined.' : 'No complete four-stage records in this period.'}</h3><p>All four stages must be available for an incident to enter this breakdown.</p></div>}
          <p className="ota-method-note"><AnalysisIcon name="info" />Shares of measured intervals, not a continuous timeline. Any arrival-to-suppression delay is excluded.</p>
        </section>
        <OperationalTrendChart points={data?.trends} period={period} loading={loading} demo={demo} />
        <section className="ota-card ota-records"><div className="ota-section-head"><div><div className="ota-title-with-count"><h2>Recent Operational Records</h2>{!loading && <span className="ota-count">{data?.total || 0}</span>}</div><p>One row per incident. Open a record to inspect stages, responding trucks and saved routes.</p></div><span className="ota-tag">Timestamps in PHT</span></div>
          <div className="ota-table-scroll"><table><thead><tr>{['Incident #', 'Report Date & Time · PHT', 'Type', ...STAGES.map(s => s.label), 'Call-to-Arrival', 'Overall operation'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>{loading ? [0, 1, 2].map(n => <tr key={n} aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <td key={i}><span className="kpi-sk ota-cell-skeleton" /></td>)}</tr>) : data?.records.map(r => <tr key={r.fire_id} onClick={() => setSelected(r.fire_id)}><td><button className="ota-record-link" onClick={e => { e.stopPropagation(); setSelected(r.fire_id) }}>INC-{r.fire_id}<AnalysisIcon name="chevron" /></button>{r.timing_basis === 'synthetic_demo' && <small>Demo timings · {r.source_record_id}</small>}</td><td className="ota-report-time">{dateTime(r.synthetic_timeline?.report_received_at || r.reported_at || r.occurred_at)}{!r.reported_at && <small>{r.timing_basis === 'synthetic_demo' ? 'Synthesized receipt time' : 'Occurrence date · receipt unknown'}</small>}</td><td><span className="ota-type-badge">{r.response_kind || 'Unknown'}</span></td>{[...STAGES.map(s => s.key), 'cta', 'operation'].map(s => <td key={s} className={`${s === 'cta' ? 'ota-cta-cell' : ''}${r.durations[s] == null ? ' ota-missing-cell' : ''}`}>{s === 'suppression' && r.response_kind && r.response_kind !== 'fire' ? 'N/A' : duration(r.durations[s])}</td>)}</tr>)}</tbody>
          </table></div>
          {!loading && !data?.records.length && <div className="ota-empty"><AnalysisIcon name="processing" /><h3>No operational records in this period.</h3><p>Try a wider reporting period. Missing measurements stay visible as no data.</p></div>}
          <div className="ota-table-footer"><span className="ota-page-summary">{data?.total || 0} incidents · {data?.page_size || 5} per page · page {currentPage} of {totalPages}</span><nav className="ota-pagination" aria-label="Operational records pages"><button aria-label="Previous page" title="Previous page" disabled={currentPage === 1 || loading} onClick={() => setPage(currentPage - 1)}>‹</button>{pageNumbers.map((n, i) => <span className="ota-page-number" key={n}>{i > 0 && n - pageNumbers[i - 1] > 1 && <span className="ota-page-ellipsis" aria-hidden="true">…</span>}<button disabled={loading} aria-label={`Page ${n}`} aria-current={n === currentPage ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button></span>)}<button aria-label="Next page" title="Next page" disabled={loading || currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>›</button></nav></div>
        </section>
      </>}
    </div>
    {selected != null && <ResponseAnalysisModal fireId={selected} theme={theme} onClose={() => setSelected(null)} />}
    {csv && <CsvReviewModal csv={csv} fileName="operational-times.csv" title="Operational Times" onClose={() => setCsv(null)} />}
  </main>
}
