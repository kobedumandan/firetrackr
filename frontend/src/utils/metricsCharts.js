const PALETTE = ['#ffad33', '#ff4d1a', '#dc3447', '#9b59b6', '#64748b']
export const MAP_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444']

export function mapBuckets(maxCount) {
  const m = Math.max(maxCount, 4)
  const a = Math.max(1, Math.round(m * .25)), b = Math.max(a + 1, Math.round(m * .5)), c = Math.max(b + 1, Math.round(m * .75))
  return [{ max: a, label: `0-${a}` }, { max: b, label: `${a + 1}-${b}` }, { max: c, label: `${b + 1}-${c}` }, { max: Infinity, label: `${c + 1}+` }]
}

export function drawMonthlyChart(pdf, rows, accent, values) {
  if (!rows.length) { pdf.text('No monthly data available.', 40, 145); return }
  const left = 65, top = 120, width = 600, height = 165, max = Math.max(1, Math.ceil(Math.max(0, ...rows.map(row => row.count)) / 4)) * 4
  pdf.setFontSize(9); pdf.setTextColor('#58677a'); pdf.setDrawColor('#dce1e8'); pdf.setLineWidth(.5)
  for (let tick = 0; tick <= 4; tick++) {
    const y = top + height - tick / 4 * height
    pdf.line(left, y, left + width, y); pdf.text(String(Math.round(max * tick / 4)), left - 10, y + 3, { align: 'right' })
  }
  const points = rows.map((row, i) => [left + (rows.length === 1 ? width / 2 : i / (rows.length - 1) * width), top + height - row.count / max * height])
  pdf.setDrawColor(accent); pdf.setLineWidth(2)
  points.forEach(([x, y], i) => {
    if (i) pdf.line(...points[i - 1], x, y)
    pdf.setFillColor(accent); pdf.circle(x, y, 2.5, 'F')
    pdf.setFontSize(8); pdf.setTextColor('#182333')
    if (values) pdf.text(String(rows[i].count), x, y - 8, { align: 'center' })
    pdf.setTextColor('#58677a'); pdf.text(rows[i].month, x, 305, { align: 'center', maxWidth: 45 })
  })
}

export function drawAlarmDonut(pdf, rows, values) {
  const total = rows.reduce((sum, row) => sum + row[1], 0)
  if (!total) { pdf.text('No alarm-level data available.', 40, 145); return }
  let angle = -Math.PI / 2
  const cx = 175, cy = 205, radius = 90
  rows.forEach(([label, count], i) => {
    const end = angle + count / total * Math.PI * 2
    const ops = [{ op: 'm', c: [cx, cy] }, { op: 'l', c: [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] }]
    for (let a = angle; a < end; a += .035) ops.push({ op: 'l', c: [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius] })
    ops.push({ op: 'l', c: [cx + Math.cos(end) * radius, cy + Math.sin(end) * radius] }, { op: 'h', c: [] })
    const color = label === 'Not recorded' ? PALETTE.at(-1) : PALETTE[i % PALETTE.length]
    pdf.setFillColor(color); pdf.path(ops); pdf.fill()
    const y = 120 + i * 27
    pdf.rect(320, y - 8, 8, 8, 'F'); pdf.setTextColor('#182333'); pdf.setFontSize(10)
    pdf.text(pdf.splitTextToSize(label, 215).slice(0, 2), 340, y)
    if (values) pdf.text(`${count} (${(count / total * 100).toFixed(1)}%)`, 680, y, { align: 'right' })
    angle = end
  })
  pdf.setFillColor('#ffffff'); pdf.circle(cx, cy, 62, 'F')
  pdf.setTextColor('#182333'); pdf.setFontSize(26); pdf.text(String(total), cx, cy, { align: 'center' })
  pdf.setTextColor('#58677a'); pdf.setFontSize(10); pdf.text('Incidents', cx, cy + 19, { align: 'center' })
}

export function drawCauseBars(pdf, rows, accent, values) {
  if (!rows.length) { pdf.text('No cause data available.', 40, 145); return }
  const max = Math.max(1, ...rows.map(row => row[1]))
  rows.forEach(([label, count], i) => {
    const y = 114 + i * 21
    pdf.setFontSize(8); pdf.setTextColor('#182333')
    // Keep the visual compact; the optional data table preserves full source labels.
    const lines = pdf.splitTextToSize(label, 315)
    const text = lines.length > 1 ? `${lines[0].slice(0, -3)}...` : lines[0]
    pdf.text(text, 30, y + 7)
    pdf.setFillColor('#edf0f4'); pdf.roundedRect(355, y, 290, 9, 2, 2, 'F')
    pdf.setFillColor(accent)
    if (count > 0) pdf.roundedRect(355, y, count / max * 290, 9, 2, 2, 'F')
    if (values) pdf.text(String(count), 685, y + 8, { align: 'right' })
  })
}

// Project local GeoJSON into a north-up thematic map without requesting map tiles.
export function drawBarangayMap(pdf, geojson, counts, values) {
  const features = (geojson?.features ?? []).filter(f => ['Polygon', 'MultiPolygon'].includes(f.geometry?.type))
  const polygons = feature => feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
  const project = ([lon, lat]) => [lon * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360))]
  const points = features.flatMap(f => polygons(f).flatMap(p => p.flatMap(ring => ring.map(project)))).filter(p => p.every(Number.isFinite))
  if (!points.length) { pdf.text('Barangay boundaries unavailable. Rankings remain available.', 30, 140); return }
  const bounds = points.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity])
  const [minX, minY, maxX, maxY] = bounds
  const scale = Math.min(380 / Math.max(1e-9, maxX - minX), 205 / Math.max(1e-9, maxY - minY))
  const transform = coord => { const [x, y] = project(coord); return [40 + (x - minX) * scale, 110 + (maxY - y) * scale] }
  const buckets = mapBuckets(Math.max(0, ...Object.values(counts)))
  pdf.setLineWidth(.7)
  features.forEach(feature => {
    const count = counts[feature.properties?.brgy_name] ?? 0
    const color = MAP_COLORS[buckets.findIndex(bucket => count <= bucket.max)]
    pdf.setFillColor(color); pdf.setDrawColor('#ffffff')
    for (const polygon of polygons(feature)) {
      const ops = polygon.flatMap(ring => [...ring.map((coord, i) => ({ op: i ? 'l' : 'm', c: transform(coord) })), { op: 'h', c: [] }])
      pdf.path(ops); pdf.fillStrokeEvenOdd()
    }
  })
  pdf.setFontSize(9)
  buckets.forEach((bucket, i) => { pdf.setFillColor(MAP_COLORS[i]); pdf.rect(450, 120 + i * 25, 9, 9, 'F'); pdf.setTextColor('#182333'); pdf.text(`${bucket.label} incidents`, 470, 128 + i * 25) })
  if (values) {
    pdf.setFontSize(8); pdf.setTextColor('#58677a')
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
    top.forEach(([name, count], i) => {
      pdf.text(pdf.splitTextToSize(name, 180)[0], 450, 215 + i * 12)
      pdf.text(String(count), 685, 215 + i * 12, { align: 'right' })
    })
  }
}
