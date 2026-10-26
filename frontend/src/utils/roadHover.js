// Position road details at the renderer's cursor, independent of Leaflet's camera.
export function createRoadHover() {
  let bubble
  let contentKey
  function hide() { bubble?.remove(); bubble = null; contentKey = null }
  function show(road, event) {
    const pointer = event?.domEvent || event?.originalEvent || event
    if (!road?.title || pointer?.buttons || !Number.isFinite(pointer?.clientX) || !Number.isFinite(pointer?.clientY)) {
      hide()
      return
    }
    if (!bubble) {
      bubble = document.createElement('div')
      bubble.className = 'command-road-tooltip'
      bubble.setAttribute('role', 'tooltip')
      document.body.append(bubble)
    }
    const nextKey = JSON.stringify([road.hoverLabel, road.hoverLocation, road.hoverMeta, road.title])
    if (contentKey !== nextKey) {
      bubble.style.setProperty('--constraint-color', road.color || '#c47800')
      const heading = document.createElement('div')
      heading.className = 'command-road-tooltip-label'
      heading.textContent = road.hoverLabel || road.title
      const lines = [heading]
      for (const [className, text] of [['location', road.hoverLocation], ['meta', road.hoverMeta]]) {
        if (!text) continue
        const line = document.createElement('div')
        line.className = `command-road-tooltip-${className}`
        line.textContent = text
        lines.push(line)
      }
      bubble.replaceChildren(...lines)
      contentKey = nextKey
    }
    const bounds = bubble.getBoundingClientRect()
    bubble.style.left = `${Math.max(8, Math.min(pointer.clientX + 14, window.innerWidth - bounds.width - 8))}px`
    bubble.style.top = `${Math.max(8, Math.min(pointer.clientY - bounds.height - 10, window.innerHeight - bounds.height - 8))}px`
  }
  const onKey = event => { if (event.key === 'Escape') hide() }
  document.addEventListener('keydown', onKey)
  return { show, hide, dispose() { hide(); document.removeEventListener('keydown', onKey) } }
}
