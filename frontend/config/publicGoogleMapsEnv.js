export function selectGoogleMapsKey(frontend = {}, backend = {}) {
  const names = ['VITE_GOOGLE_MAPS_API_KEY', 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'next_public_google_maps_api_key']
  for (const source of [frontend, backend]) {
    for (const name of names) {
      if (source[name]?.trim()) return source[name].trim()
    }
  }
  return ''
}
