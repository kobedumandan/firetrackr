const PATHS = {
  response: 'M12 8v4l3 2M9 3h6M12 3v2M19 5l1 1',
  handling: 'M8 3h8v4H8zM8 11h8M8 15h5M6 5H4v16h16V5h-2',
  processing: 'M8 3h8v4H8zM8 11h8M8 15h5M6 5H4v16h16V5h-2',
  acknowledgement: 'm7 12 3 3 7-7M21 12a9 9 0 1 1-5-8',
  turnout: 'M4 4h9v16H4zM9 12h12m-4-4 4 4-4 4',
  preparation: 'M9 20h6M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3M12 2v2',
  travel: 'M4 17h16M6 17v-4l2-5h8l2 5v4M6 13h12M8 17v3m8-3v3M8 6l1-2h6l1 2',
  suppression: 'M12 3c1 4-3 5-3 8 0 1 1 2 2 2 2 0 3-2 3-4 3 2 5 5 5 7a7 7 0 0 1-14 0c0-3 2-5 3-6M12 16c-2 2-2 4 0 5 2-1 2-3 0-5',
  filter: 'M4 6h16M7 12h10M10 18h4',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18a8 8 0 0 1-13-3',
  download: 'M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5',
  chevron: 'm9 5 7 7-7 7',
  chart: 'M4 4v16h16M8 15l4-5 4 2 4-7',
  coverage: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10M12 11v2',
  info: 'M12 11v6M12 7v1',
}

export default function AnalysisIcon({ name, className = '' }) {
  return <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'response' && <circle cx="12" cy="13" r="8" />}{name === 'info' && <circle cx="12" cy="12" r="9" />}<path d={PATHS[name]} />
  </svg>
}
