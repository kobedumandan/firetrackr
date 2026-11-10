import { useEffect, useId, useState } from 'react';
import { lifecycleRequest } from '../api';
import ConfirmModal from './ConfirmModal';
import '../styles/ResourceArchive.css';
import '../styles/TablePagination.css';

const ACCOUNTS_PER_PAGE = 10;

function pageNumbers(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, '…', totalPages];
  if (page >= totalPages - 3) return [1, '…', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, '…', page - 1, page, page + 1, '…', totalPages];
}

const ARCHIVE_TABS = [
  { id: 'teams', label: 'Teams' },
  { id: 'trucks', label: 'Trucks' },
  { id: 'personnel', label: 'Personnel' },
  { id: 'stations', label: 'Stations' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'obstructions', label: 'Obstructions' },
];

function formatDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : 'Date unavailable';
}

function isPastObstruction(row) {
  return row.resolved_at || row.is_active === false || (row.expires_at && new Date(row.expires_at) <= new Date());
}

function DispatcherAttribution({ label, name, role }) {
  return <small className="archive-dispatcher">
    <span>{label} {name || 'Unknown dispatcher'}</span>
    {role && <><span className="archive-pipe" aria-hidden="true">|</span><span className={`val-badge ${role === 'admin' ? 'vb-fire' : 'archive-personnel-badge'}`}>{role === 'admin' ? 'Admin' : 'Personnel'}</span></>}
  </small>;
}

function ObstructionIcon({ type }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {type === 'repair' ? <><rect x="3" y="9" width="18" height="6" rx="1.2" /><path d="m8 9-3 6m8-6-3 6m8-6-3 6" /></>
      : type === 'flood' ? <path d="M3 15q2.75-3 5.5 0t5.5 0 5.5 0M3 9.5q2.75-3 5.5 0t5.5 0 5.5 0" />
        : type === 'accident' ? <><path d="M12 4.5 20.5 19H3.5Z" /><path d="M12 10v3.5m0 2.7v.1" /></>
          : <><circle cx="12" cy="12" r="8.5" /><path d="M7 12h10" /></>}
  </svg>;
}

function RowIcon({ kind, name, stationType, obstructionType }) {
  const person = kind === 'accounts' || kind === 'personnel';
  const names = (name || '').trim().split(/\s+/).filter(Boolean);
  const initials = names.length ? `${names[0][0]}${names.length > 1 ? names[names.length - 1][0] : ''}`.toUpperCase() : '??';
  const symbol = { teams: 'groups', trucks: 'fire_truck', stations: stationType === 'sub' ? 'location_on' : 'apartment' }[kind];
  return <span className={`archive-row-avatar per-av per-av-md per-tile-muted${kind === 'obstructions' ? ` archive-obstruction-avatar archive-obstruction-${obstructionType}` : ''}`} aria-hidden="true">
    {person ? initials : kind === 'obstructions' ? <ObstructionIcon type={obstructionType} /> : symbol ? <span className="material-symbols-outlined">{symbol}</span> : kind === 'incidents' ? <svg viewBox="0 -960 960 960" fill="currentColor">
      <path d="M240-400q0 52 21 98.5t60 81.5q-1-5-1-9v-9q0-32 12-60t35-51l113-111 113 111q23 23 35 51t12 60v9q0 4-1 9 39-35 60-81.5t21-98.5q0-50-18.5-94.5T648-574q-20 13-42 19.5t-45 6.5q-62 0-107.5-41T401-690q-39 33-69 68.5t-50.5 72Q261-513 250.5-475T240-400Zm240 52-57 56q-11 11-17 25t-6 29q0 32 23.5 55t56.5 23q33 0 56.5-23t23.5-55q0-16-6-29.5T537-292l-57-56Zm0-492v132q0 34 23.5 57t57.5 23q18 0 33.5-7.5T622-658l18-22q74 42 117 117t43 163q0 134-93 227T480-80q-134 0-227-93t-93-227q0-129 86.5-245T480-840Z" />
    </svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6" />
    </svg>}
  </span>;
}

function ArchiveRecords({ kind, busy, onBusyChange, onChanged, currentUserId }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [accessFilter, setAccessFilter] = useState('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [disabling, setDisabling] = useState(null);
  const [enabling, setEnabling] = useState(null);
  const [restoring, setRestoring] = useState(null);
  const accounts = kind === 'accounts';
  const obstructions = kind === 'obstructions';

  useEffect(() => {
    let alive = true;
    lifecycleRequest(accounts ? '/api/accounts' : `/api/archive/${kind}`)
      .then(data => { if (alive) setRows(accounts ? data.filter(row => row.role !== 'admin') : obstructions ? data.filter(isPastObstruction) : data); })
      .catch(err => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [accounts, obstructions, kind, attempt]);

  function reload() {
    setLoading(true);
    setError('');
    setAttempt(value => value + 1);
  }

  async function act(row) {
    onBusyChange(true);
    setError('');
    try {
      if (accounts) {
        await lifecycleRequest(`/api/accounts/${row.user_id}/access`, {
          method: 'PATCH', body: JSON.stringify({ enabled: !!row.disabled_at }),
        });
      } else {
        await lifecycleRequest(`/api/archive/${kind}/${row.id}/restore`, { method: 'POST' });
      }
      await onChanged?.();
      reload();
    } finally { onBusyChange(false); }
  }

  function isProtected(row) {
    return accounts && !row.disabled_at && (row.role === 'admin' || row.user_id === currentUserId);
  }

  function requestAction(row) {
    if (isProtected(row)) return;
    if (accounts && !row.disabled_at) setDisabling(row);
    else if (!accounts) setRestoring(row);
    else setEnabling(row);
  }

  const filtered = rows.filter(row =>
    (!accounts || !accessFilter || (row.disabled_at ? 'disabled' : 'enabled') === accessFilter)
    && `${row.name} ${row.type || ''} ${row.description || ''} ${row.created_by_name || ''} ${row.resolved_by_name || ''} ${row.email || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(filtered.length / ACCOUNTS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * ACCOUNTS_PER_PAGE;
  const visibleRows = accounts ? filtered.slice(pageStart, pageStart + ACCOUNTS_PER_PAGE) : filtered;
  const description = accounts
    ? 'Disabling an account ends access while preserving its reports and action history.'
    : obstructions
      ? 'Resolved and expired obstructions remain on record. Add a new obstruction if the road becomes blocked again.'
      : kind === 'incidents'
        ? 'Archived incidents retain their dispatches, reports, photos and response analysis. Restore a record to return it to the incident register.'
        : kind === 'personnel'
          ? 'Restoring personnel preserves their past assignments and reports. Their login stays disabled until you enable it under Account Access.'
          : 'Restore archived records to make them available in the system again. Their past incident history stays linked.';

  return <>
    <p className="archive-description">{description}</p>
    <div className="archive-toolbar">
      <div className="inc-search-wrap archive-search-wrap">
        <svg className="inc-search-icon archive-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
        <input className="archive-search" type="search" aria-label="Search records" placeholder={accounts ? 'Search accounts' : `Search archived ${kind}`} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
      </div>
      {accounts && <select className="archive-access-filter" aria-label="Filter by account access" value={accessFilter} onChange={event => { setAccessFilter(event.target.value); setPage(1); }}>
        <option value="">All Accounts</option>
        <option value="enabled">Enabled</option>
        <option value="disabled">Disabled</option>
      </select>}
      {!loading && !error && <span className="archive-count">{filtered.length} {filtered.length === 1 ? 'Record' : 'Records'}</span>}
    </div>
    {error && <div role="alert" className="archive-error">
      <span>{error}</span><button type="button" className="btn-edit" onClick={reload} disabled={busy}>Retry</button>
    </div>}
    {loading ? <p className="archive-empty" role="status">Loading records…</p> : <div className="archive-list" aria-busy={busy}>
      {visibleRows.map(row => <div className="archive-row" key={row.id ?? row.user_id}>
        <div className="archive-row-main">
        <RowIcon kind={kind} name={row.name} stationType={row.station_type} obstructionType={row.type} />
        <div className="archive-row-info">
          {accounts && <div className="archive-account-role"><span className={`val-badge ${row.role === 'admin' ? 'vb-fire' : 'archive-personnel-badge'}`}>{row.role === 'admin' ? 'Admin' : 'Personnel'}</span></div>}
          <strong>{obstructions && row.type ? row.type.charAt(0).toUpperCase() + row.type.slice(1) : row.name}</strong>
          {obstructions && row.description && <small>{row.description}</small>}
          {accounts ? <>
            <small className="archive-account-contact"><span>{row.email}</span><span className="archive-pipe" aria-hidden="true">|</span><span>{row.disabled_at ? 'Account Disabled' : 'Account Enabled'}</span></small>
          </> : obstructions ? <small className="archive-obstruction-status"><span>{row.resolved_at ? 'Resolved' : row.is_active === false ? 'Inactive' : 'Expired'}</span><span>{formatDate(row.resolved_at || row.expires_at || row.created_at)}</span></small>
            : <small>{`Archived ${formatDate(row.archived_at)}`}</small>}
          {obstructions && <DispatcherAttribution label="Placed by" name={row.created_by_name} role={row.created_by_role} />}
          {obstructions && (row.resolved_at || row.is_active === false) && <DispatcherAttribution label={row.resolved_at ? 'Resolved by' : 'Removed by'} name={row.resolved_by_name} role={row.resolved_by_role} />}
          {obstructions && !row.resolved_at && row.is_active !== false && <small>Expired automatically</small>}
          {obstructions && row.resolution_note && row.resolution_note !== 'Marked resolved by dispatcher.' && <small>{row.resolution_note}</small>}
        </div>
        </div>
        {!obstructions && <button type="button" className="btn-edit" disabled={busy || isProtected(row) || (accounts && row.personnel_archived)} title={isProtected(row) ? 'Administrator accounts cannot be disabled.' : accounts && row.personnel_archived ? 'Restore the personnel record before enabling this account.' : undefined} onClick={() => requestAction(row)} aria-label={`${accounts ? row.disabled_at ? 'Enable Account' : 'Disable Account' : 'Restore'} ${row.name}`}>
          {accounts ? (row.disabled_at ? 'Enable Account' : 'Disable Account') : 'Restore'}
        </button>}
      </div>)}
      {!filtered.length && !error && <p className="archive-empty">{accounts && accessFilter ? 'No accounts match your filters.' : search.trim() ? 'No records match your search.' : accounts ? 'No accounts to display.' : `No archived ${kind}.`}</p>}
    </div>}
    {accounts && !loading && !error && filtered.length > 0 && <nav className="inc-pagination archive-pagination" aria-label="Account pagination">
      <span className="inc-page-info" aria-live="polite">{pageStart + 1}–{Math.min(pageStart + ACCOUNTS_PER_PAGE, filtered.length)} of {filtered.length}</span>
      <div className="inc-page-controls">
        <button type="button" className="inc-page-btn next-prev-btn" aria-label="Previous page" onClick={() => setPage(currentPage - 1)} disabled={busy || currentPage === 1}>‹</button>
        {pageNumbers(currentPage, totalPages).map((number, index) => number === '…'
          ? <span key={`ellipsis-${index}`} className="inc-page-ellipsis">…</span>
          : <button key={number} type="button" className={`inc-page-btn${currentPage === number ? ' active' : ''}`} aria-label={`Page ${number}`} aria-current={currentPage === number ? 'page' : undefined} disabled={busy} onClick={() => setPage(number)}>{number}</button>)}
        <button type="button" className="inc-page-btn next-prev-btn" aria-label="Next page" onClick={() => setPage(currentPage + 1)} disabled={busy || currentPage === totalPages}>›</button>
      </div>
    </nav>}
    {restoring && <ConfirmModal
      eyebrow="RESTORE FROM ARCHIVE"
      title={`Restore ${{ teams: 'Team', trucks: 'Truck', personnel: 'Personnel', stations: 'Station', incidents: 'Incident' }[kind]}?`}
      icon="release"
      details={[{ label: 'Name', value: restoring.name }]}
      message={kind === 'personnel'
        ? 'This personnel record will return to the personnel list with its past assignments and reports preserved. Login access stays disabled until enabled under Account Access.'
        : kind === 'incidents'
          ? 'This incident will return to the incident register with its dispatches, reports, photos and response analysis preserved.'
          : 'This record will return to its resource list with its past incident history preserved.'}
      confirmLabel="Restore"
      onConfirm={() => act(restoring)}
      onClose={() => setRestoring(null)}
    />}
    {enabling && <ConfirmModal
      eyebrow="ACCOUNT ACCESS"
      title="Enable Account?"
      icon="release"
      details={[{ label: 'Name', value: enabling.name }, { label: 'Email', value: enabling.email }]}
      message="This personnel account will regain access to the system. The personnel can sign in again, and their availability will follow their assigned shift and response status."
      confirmLabel="Enable Account"
      onConfirm={() => act(enabling)}
      onClose={() => setEnabling(null)}
    />}
    {disabling && <ConfirmModal
      eyebrow="ACCOUNT ACCESS"
      title="Disable Account?"
      icon="logout"
      details={[{ label: 'Name', value: disabling.name }, { label: 'Email', value: disabling.email }]}
      message="This personnel account will lose access to the system and its existing sessions will end. Past reports and action history will be preserved. You can enable the account again later."
      confirmLabel="Disable Account"
      onConfirm={() => act(disabling)}
      onClose={() => setDisabling(null)}
    />}
  </>;
}

export default function ResourceArchive({ view = 'archive', onChanged, currentUserId }) {
  const [kind, setKind] = useState('teams');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const accounts = view === 'accounts';

  function navigateTabs(event, index) {
    if (busy) return;
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % ARCHIVE_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index + ARCHIVE_TABS.length - 1) % ARCHIVE_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ARCHIVE_TABS.length - 1;
    else return;
    event.preventDefault();
    setKind(ARCHIVE_TABS[next].id);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
  }

  return <section className="settings-block archive-pane" aria-label={accounts ? 'Account access records' : 'Archived records'}>
    {!accounts && <div className="archive-tabs" role="tablist" aria-label="Archive categories">
      {ARCHIVE_TABS.map((tab, index) => <button key={tab.id} id={`${id}-${tab.id}`} type="button" role="tab" aria-selected={kind === tab.id} aria-controls={`${id}-panel`} tabIndex={kind === tab.id ? 0 : -1} disabled={busy} onClick={() => setKind(tab.id)} onKeyDown={event => navigateTabs(event, index)}>
        {tab.label}
      </button>)}
    </div>}
    <div className="archive-records" id={`${id}-panel`} role={accounts ? undefined : 'tabpanel'} aria-labelledby={accounts ? undefined : `${id}-${kind}`} tabIndex={accounts ? undefined : 0}>
      <ArchiveRecords key={accounts ? 'accounts' : kind} kind={accounts ? 'accounts' : kind} busy={busy} onBusyChange={setBusy} onChanged={onChanged} currentUserId={currentUserId} />
    </div>
  </section>;
}
