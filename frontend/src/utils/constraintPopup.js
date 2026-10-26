// Use DOM text nodes for road data; popup actions share Leaflet's event model
// across the standard, tilted raster and Google 3D maps.
function element(tag, className, text) {
  const node = document.createElement(tag)
  node.className = className
  if (text != null) node.textContent = text
  return node
}

export function createConstraintPopup(properties, onEdit) {
  const card = element('div', 'constraint-popup-card')
  card.style.setProperty('--constraint-color', properties.color || '#c47800')
  const header = element('div', 'constraint-popup-header')
  header.append(element('span', 'constraint-popup-dot'), element('span', 'constraint-popup-type', properties.hoverLabel || 'Road constraint'))
  card.append(header, element('h3', 'constraint-popup-name', properties.roadName || properties.hoverLocation || 'Unnamed road'))
  if (properties.barangay) card.append(element('p', 'constraint-popup-location', properties.barangay))
  card.append(element('span', 'constraint-popup-source', properties.source || 'Road constraint'))
  if (properties.hoverMeta) card.append(element('p', 'constraint-popup-meta', properties.hoverMeta))
  if (properties.narrowSeverity) card.append(element('p', 'constraint-popup-detail', `${properties.narrowSeverity === 'severe' ? 'Severe' : 'Slight'} narrow road`))
  if (properties.trafficSummary) card.append(element('p', 'constraint-popup-detail', properties.trafficSummary))
  if (onEdit) {
    const button = element('button', 'constraint-popup-edit', 'Edit Constraint')
    button.type = 'button'
    button.addEventListener('click', event => { event.stopPropagation(); onEdit() })
    card.append(button)
  }
  card.addEventListener('click', event => event.stopPropagation())
  card.addEventListener('dblclick', event => event.stopPropagation())
  return card
}

export function openConstraintPopup(leaflet, L, properties, latlng, screenAnchor) {
  if (properties.constraintEditing === true || properties.constraintEditing === 'true') {
    leaflet.closePopup()
    leaflet.fire('constraintpick', { key: properties.constraintKey, edit: false })
    return
  }
  const onEdit = properties.constraintKey ? () => {
    leaflet.closePopup()
    leaflet.fire('constraintpick', { key: properties.constraintKey, edit: true })
  } : null
  L.popup({ autoPan: false, className: 'constraint-road-popup', maxWidth: 300, minWidth: 240, ...(screenAnchor ? { screenAnchor } : {}) })
    .setLatLng(latlng).setContent(createConstraintPopup(properties, onEdit)).openOn(leaflet)
}
