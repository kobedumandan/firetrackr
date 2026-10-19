export default function MapControlIcon({ name, ...props }) {
  const paths = {
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    street: <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5ZM9 3v16M15 5v16" /><path d="m4 12 4-2 8 4 4-2" /></>,
    dark: <path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z" />,
    satellite: <><path d="m4 20 6-9 4 5 3-4 4 8H4Z" /><circle cx="17" cy="6" r="2" /><path d="M3 4h5M3 7h3" /></>,
    cube: <><path d="m12 3 9 5v9l-9 5-9-5V8l9-5Z" /><path d="m3 8 9 5 9-5M12 13v9M7 5l10 6" /></>,
    camera: <><path d="m12 3 8 5v8l-8 5-8-5V8l8-5Z" /><path d="m4 8 8 5 8-5M12 13v8" /></>,
    up: <path d="m7 14 5-5 5 5" />,
    down: <path d="m7 10 5 5 5-5" />,
    left: <path d="M4 10a8 8 0 1 1 2 8M4 4v6h6" />,
    right: <path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" />,
    minus: <path d="M5 12h14" />,
    plus: <path d="M5 12h14M12 5v14" />,
    north: <><path d="m12 3 6 16-6-4-6 4 6-16Z" /><path d="M12 3v12" /></>,
    narrow: <><path d="M5 3v4l3 5-3 5v4M19 3v4l-3 5 3 5v4M12 3v4m0 3v4m0 3v4" /></>,
    traffic: <><path d="M5 21V3m14 18V3M9 3h6v5H9zM9 12h6v5H9zM12 20v1" /></>,
    edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15v5Z" /></>,
  }
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {paths[name] ?? paths.layers}
  </svg>
}
