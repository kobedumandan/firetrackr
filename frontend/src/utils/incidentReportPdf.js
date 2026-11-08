import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { reportSectionContent } from './incidentReportExport'
import { TEAM_ICON } from './reportTeamIcon'
import { STAGE_ICONS } from './reportStageIcons'
import { reportTitleCase, stagePercent } from './reportAnalysisLayout'

// Open fact columns and full-width prose, with explicit page flow for long reports.
export function incidentReportToPdf(report, { paper = 'a4', orientation = 'portrait' } = {}) {
  const pdf = new jsPDF({ unit: 'pt', format: paper, orientation })
  const width = pdf.internal.pageSize.getWidth(), height = pdf.internal.pageSize.getHeight()
  const margin = 42, contentWidth = width - margin * 2, bottom = height - 48
  const ink = '#17212B', muted = '#647180', accent = '#BD351B'
  const valueColor = value => value === '-' ? '#959DA7' : ink
  let y = 44
  pdf.setProperties({ title: `${report.title} - ${report.incidentId}`, creator: 'FireTrackr' })
  function style(size = 10, bold = false, color = ink) {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(color)
  }
  function space(amount) {
    if (y + amount > bottom) { pdf.addPage(); y = 50 }
  }
  function text(value, { size = 10, bold = false, color = ink, leading = 15, after = 8 } = {}) {
    style(size, bold, color)
    const lines = pdf.splitTextToSize(String(value), contentWidth)
    for (const line of lines) {
      space(leading)
      pdf.text(line, margin, y)
      y += leading
    }
    y += after
  }
  text('REPUBLIC OF THE PHILIPPINES', { size: 8, color: muted, leading: 12, after: 2 })
  text('BUREAU OF FIRE PROTECTION', { size: 12, bold: true, leading: 18, after: 8 })
  pdf.setDrawColor(accent).setLineWidth(2).line(margin, y, width - margin, y)
  y += 24
  text(report.title, { size: 23, bold: true, leading: 28, after: 6 })
  text(`${report.classification || report.title}  |  ${report.incidentId}  |  Status: ${report.status || '-'}`, { size: 9, color: accent, after: 4 })
  text(report.location || '-', { size: 12, color: valueColor(report.location || '-'), leading: 17, after: 4 })
  text(`Prepared ${report.generatedAt} (Asia/Manila)`, { size: 8, color: muted, after: 16 })
  function renderSection(section, index = null) {
    space(section.stageBreakdown ? 390 : section.blockHeader ? 210 : 135)
    if (index != null) {
    y += 8
    style(13, true, accent)
    pdf.text(String(index + 1).padStart(2, '0'), margin, y)
    style(13, true)
    const heading = pdf.splitTextToSize(reportTitleCase(section.title), contentWidth - 30)
    pdf.text(heading, margin + 30, y, { lineHeightFactor: 1.4 })
    y += heading.length * 18 + 4
    pdf.setDrawColor('#DCE1E6').setLineWidth(0.5).line(margin, y, width - margin, y)
    y += 16
    }
    const blockStart = section.blockHeader ? { page: pdf.getNumberOfPages(), y: y - 10 } : null
    if (section.blockHeader) {
      style(11, true)
      const lines = pdf.splitTextToSize(section.blockHeader, contentWidth - 50)
      const height = Math.max(40, lines.length * 14 + 18)
      pdf.setFillColor('#F7F8FA').roundedRect(margin, y - 3, contentWidth, height, 4, 4, 'F')
      pdf.addImage(TEAM_ICON, 'PNG', margin + 8, y + 3, 24, 24)
      pdf.text(lines, margin + 42, y + 13, { lineHeightFactor: 1.3 })
      y += height + 12
    }
    if (section.introduction) text(section.introduction, { leading: 16, after: 14 })
    if (section.stageBreakdown) {
      const breakdown = section.stageBreakdown
      space(210)
      const gap = 8, cardWidth = (contentWidth - gap * (breakdown.cards.length - 1)) / breakdown.cards.length
      breakdown.cards.forEach((card, index) => {
        const x = margin + index * (cardWidth + gap)
        pdf.setFillColor('#F7F8FA').setDrawColor('#E1E5EA').roundedRect(x, y, cardWidth, 92, 5, 5, 'FD')
        pdf.addImage(STAGE_ICONS[card.key], 'PNG', x + 8, y + 8, 20, 20)
        style(8, true, muted)
        pdf.text(card.label, x + cardWidth / 2, y + 42, { align: 'center' })
        style(card.value === 'Not applicable' ? 11 : 18, true, valueColor(card.value))
        pdf.text(card.value, x + cardWidth / 2, y + 70, { align: 'center' })
      })
      y += 112
      text(`Stage Time Distribution | ${breakdown.hasData ? breakdown.totalLabel + ' of available stage time' : 'No positive stage durations available'}`, { size: 9, bold: true, leading: 14, after: 6 })
      pdf.setFillColor('#EEF1F5').roundedRect(margin, y, contentWidth, 16, 4, 4, 'F')
      let x = margin
      breakdown.segments.forEach(segment => {
        const segmentWidth = contentWidth * segment.percent / 100
        pdf.setFillColor(`#${segment.color}`).rect(x, y, segmentWidth, 16, 'F')
        x += segmentWidth
      })
      y += 34
      breakdown.segments.forEach((segment, index) => {
        const x = margin + (index % 2) * (contentWidth / 2)
        const rowY = y + Math.floor(index / 2) * 18
        pdf.setFillColor(`#${segment.color}`).circle(x + 3, rowY - 3, 3, 'F')
        style(8.5, false, muted)
        pdf.text(`${segment.label} ${stagePercent(segment.percent)}`, x + 12, rowY)
      })
      y += Math.ceil(breakdown.segments.length / 2) * 18 + 8
      text('Percentages use the sum of available stage durations. Missing stages are omitted; zero-duration stages contribute no width.', { size: 8, color: muted, leading: 12, after: 14 })
    }
    for (const block of section.reportBlocks || []) renderSection(block)
    if (section.table) {
      space(65)
      autoTable(pdf, { startY: y, head: [section.table.columns], body: section.table.rows, theme: 'grid', margin: { top: 50, bottom: 48, left: margin, right: margin }, rowPageBreak: 'avoid', showHead: 'everyPage', styles: { font: 'helvetica', fontSize: 9, cellPadding: 7, lineColor: '#E1E5EA', lineWidth: 0.4, textColor: ink, overflow: 'linebreak' }, headStyles: { fillColor: '#EEF1F5', textColor: ink, fontStyle: 'bold' }, columnStyles: { 0: { cellWidth: contentWidth * 0.38 }, 1: { cellWidth: contentWidth * 0.27 }, 2: { cellWidth: contentWidth * 0.35 } } })
      y = pdf.lastAutoTable.finalY + 18
    }
    const { facts, paragraphs } = reportSectionContent(section)
    for (let i = 0; i < facts.length;) {
      style(10)
      const pair = facts.slice(i, i + 2), columnWidth = (contentWidth - 22) / 2
      const blocks = pair.map(([label, value]) => ({ label, lines: pdf.splitTextToSize(value, columnWidth) }))
      style(7.5, true, muted)
      blocks.forEach(block => { block.labelLines = pdf.splitTextToSize(block.label.toUpperCase(), columnWidth) })
      const labelHeight = Math.max(...blocks.map(block => block.labelLines.length)) * 10
      const blockHeight = labelHeight + 6 + Math.max(...blocks.map(block => block.lines.length)) * 14 + 12
      if (blockHeight > bottom - 60) {
        const [label, value] = facts[i]
        space(40)
        text(label.toUpperCase(), { size: 7.5, bold: true, color: muted, leading: 12, after: 2 })
        text(value, { color: valueColor(value) })
        i++
        continue
      }
      space(blockHeight)
      blocks.forEach((block, column) => {
        const x = margin + column * (columnWidth + 22)
        style(7.5, true, muted)
        pdf.text(block.labelLines, x, y, { lineHeightFactor: 1.3 })
        style(10, false, valueColor(pair[column][1]))
        pdf.text(block.lines, x, y + labelHeight + 6, { lineHeightFactor: 1.4 })
      })
      y += blockHeight
      i += pair.length
    }
    for (const [label, value] of paragraphs) {
      space(42)
      text(label, { size: 10, bold: true, leading: 15, after: 3 })
      text(value, { color: valueColor(value), leading: 16, after: 12 })
    }
    for (const team of section.teams || []) {
      space(155)
      style(11, true)
      const titleLines = pdf.splitTextToSize(`${team.title} / ${team.reference}`, contentWidth - 56)
      const headerHeight = Math.max(42, titleLines.length * 14 + 20)
      space(headerHeight + 100)
      const teamStartPage = pdf.getNumberOfPages(), teamStartY = y - 12
      pdf.setFillColor('#F7F8FA').setDrawColor('#DCE1E6').setLineWidth(0.5)
      pdf.roundedRect(margin, y - 5, contentWidth, headerHeight, 5, 5, 'FD')
      pdf.addImage(TEAM_ICON, 'PNG', margin + 10, y + 3, 24, 24)
      pdf.text(titleLines, margin + 44, y + 13, { lineHeightFactor: 1.3 })
      y += headerHeight + 12
      text(team.introduction, { leading: 16, after: 8 })
      text(team.explanation, { size: 9, color: muted, leading: 14, after: 10 })
      space(65)
      autoTable(pdf, {
        startY: y, head: [['Name', 'Team Role']],
        body: team.crew.length ? team.crew.map(member => [member.name, member.role]) : [[{ content: 'No crew roster recorded', colSpan: 2, styles: { textColor: '#959DA7', fontStyle: 'italic' } }]],
        margin: { top: 50, bottom: 48, left: margin, right: margin },
        theme: 'grid', rowPageBreak: 'avoid', showHead: 'everyPage',
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 7, lineColor: '#E1E5EA', lineWidth: 0.4, textColor: ink, overflow: 'linebreak' },
        headStyles: { fillColor: '#EEF1F5', textColor: ink, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: contentWidth * 0.65 }, 1: { cellWidth: contentWidth * 0.35 } },
        didParseCell: cell => { if (cell.cell.raw === '-') cell.cell.styles.textColor = '#959DA7' },
      })
      const teamEndPage = pdf.getNumberOfPages(), teamEndY = pdf.lastAutoTable.finalY + 8
      for (let page = teamStartPage; page <= teamEndPage; page++) {
        pdf.setPage(page)
        const top = page === teamStartPage ? teamStartY : 42
        const end = page === teamEndPage ? teamEndY : bottom + 8
        pdf.setDrawColor('#DCE1E6').setLineWidth(0.5)
        pdf.roundedRect(margin - 8, top, contentWidth + 16, end - top, 5, 5, 'S')
      }
      pdf.setPage(teamEndPage)
      y = teamEndY + 22
    }
    if (section.explanation) text(section.explanation, { size: 9, color: muted, leading: 14, after: 16 })
    if (blockStart) {
      const lastPage = pdf.getNumberOfPages()
      for (let page = blockStart.page; page <= lastPage; page++) {
        pdf.setPage(page)
        const top = page === blockStart.page ? blockStart.y : 42
        const end = page === lastPage ? Math.min(y, bottom + 8) : bottom + 8
        pdf.setDrawColor('#DCE1E6').setLineWidth(0.5).roundedRect(margin - 8, top, contentWidth + 16, Math.max(20, end - top), 5, 5, 'S')
      }
      pdf.setPage(lastPage)
      y += 20
    }
  }
  report.sections.forEach((section, index) => renderSection(section, index))
  if (report.signatures) {
    space(170)
    text('Approval & Acknowledgment', { size: 13, bold: true, leading: 18 })
    text('The signature lines below provide space for the preparer and reviewing officer to acknowledge this document. Names may be completed before export or entered when the report is filed.', { leading: 16 })
    text('A printed name alone does not indicate that the report has been signed or approved.', { size: 9, color: muted, leading: 14 })
    const col = (contentWidth - 32) / 2
    style(9, true)
    const slots = [['Prepared by', report.preparedBy], ['Noted by', report.notedBy]].map(([label, name]) => ({ label, lines: pdf.splitTextToSize(name || ' ', col) }))
    const nameHeight = Math.max(...slots.map(slot => slot.lines.length)) * 12
    space(nameHeight + 80)
    y += 28
    slots.forEach(({ label, lines }, index) => {
      const x = margin + index * (col + 32)
      style(9, true)
      pdf.text(lines, x, y, { lineHeightFactor: 1.3 })
      pdf.setDrawColor(muted).line(x, y + nameHeight + 4, x + col, y + nameHeight + 4)
      style(8, false, muted)
      pdf.text(`${label} / Signature over printed name`, x, y + nameHeight + 18)
    })
  }
  const pages = pdf.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page)
    style(8, false, muted)
    if (page > 1) pdf.text(`${report.incidentId} | ${report.classification || 'Incident Report'}`, margin, 28)
    pdf.setDrawColor('#DCE1E6').line(margin, height - 36, width - margin, height - 36)
    pdf.text('FireTrackr | Times in Asia/Manila', margin, height - 22)
    pdf.text(`${page} / ${pages}`, width - margin, height - 22, { align: 'right' })
  }
  return pdf
}
