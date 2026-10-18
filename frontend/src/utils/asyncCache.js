// Bounded, session-only cache. Concurrent consumers share one request. An
// invalidated in-flight response is never allowed to repopulate the cache.
export function createAsyncCache({ ttl = 300000, maxEntries = 12, now = Date.now } = {}) {
  const entries = new Map()
  return {
    get(key, fetcher) {
      const existing = entries.get(key)
      if (existing && (existing.pending || existing.expires > now())) return existing.promise
      const entry = { pending: true, expires: 0 }
      entry.promise = Promise.resolve().then(fetcher).then(value => {
        entry.pending = false
        entry.expires = now() + ttl
        return value
      }, error => {
        if (entries.get(key) === entry) entries.delete(key)
        throw error
      })
      entries.delete(key)
      entries.set(key, entry)
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value)
      return entry.promise
    },
    clear() { entries.clear() },
  }
}
