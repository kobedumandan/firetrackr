import { Document, Packer, Paragraph, TextRun, Header, Footer, PageNumber, PageOrientation, BorderStyle, HeadingLevel, TabStopType, Table, TableRow, TableCell, WidthType, ImageRun, ShadingType, AlignmentType, TableLayoutType, HeightRule } from 'docx'
import { reportSectionContent } from './incidentReportExport'
import { TEAM_ICON } from './reportTeamIcon'
import { STAGE_ICONS } from './reportStageIcons'
import { reportTitleCase, stagePercent } from './reportAnalysisLayout'

const PAPER = { a4: [11906, 16838], letter: [12240, 15840], legal: [12240, 20160] }
const run = (text, options = {}) => new TextRun({ text: String(text), font: 'Arial', size: 20, color: text === '-' ? '959DA7' : '17212B', ...options })
const para = (text, options = {}, runOptions = {}) => new Paragraph({
  children: [run(text, runOptions)], spacing: { after: 140, line: 290 }, ...options,
})

function analysisCards(breakdown, width) {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const borders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }
  const cards = new Table({
    width: { size: width, type: WidthType.DXA }, layout: TableLayoutType.FIXED,
    columnWidths: breakdown.cards.map(() => Math.floor(width / breakdown.cards.length)),
    rows: [new TableRow({ cantSplit: true, children: breakdown.cards.map(card => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: 'F7F8FA' }, margins: { top: 140, bottom: 160, left: 60, right: 60 },
      children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new ImageRun({ type: 'png', data: STAGE_ICONS[card.key], transformation: { width: 20, height: 20 } })] }),
        para(card.label, { alignment: AlignmentType.CENTER, spacing: { after: 120 } }, { size: 16, bold: true, color: '647180' }),
        para(card.value, { alignment: AlignmentType.CENTER, spacing: { after: 0 } }, { size: card.value === 'Not applicable' ? 21 : 36, bold: true })],
    })) })],
  })
  const result = [cards, para(`Stage Time Distribution | ${breakdown.hasData ? breakdown.totalLabel + ' of available stage time' : 'No positive stage durations available'}`, { spacing: { before: 200, after: 120 }, keepNext: true }, { size: 18, bold: true })]
  if (breakdown.hasData) {
    let assigned = 0
    const widths = breakdown.segments.map((segment, index) => {
      const cellWidth = index === breakdown.segments.length - 1 ? width - assigned : Math.round(width * segment.percent / 100)
      assigned += cellWidth
      return cellWidth
    })
    result.push(new Table({
      width: { size: width, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, borders,
      rows: [new TableRow({ cantSplit: true, height: { value: 260, rule: HeightRule.EXACT }, children: breakdown.segments.map((segment, index) => new TableCell({
        width: { size: widths[index], type: WidthType.DXA }, borders,
        margins: { top: 0, bottom: 0, left: 0, right: 0 }, shading: { type: ShadingType.CLEAR, fill: segment.color },
        children: [para('', { spacing: { before: 0, after: 0, line: 20 } }, { size: 2 })],
      })) })],
    }))
    result.push(new Paragraph({ spacing: { before: 140, after: 140 }, children: breakdown.segments.flatMap(segment => [run('● ', { color: segment.color, size: 18 }), run(`${segment.label} ${stagePercent(segment.percent)}   `, { size: 16, color: '647180' })]) }))
  }
  result.push(para('Percentages use the sum of available stage durations. Missing stages are omitted; zero-duration stages contribute no width.', {}, { size: 16, color: '647180' }))
  return result
}

// Native text and headings keep the Word report fully editable.
export async function incidentReportToDocx(report, { paper = 'a4', orientation = 'portrait' } = {}) {
  const [width, height] = PAPER[paper] || PAPER.a4
  const landscape = orientation === 'landscape'
  const contentWidth = (landscape ? height : width) - 1680
  const children = [
    para('REPUBLIC OF THE PHILIPPINES', {}, { size: 16, color: '647180' }),
    para('BUREAU OF FIRE PROTECTION', { border: { bottom: { style: BorderStyle.SINGLE, color: 'BD351B', size: 14, space: 12 } }, spacing: { after: 360 } }, { size: 24, bold: true }),
    para(report.title, { heading: HeadingLevel.TITLE, spacing: { after: 180 } }, { size: 46, bold: true }),
    para(`${report.classification || report.title} | ${report.incidentId} | Status: ${report.status || '-'}`, {}, { size: 18, color: 'BD351B' }),
    para(report.location || '-', {}, { size: 24 }),
    para(`Prepared ${report.generatedAt} (Asia/Manila)`, { spacing: { after: 320 } }, { size: 16, color: '647180' }),
  ]
  function renderSection(section, index = null) {
    const output = []
    if (index != null) output.push(new Paragraph({ children: [run(`${String(index + 1).padStart(2, '0')}  `, { size: 26, bold: true, color: 'BD351B' }), run(reportTitleCase(section.title), { size: 26, bold: true })],
      heading: HeadingLevel.HEADING_1, keepNext: true,
      spacing: { before: 260, after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, color: 'DCE1E6', size: 4, space: 6 } },
    }))
    const body = []
    if (section.introduction) body.push(para(section.introduction, { widowControl: true, keepNext: true, spacing: { after: 200, line: 300 } }))
    if (section.stageBreakdown) body.push(...analysisCards(section.stageBreakdown, section.blockHeader ? contentWidth - 360 : contentWidth))
    for (const block of section.reportBlocks || []) body.push(...renderSection(block))
    if (section.table) {
      const border = { style: BorderStyle.SINGLE, color: 'DCE1E6', size: 4 }
      const tableCell = (value, header = false) => new TableCell({ margins: { top: 100, bottom: 100, left: 120, right: 120 }, shading: header ? { type: ShadingType.CLEAR, fill: 'EEF1F5' } : undefined, children: [para(value, { spacing: { after: 0, line: 260 } }, { size: 18, bold: header })] })
      body.push(new Table({ width: { size: contentWidth, type: WidthType.DXA }, columnWidths: [Math.round(contentWidth * 0.38), Math.round(contentWidth * 0.27), Math.round(contentWidth * 0.35)], borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border }, rows: [new TableRow({ tableHeader: true, children: section.table.columns.map(value => tableCell(value, true)) }), ...section.table.rows.map(row => new TableRow({ cantSplit: true, children: row.map(value => tableCell(value)) }))] }), new Paragraph({ spacing: { after: 160 } }))
    }
    const { facts, paragraphs } = reportSectionContent(section)
    for (const [label, value] of facts) body.push(new Paragraph({
      children: [run(`${label}: `, { bold: true, color: '647180', size: 18 }), run(value)],
      spacing: { after: 120, line: 280 }, widowControl: true,
    }))
    for (const [label, value] of paragraphs) {
      body.push(para(label, { heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 180, after: 80 } }, { bold: true, size: 21 }))
      for (const line of value.split(/\r?\n/)) body.push(para(line, { widowControl: true }))
    }
    for (const team of section.teams || []) {
      const border = { style: BorderStyle.SINGLE, color: 'DCE1E6', size: 4 }
      const crewCell = (value, header = false) => new TableCell({
        shading: header ? { type: ShadingType.CLEAR, fill: 'EEF1F5' } : undefined,
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        children: [para(value, { spacing: { after: 0, line: 260 } }, { size: 18, bold: header })],
      })
      const roster = new Table({
        width: { size: contentWidth - 360, type: WidthType.DXA },
        columnWidths: [Math.floor((contentWidth - 360) * 0.65), Math.ceil((contentWidth - 360) * 0.35)],
        borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
        rows: [new TableRow({ tableHeader: true, children: [crewCell('Name', true), crewCell('Team Role', true)] }),
          ...(team.crew.length ? team.crew.map(member => new TableRow({ cantSplit: true, children: [crewCell(member.name), crewCell(member.role)] }))
            : [new TableRow({ children: [new TableCell({ columnSpan: 2, children: [para('No crew roster recorded', {}, { size: 18, color: '959DA7', italics: true })] })] })])],
      })
      body.push(new Table({
        width: { size: contentWidth, type: WidthType.DXA },
        borders: { top: border, bottom: border, left: border, right: border },
        rows: [new TableRow({ children: [new TableCell({
          margins: { top: 180, bottom: 140, left: 180, right: 180 },
          children: [new Paragraph({
            keepNext: true, spacing: { after: 180 },
            children: [new ImageRun({ type: 'png', data: TEAM_ICON, transformation: { width: 24, height: 24 } }), run(`  ${team.title} / ${team.reference}`, { bold: true, size: 23 })],
          }), para(team.introduction, { keepNext: true, widowControl: true }),
          para(team.explanation, { keepNext: true, widowControl: true }, { color: '647180', size: 18 }), roster, new Paragraph({ spacing: { after: 0 } })],
        })] })],
      }), new Paragraph({ spacing: { after: 180 } }))
    }
    if (section.explanation) body.push(para(section.explanation, { widowControl: true, spacing: { before: 100, after: 240, line: 280 } }, { size: 18, color: '647180' }))
    if (section.blockHeader) {
      const border = { style: BorderStyle.SINGLE, color: 'DCE1E6', size: 4 }
      output.push(new Table({ width: { size: contentWidth, type: WidthType.DXA }, borders: { top: border, bottom: border, left: border, right: border }, rows: [new TableRow({ children: [new TableCell({ margins: { top: 180, bottom: 180, left: 180, right: 180 }, children: [new Paragraph({ keepNext: true, spacing: { after: 180 }, children: [new ImageRun({ type: 'png', data: TEAM_ICON, transformation: { width: 24, height: 24 } }), run(`  ${section.blockHeader}`, { bold: true, size: 24 })] }), ...body] })] })] }), new Paragraph({ spacing: { after: 180 } }))
    } else output.push(...body)
    return output
  }
  report.sections.forEach((section, index) => children.push(...renderSection(section, index)))
  if (report.signatures) {
    children.push(para('Approval & Acknowledgment', { heading: HeadingLevel.HEADING_1, keepNext: true, spacing: { before: 400 } }, { bold: true, size: 26 }))
    children.push(para('The signature lines below provide space for the preparer and reviewing officer to acknowledge this document. Names may be completed before export or entered when the report is filed.', { keepNext: true }))
    children.push(para('A printed name alone does not indicate that the report has been signed or approved.', { keepNext: true }, { size: 18, color: '647180' }))
    for (const [label, name] of [['Prepared by', report.preparedBy], ['Noted by', report.notedBy]]) {
      children.push(para(label, { keepNext: true, spacing: { before: 220, after: 400 } }, { size: 18, color: '647180' }))
      children.push(para(name || '________________________________', { keepNext: true }, { bold: true }))
      children.push(para('Signature over printed name', {}, { size: 16, color: '647180' }))
    }
  }
  return Packer.toBlob(new Document({
    creator: 'FireTrackr', title: report.title,
    styles: { default: { document: { run: { font: 'Arial', size: 20, color: '17212B' } } } },
    sections: [{
      properties: { page: {
        size: { width, height, orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
        margin: { top: 840, bottom: 840, left: 840, right: 840, header: 360, footer: 360 },
      } },
      headers: { default: new Header({ children: [para(`${report.incidentId} | ${report.classification || 'Incident Report'}`, {}, { size: 16, color: '647180' })] }) },
      footers: { default: new Footer({ children: [new Paragraph({
        children: [run('FireTrackr | Times in Asia/Manila', { size: 16, color: '647180' }),
          new TextRun({ children: ['\t', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], font: 'Arial', size: 16 })],
        tabStops: [{ type: TabStopType.RIGHT, position: contentWidth }],
      })] }) }, children,
    }],
  }))
}
