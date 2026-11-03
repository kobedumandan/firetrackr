// Incident register → DOCX. Lazy-loaded by ExportModal. Mirrors the PDF layout
// (exportPdf.js) so the preview is an honest stand-in for the Word file, but
// stays a normal editable document: real tables, real text, no images.
import {
  AlignmentType, BorderStyle, Document, Footer, Packer, PageNumber, PageOrientation,
  Paragraph, ShadingType, Table, TableCell, TableRow, TabStopType, TextRun,
  VerticalAlign, WidthType,
} from 'docx'

const INK = '0D1520'
const MUTED = '5D6A78'
const FIRE = 'E8390D'
const RULE = 'D0DCE8'
const HEAD = '20252C'
const ZEBRA = 'F6F8FA'
const CARD = 'FAFBFC'
const SEV_INK = { Critical: 'C52222', Moderate: 'B06E00', Minor: '007A3D' }

// Portrait twips; docx swaps them itself for landscape.
const PAPER = {
  a4:     { width: 11906, height: 16838 },
  letter: { width: 12240, height: 15840 },
  legal:  { width: 12240, height: 20160 },
}
const MARGIN = 720 // 0.5in

const line = (color, size = 4) => ({ style: BorderStyle.SINGLE, size, color })
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE }

const run = (text, o = {}) => new TextRun({ text, font: 'Arial', color: INK, size: 18, ...o })

function para(children, o = {}) {
  return new Paragraph({ children: Array.isArray(children) ? children : [children], ...o })
}

function cell(text, { width, fill, color = INK, bold = false, align = AlignmentType.LEFT, size = 15, span } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: span,
    verticalAlign: VerticalAlign.CENTER,
    shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
    margins: { top: 70, bottom: 70, left: 90, right: 90 },
    children: [para(run(text, { color, bold, size }), { alignment: align })],
  })
}

export async function registerToDocx(doc, { paper = 'a4', orientation = 'landscape' } = {}) {
  const size = PAPER[paper] ?? PAPER.a4
  const landscape = orientation === 'landscape'
  const pageW = landscape ? size.height : size.width
  const CW = pageW - 2 * MARGIN

  const [country, bureau, office] = doc.letterhead
  const children = [
    para(run(country, { color: MUTED, size: 16 }), { alignment: AlignmentType.CENTER }),
    para(run(bureau.toUpperCase(), { bold: true, size: 23 }), { alignment: AlignmentType.CENTER }),
  ]
  if (office) children.push(para(run(office, { size: 18 }), { alignment: AlignmentType.CENTER }))
  children.push(
    para([], { border: { bottom: line(FIRE, 12) }, spacing: { after: 280 } }),
    para([run(doc.title, { bold: true, size: 30 }), run(`\tGenerated ${doc.generatedAt}`, { color: MUTED, size: 16 })], {
      tabStops: [{ type: TabStopType.RIGHT, position: CW }],
      spacing: { after: 80 },
    }),
    para(run([...doc.filters.map(([k, v]) => `${k}: ${v}`), `Sorted by ${doc.sort}`].join('   ·   '), { color: MUTED, size: 16 }), {
      spacing: { after: 200 },
    }),
  )

  if (doc.summary) {
    const w = Math.floor(CW / doc.summary.length)
    children.push(new Table({
      width: { size: CW, type: WidthType.DXA },
      columnWidths: doc.summary.map(() => w),
      borders: { top: line(RULE), bottom: line(RULE), left: line(RULE), right: line(RULE),
                 insideHorizontal: line(RULE), insideVertical: line(RULE) },
      rows: [new TableRow({
        children: doc.summary.map((s, i) => new TableCell({
          width: { size: w, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: CARD },
          margins: { top: 90, bottom: 90, left: 140, right: 140 },
          children: [
            para(run(String(s.value), { bold: true, size: 30, color: i === 0 ? FIRE : INK })),
            para(run(s.label.toUpperCase(), { color: MUTED, size: 14 })),
          ],
        })),
      })],
    }))
    children.push(para([], { spacing: { after: 200 } }))
  }

  if (doc.truncated) {
    children.push(para(run(
      `Showing the first ${doc.rows.length} of ${doc.total} matching incidents. Narrow the filters to include the rest.`,
      { color: SEV_INK.Moderate, size: 16 }), { spacing: { after: 120 } }))
  }

  // ── Register table ──
  const sum = doc.columns.reduce((a, c) => a + c.width, 0) || 1
  const widths = doc.columns.map(c => Math.floor((CW * c.width) / sum))
  const alignOf = c => (c.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT)
  const head = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: doc.columns.map((c, i) => cell(c.label, { width: widths[i], fill: HEAD, color: 'FFFFFF', bold: true, align: alignOf(c) })),
  })
  const body = doc.rows.length
    ? doc.rows.map((r, ri) => new TableRow({
        cantSplit: true,
        children: doc.columns.map((c, i) => cell(r.cells[i], {
          width: widths[i],
          fill: ri % 2 ? ZEBRA : undefined,
          color: c.key === 'sev' ? (SEV_INK[r.sev] ?? INK) : INK,
          bold: c.key === 'sev' || c.key === 'id',
          align: alignOf(c),
        })),
      }))
    : [new TableRow({ children: [cell('No incidents match these filters.', {
        width: CW, span: doc.columns.length, color: MUTED, align: AlignmentType.CENTER })] })]

  children.push(new Table({
    width: { size: CW, type: WidthType.DXA },
    columnWidths: widths,
    borders: { top: line(RULE), bottom: line(RULE), left: line(RULE), right: line(RULE),
               insideHorizontal: line(RULE), insideVertical: line(RULE) },
    rows: [head, ...body],
  }))

  // ── Signature block ──
  if (doc.showSignatures) {
    children.push(para([], { spacing: { after: 480 } }))
    const colW = Math.floor(CW / 2)
    const slot = (label, name, caption) => new TableCell({
      width: { size: colW, type: WidthType.DXA },
      margins: { left: 0, right: 600 },
      children: [
        para(run(label, { color: MUTED, size: 16 }), { spacing: { after: 360 } }),
        para(run((name || '').toUpperCase() || ' ', { bold: true, size: 19 }), {
          alignment: AlignmentType.CENTER, border: { bottom: line(INK, 6) },
        }),
        para(run(caption, { color: MUTED, size: 14 }), { alignment: AlignmentType.CENTER }),
      ],
    })
    children.push(new Table({
      width: { size: CW, type: WidthType.DXA },
      columnWidths: [colW, colW],
      borders: noBorders,
      rows: [new TableRow({ cantSplit: true, children: [
        slot('Prepared by:', doc.preparedBy, 'Signature over printed name'),
        slot('Noted by:', doc.notedBy, 'Station Commander / Fire Marshal'),
      ] })],
    }))
  }

  const footer = new Footer({
    children: [para([
      run(`Generated by FireTrackr  ·  ${doc.generatedAt}`, { color: MUTED, size: 14 }),
      new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: 'Arial', color: MUTED, size: 14 }),
    ], { tabStops: [{ type: TabStopType.RIGHT, position: CW }], border: { top: line(RULE) } })],
  })

  const file = new Document({
    creator: 'FireTrackr',
    title: doc.title,
    description: doc.subject ?? 'Incident register',
    styles: { default: { document: { run: { font: 'Arial', size: 18, color: INK } } } },
    sections: [{
      properties: {
        page: {
          size: { width: size.width, height: size.height,
                  orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, footer: 360 },
        },
      },
      footers: { default: footer },
      children,
    }],
  })
  return Packer.toBlob(file)
}
