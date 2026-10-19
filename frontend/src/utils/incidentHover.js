// Projected maps use their own screen coordinates. Keep a small hover card at
// the actual marker/cursor instead of positioning it with hidden Leaflet tiles.
let hoverId = 0
export function attachIncidentHover(element, layer, enabled) {
  if (!layer.options?.heatmapIncident) return null
  const id = `heatmap-incident-hover-${++hoverId}`
  let bubble
  function position(event) {
    if (!bubble) return
    const source = event?.domEvent || event
    const rect = (element.querySelector('.heatmap-incident-pin') || element).getBoundingClientRect()
    const x = Number.isFinite(source?.clientX) ? source.clientX : rect.left + rect.width / 2
    const y = Number.isFinite(source?.clientY) ? source.clientY : rect.top
    const bounds = bubble.getBoundingClientRect()
    bubble.style.left = `${Math.max(8, Math.min(x + 14, window.innerWidth - bounds.width - 8))}px`
    bubble.style.top = `${Math.max(8, Math.min(y - bounds.height - 10, window.innerHeight - bounds.height - 8))}px`
  }
  function hide() { bubble?.remove(); bubble = null; element.removeAttribute('aria-describedby') }
  function show(event) {
    if (!enabled() || (event?.domEvent || event)?.buttons) { hide(); return }
    if (!bubble) {
      const content = layer.getTooltip?.()?.getContent()
      if (!content?.cloneNode) return
      bubble = document.createElement('div')
      bubble.className = 'heatmap-incident-hover'
      bubble.id = id
      bubble.setAttribute('role', 'tooltip')
      element.setAttribute('aria-describedby', id)
      bubble.append(content.cloneNode(true))
      document.body.append(bubble)
    }
    position(event)
  }
  const escape = event => { if (event.key === 'Escape') hide() }
  const events = [['pointerenter', show], ['pointermove', show], ['pointerleave', hide],
    ['focusin', show], ['focusout', hide], ['gmp-pointerover', show], ['gmp-pointermove', show], ['gmp-pointerout', hide]]
  element.removeAttribute('title')
  element.setAttribute('aria-label', layer.options.title || 'Historical fire incident')
  element.tabIndex = 0
  events.forEach(([name, handler]) => element.addEventListener(name, handler))
  document.addEventListener('keydown', escape)
  return { hide, dispose() {
    hide()
    events.forEach(([name, handler]) => element.removeEventListener(name, handler))
    document.removeEventListener('keydown', escape)
  } }
}
