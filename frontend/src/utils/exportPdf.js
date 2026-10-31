// Incident register → PDF. Lazy-loaded by ExportModal, so jsPDF never lands in
// the main bundle. Colours here are document ink, not UI theme: a printed
// report is black-on-white whichever theme the dashboard is in.
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'

const INK   = [13, 21, 32]
const MUTED = [93, 106, 120]
const FIRE  = [232, 57, 13]
const RULE  = [208, 220, 232]
const HEAD  = [32, 37, 44]
const ZEBRA = [246, 248, 250]
const CARD  = [250, 251, 252]
const SEV_INK = { Critical: [197, 34, 34], Moderate: [176, 110, 0], Minor: [0, 122, 61] }

const M = 36            // page margin, pt (0.5in)
const HEADER_H = 26     // running header band on continuation pages
const FOOTER_H = 22

/** @returns {jsPDF} */
export function registerToPdf(doc, { paper = 'a4', orientation = 'landscape' } = {}) {
  const pdf = new jsPDF({ unit: 'pt', format: paper, orientation })
  pdf.setProperties({ title: doc.title, subject: doc.subject ?? 'Incident register', creator: 'FireTrackr' })
  const W = pdf.internal.pageSize.getWidth()
  const H = pdf.internal.pageSize.getHeight()
  const CW = W - 2 * M
  let y = M

  // ── Letterhead ──
  const [country, bureau, office] = doc.letterhead
  pdf.setTextColor(...MUTED).setFont('helvetica', 'normal').setFontSize(8)
  pdf.text(country, W / 2, y + 6, { align: 'center' })
  pdf.setTextColor(...INK).setFont('helvetica', 'bold').setFontSize(11.5)
  pdf.text(bureau.toUpperCase(), W / 2, y + 20, { align: 'center' })
  y += 20
  if (office) {
    pdf.setFont('helvetica', 'normal').setFontSize(9)
    pdf.text(office, W / 2, y + 13, { align: 'center' })
    y += 13
  }
  y += 10
  pdf.setDrawColor(...FIRE).setLineWidth(1.4).line(M, y, W - M, y)
  y += 22

  // ── Title + meta ──
  pdf.setTextColor(...INK).setFont('helvetica', 'bold').setFontSize(15)
  pdf.text(doc.title, M, y)
  pdf.setTextColor(...MUTED).setFont('helvetica', 'normal').setFontSize(8)
  pdf.text(`Generated ${doc.generatedAt}`, W - M, y, { align: 'right' })
  y += 14
  const filterLine = [...doc.filters.map(([k, v]) => `${k}: ${v}`), `Sorted by ${doc.sort}`].join('   ·   ')
  const wrapped = pdf.splitTextToSize(filterLine, CW)
  pdf.text(wrapped, M, y)
  y += wrapped.length * 10 + 8

  // ── Summary cards ──
  if (doc.summary) {
    const gap = 8
    const n = doc.summary.length
    const bw = (CW - gap * (n - 1)) / n
    const bh = 40
    doc.summary.forEach((s, i) => {
      const x = M + i * (bw + gap)
      pdf.setDrawColor(...RULE).setFillColor(...CARD).setLineWidth(0.6)
      pdf.roundedRect(x, y, bw, bh, 4, 4, 'FD')
      pdf.setTextColor(...(i === 0 ? FIRE : INK)).setFont('helvetica', 'bold').setFontSize(15)
      pdf.text(String(s.value), x + 10, y + 19)
      pdf.setTextColor(...MUTED).setFont('helvetica', 'normal').setFontSize(7)
      pdf.text(s.label.toUpperCase(), x + 10, y + 31)
    })
    y += bh + 14
  }

  if (doc.truncated) {
    pdf.setTextColor(...SEV_INK.Moderate).setFontSize(8)
    pdf.text(`Showing the first ${doc.rows.length} of ${doc.total} matching incidents. Narrow the filters to include the rest.`, M, y)
    y += 12
  }

  // ── Register table ──
  const weights = doc.columns.map(c => c.width)
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  const columnStyles = {}
  doc.columns.forEach((c, i) => {
    columnStyles[i] = { cellWidth: (CW * c.width) / sum, halign: c.align || 'left' }
  })
  const sevIdx = doc.columns.findIndex(c => c.key === 'sev')
  const idIdx = doc.columns.findIndex(c => c.key === 'id')
  const body = doc.rows.length
    ? doc.rows.map(r => r.cells)
    : [[{ content: 'No incidents match these filters.', colSpan: doc.columns.length,
          styles: { halign: 'center', textColor: MUTED, fontStyle: 'italic', cellPadding: 14 } }]]

  autoTable(pdf, {
    startY: y,
    head: [doc.columns.map(c => c.label)],
    body,
    theme: 'grid',
    margin: { left: M, right: M, top: M + HEADER_H, bottom: M + FOOTER_H - 10 },
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    styles: {
      font: 'helvetica', fontSize: 7.5, textColor: INK, lineColor: RULE, lineWidth: 0.4,
      cellPadding: { top: 4.5, bottom: 4.5, left: 5, right: 5 }, overflow: 'linebreak', valign: 'middle',
    },
    headStyles: { fillColor: HEAD, textColor: 255, fontStyle: 'bold', fontSize: 7.5, lineColor: HEAD },
    alternateRowStyles: { fillColor: ZEBRA },
    columnStyles,
    didParseCell: (d) => {
      if (d.section !== 'body' || !doc.rows.length) return
      if (d.column.index === sevIdx) {
        const ink = SEV_INK[doc.rows[d.row.index]?.sev]
        if (ink) { d.cell.styles.textColor = ink; d.cell.styles.fontStyle = 'bold' }
      } else if (d.column.index === idIdx) {
        d.cell.styles.fontStyle = 'bold'
      }
    },
  })
  y = pdf.lastAutoTable.finalY + 26

  // ── Signature block ──
  if (doc.showSignatures) {
    const blockH = 74
    if (y + blockH > H - M - FOOTER_H) {
      pdf.addPage()
      y = M + HEADER_H + 10
    }
    const colW = Math.min(220, (CW - 40) / 2)
    const slots = [
      { label: 'Prepared by:', name: doc.preparedBy, caption: 'Signature over printed name', x: M },
      { label: 'Noted by:', name: doc.notedBy, caption: 'Station Commander / Fire Marshal', x: W - M - colW },
    ]
    for (const s of slots) {
      pdf.setTextColor(...MUTED).setFont('helvetica', 'normal').setFontSize(8)
      pdf.text(s.label, s.x, y)
      const lineY = y + 38
      if (s.name) {
        pdf.setTextColor(...INK).setFont('helvetica', 'bold').setFontSize(9.5)
        pdf.text(s.name.toUpperCase(), s.x + colW / 2, lineY - 5, { align: 'center' })
      }
      pdf.setDrawColor(...INK).setLineWidth(0.6).line(s.x, lineY, s.x + colW, lineY)
      pdf.setTextColor(...MUTED).setFont('helvetica', 'normal').setFontSize(7)
      pdf.text(s.caption, s.x + colW / 2, lineY + 11, { align: 'center' })
    }
  }

  // ── Running header (continuation pages) + footer (every page) ──
  const pages = pdf.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p)
    if (p > 1) {
      pdf.setTextColor(...MUTED).setFont('helvetica', 'bold').setFontSize(7.5)
      pdf.text(doc.title, M, M + 8)
      pdf.setFont('helvetica', 'normal')
      pdf.text(doc.letterhead[doc.letterhead.length - 1], W - M, M + 8, { align: 'right' })
      pdf.setDrawColor(...RULE).setLineWidth(0.5).line(M, M + 14, W - M, M + 14)
    }
    const fy = H - M + 8
    pdf.setDrawColor(...RULE).setLineWidth(0.5).line(M, fy - 11, W - M, fy - 11)
    pdf.setTextColor(...MUTED).setFont('helvetica', 'normal').setFontSize(7)
    pdf.text(`Generated by FireTrackr  ·  ${doc.generatedAt}`, M, fy)
    pdf.text(`Page ${p} of ${pages}`, W - M, fy, { align: 'right' })
  }

  return pdf
}
