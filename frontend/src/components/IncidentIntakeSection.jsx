import { Icon, SectionHead } from './incidentForm'
import { ICON_ARROW } from './incidentFormOptions'
import ReportReceiptFields from './ReportReceiptFields'
import { dateTime } from '../utils/operationalTimes'
import '../styles/IncidentIntake.css'

export function IntakeSection({ icon, title, desc, children, className = '' }) {
  const help = typeof desc === 'string' ? desc.split(/\s*\|\s*/) : [desc]
  return (
    <section className={`eim-section intake-section ${className}`}>
      <SectionHead
        title={<>{icon && <span className="intake-step" aria-hidden="true"><Icon d={icon} /></span>}<span className="intake-section-title">{title}</span></>}
        desc={desc && help.map((part, index) => <span key={index}>{index > 0 && <span className="intake-help-separator" aria-hidden="true">|</span>}{part}</span>)}
      />
      {children}
    </section>
  )
}

export function IntakeDisclosure({ title, summary, defaultOpen = false, children }) {
  return (
    <details className="intake-disclosure" open={defaultOpen}>
      <summary>
        <span className="intake-disclosure-heading">
          <span className="intake-disclosure-title">{title}</span>
          <span className="intake-disclosure-summary">{summary}</span>
        </span>
        <Icon d={ICON_ARROW} />
      </summary>
      <div className="intake-disclosure-body">{children}</div>
    </details>
  )
}

export function IntakeReceipt({ defaultOpen, ...props }) {
  const receipt = props.receivedAt ? `${dateTime(`${props.receivedAt}+08:00`)} PHT` : 'Receipt time unknown'
  return (
    <IntakeDisclosure title="Report receipt" summary={receipt} defaultOpen={defaultOpen}>
      <ReportReceiptFields {...props} />
    </IntakeDisclosure>
  )
}
