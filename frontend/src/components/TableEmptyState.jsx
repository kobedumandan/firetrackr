import '../styles/TableEmptyState.css';

export default function TableEmptyState({ className = '', icon, title, message, onClearFilters, children }) {
  return <div className={`table-empty-state ${className}`}>
    <div className="table-empty-icon"><span className="material-symbols-outlined" aria-hidden="true">{icon}</span></div>
    <div className="table-empty-title">{title}</div>
    <div className="table-empty-sub">{message}</div>
    {onClearFilters && <button type="button" className="table-empty-clear" data-compact-action="reset-filter" onClick={onClearFilters}>Clear filters</button>}
    {children}
  </div>;
}
