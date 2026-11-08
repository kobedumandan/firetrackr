import { duration } from './operationalTimes'

const STAGES = [
  { key: 'processing', label: 'Report Processing', color: 'E64A32' },
  { key: 'preparation', label: 'Preparation', color: 'F49A20' },
  { key: 'travel', label: 'Travel', color: '2E9C95' },
  { key: 'suppression', label: 'Suppression', color: '687BD1' },
]

export const reportTitleCase = title => title.replace(/\b[a-z]/g, letter => letter.toUpperCase())
export const stagePercent = percent => percent < 0.1 ? '<0.1%' : `${Number(percent.toFixed(1))}%`

export function buildStageBreakdown(values = {}, fire = true, unit = false) {
  const cards = STAGES.filter(stage => !unit || stage.key !== 'suppression').map(stage => {
    const applicable = stage.key !== 'suppression' || fire
    const seconds = applicable && Number.isFinite(values?.[stage.key]) && values[stage.key] >= 0 ? values[stage.key] : null
    return { ...stage, seconds, value: !applicable ? 'Not applicable' : duration(seconds, '-') }
  })
  const total = cards.reduce((sum, card) => sum + (card.seconds ?? 0), 0)
  const segments = cards.filter(card => card.seconds > 0).map(card => ({ ...card, percent: card.seconds / total * 100 }))
  return { cards, segments, total, totalLabel: duration(total), hasData: segments.length > 0 }
}
