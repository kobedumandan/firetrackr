import pptxgen from 'pptxgenjs'

// Use the exact preview slides to preserve chart/map appearance in PowerPoint.
export async function buildMetricsPptx(pages, { title, preparedBy }) {
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = title || 'FireTrackr metrics'
  pptx.author = preparedBy || 'FireTrackr'
  pptx.subject = 'Incident activity presentation'
  for (const data of pages) {
    const slide = pptx.addSlide()
    slide.addImage({ data, x: 0, y: 0, w: 13.333333, h: 7.5, altText: 'Metrics presentation slide' })
  }
  return pptx.write({ outputType: 'blob', compression: true })
}
