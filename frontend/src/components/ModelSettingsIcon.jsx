const paths = {
  refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18a8 8 0 0 1-13-3',
  model: 'M8 8h8v8H8zM9 3v5m6-5v5M9 16v5m6-5v5M3 9h5m-5 6h5m8-6h5m-5 6h5',
  review: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  history: 'M3 4v5h5M4 9a9 9 0 1 1-1 7M12 7v5l3 2',
  previous: 'm14 6-6 6 6 6',
  next: 'm10 6 6 6-6 6',
  train: 'M4 7h16M4 17h16M8 3v8m8 2v8M8 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm8 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  register: 'M12 8v8m-4-4h8M5 3h14v18H5z',
  map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16',
  restore: 'M4 5v5h5M4 10a8 8 0 1 1 0 5',
  promote: 'M12 20V4m-6 6 6-6 6 6',
  reject: 'm6 6 12 12M6 18 18 6',
}

export default function ModelSettingsIcon({ name }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>
}
