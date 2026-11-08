# Follow-up mobile/web workflow audit

Reviewed: 2026-11-06, Asia/Manila.

Scope: the current uncommitted backend/web workflow and the separate native app.
The original review recorded the findings below. The user then authorized fixing
all ten, including the clarified Driver reassignment restrictions.

**Status: all ten findings addressed locally on 2026-11-06.** No shared-database
migration, deployment, commit or push was performed. Actual-phone acceptance is
still required before rollout.

## Implementation results

### Station arrival separated from truck readiness (2026-11-07)

User clarification: Returning describes the trip back, not an unresolved truck
readiness check. Confirmed station arrival now restores the on-duty crew to
Standby even when Not Ready is recorded. A multi-truck team stays Returning until
all its trucks have arrived; off-duty membership/duty eligibility is preserved.
Truck Unavailable, its reason, Driver responsibility and both manual/automatic
dispatch blocks remain until explicit Ready. Later readiness preserves the original
arrival timestamp; retries add no duplicate operational events.

Team/personnel reads derive the correct status from saved return evidence for
older Not Ready records without rewriting history. Mobile Home/map and return
cards distinguish crew status from truck readiness. Web personnel/team views show
the blocker separately, and the manual team picker disables blocked selections.
Team readiness checks the assigned truck rather than another available station
truck; misleading Ready/manual-bypass copy was corrected.

Validation: **99 focused backend tests passed** on a freshly migrated disposable
PostgreSQL 18/PostGIS cluster, which was stopped. **84 focused web/native component
tests passed**, including the actual mobile Home and return controls, later Ready,
manual-picker rejection and resource exports. Targeted web/test lint, Python syntax
checks, the web production build and Android JavaScript export passed. The existing
web bundle-size warning remains. No configured database, additional schema migration,
installed APK, deployment, commit or push was changed. Restart the API and refresh
the clients; installed release apps require rebuilding/reinstalling. Actual-phone
acceptance remains outstanding.

### Native startup timing crash fix (2026-11-06)

Expo startup/Standby exposed a null access in the newly added incident modal.
With no incident and no saved milestone, both optional incident IDs evaluated to
undefined and compared equal, selecting `savedMilestone.timing` while the saved
milestone was null. The fallback now requires an existing saved milestone first.

Three regressions reproduced the exact crash before the fix, covering null,
undefined and empty incident data, followed by assignment and return to no
incident. After the fix, **52 focused native/workflow/time tests passed**, targeted
test lint passed, and the Android JavaScript export passed. Reload the Expo app to
load the corrected source; actual-phone confirmation remains pending.

### Independent fire milestones and unknown suppression start (2026-11-06)

Follow-up discussion exposed an indirect mobile reporting dependency: Fire Out
could only be saved with the report, and all timing writers required suppression
start. Native incident actions now offer **Record Suppression Started** and
**Record Fire Out** with Philippine occurrence-time input and confirmation. Each
saves a milestone without a report, clearance, resource release or completion.

The new personnel endpoint checks assignment ownership, current Team Leader role,
personal arrival, active response and incident locking. Audit records retain actor,
dispatch, occurrence/receipt times and request key. Retries preserve the original
fact, including after clearance, and conflicting timestamps require dispatcher
correction. A changed incident cannot receive an already-open confirmation.

Personnel entry, web milestone entry, report timing and corrections now accept a
verified Fire Out with unknown suppression start. Missing start stays null and
suppression duration stays missing. Known chronology still applies, including
containment and arrival corrections. Fire Out does not authorize or perform
clearance; the existing last-team guard and explicit dispatcher work confirmation
remain. Stale containment cannot introduce a control declaration after Fire Out.
Shared fire facts notify incident participants; team release remains team-scoped.

Follow-up correction (2026-11-07): the native Fire Out control previously remained
enabled before containment. Saving it hid the containment action, and the API's
later-time guard kept the incident Responding. New personnel Fire Out entries now
require containment in both the app and API. For existing affected incidents, the
containment action remains visible and requests a verified occurrence time at or
before the saved Fire Out. The API accepts that explicit time, validates known
chronology, and records receipt separately. It preserves Fire Out, unknown
suppression start, team assignments and clearance requirements. Stale no-body
containment still cannot introduce a later control time. No migration is needed.

Validation for this correction: **68 focused backend tests** passed on a fresh
disposable PostgreSQL/PostGIS cluster, which was stopped, and **72 web/native
component tests** passed. Python syntax checks, focused test lint and the Android
JavaScript export passed. Actual-phone confirmation still requires the updated
API and a refreshed mobile bundle (rebuild/reinstall for a standalone APK).

Validation: **75 focused backend database tests passed** on a freshly migrated,
disposable PostgreSQL 18/PostGIS cluster, which was stopped. **13 in-memory
correction tests** and **102 web/native component regressions** passed. The older
correction fixture was updated with the current classification and return fields.
Python syntax checks, targeted web lint, web production build and Android JavaScript
export passed; the existing web bundle-size warning remains. An additional run of
the older `test_admin_incident_reports.py` suite still has seven failures against
the previous reporting contract, including report-triggered closure/release; those
expectations were not restored. This is focused verification, not a claim that all
legacy suites pass. No configured database, migration, installed APK, deployment,
commit or push was changed. Restart the API and rebuild/reinstall the mobile app;
actual-phone acceptance remains outstanding.

### Reporting interface simplification (2026-11-06)

The final document is now labelled **Incident Report** across web and mobile.
Open incidents start reporting through Response & Reporting: a sole field report
prefills the editor, while multiple submissions are expanded for an explicit
starting-report choice. Preparation remains possible without a team submission.
The editor identifies the source author and explains that original submissions
and photos remain in Field Reports. The duplicate blank-form entry was removed
for open incidents; closed records retain missing-report recovery.

Backend report storage, revision/review checks, team release/clearance and truck
readiness were not changed. **116 focused web/native regressions passed**, including
the source-report handoff, selection, release eligibility and readiness controls.
One older native test referenced removed headings; it now verifies the same
operational-action-before-reporting order using the actual controls. Web production
build and Android JavaScript export passed. The touched dashboard components and
test harnesses pass targeted lint; `App.jsx` retains seven existing errors and one
warning outside this copy change. Actual-phone acceptance and APK rebuild/reinstall
remain outstanding.

### Additional release safeguard (2026-11-06)

User testing identified a further gap: the only on-scene team could receive
release authorization and clear while the fire remained active. Both server
mutations now preserve coverage: before Fire Out, another distinct, uncleared
team must already be On Scene. Travelling, recalled and completed assignments
do not qualify. Final fire-team release requires recorded Fire Out and an audited
dispatcher confirmation that assigned work is finished; Contained alone is
insufficient. Every new authorization explicitly confirms the team's work.

Eligibility is checked again at actual clearance under the incident row lock,
using refreshed assignments, so two authorized teams cannot both clear an active
fire. Legacy final-team authorizations can be renewed with explicit confirmation;
existing evidence is retained. No new migration is needed. Web and mobile consume
the same eligibility/blocker payload. Mobile prioritizes personal arrival/control,
hides release controls until personal arrival and eligibility, and puts its single
field-report action in a separate reporting section.

Focused validation after this change: **58 backend tests passed** on a fresh,
disposable PostgreSQL 18/PostGIS cluster, including a real two-session competing
clearance check, the authorization HTTP contract, legacy authorization handling
and existing report/return/timing regressions. The temporary server was stopped.
**58 web/native regression tests passed**, including rendering the actual native
incident modal with platform test doubles. Rejected mobile clearance attempts reset
their request time/key so a later eligible action can succeed; uncertain network
responses retain the original request for safe retries. Targeted web lint, Python syntax checks,
the web production build and Android JavaScript export passed; the existing web
bundle-size warning remains. The configured application database and installed APK
were not changed. Restart the local API and rebuild/reinstall the native app to
load these changes; actual-phone acceptance remains outstanding.

### Original ten fixes

| Finding | Implemented fix |
| --- | --- |
| 1 | Shared team/own-truck/personnel eligibility for recommendation and assignment; a lost candidate returns successful saved intake with a dispatch-unavailable result; successful intake returns its actual Responding stage. |
| 2 | Pending return custody blocks Driver removal, transfer, role/status changes and another dispatch until Ready. Not Ready remains locked. Web controls display the backend reason. Stale manning requests and roster/dispatch races are rejected safely. |
| 3 | Returning is supported by web roster labels, filters, counts and exports, including shift rollover; mobile map presentation is independent of the GPS collection mode. |
| 4 | Drafts use current evidence. Review snapshots are tied to the report revision; audited corrections invalidate review and preserve older snapshots and field submissions. |
| 5 | Unknown live casualty outcomes remain unknown; None requires an explicit selection. |
| 6 | Register calendar boundaries, counts and export population use Asia/Manila, including day/month/year rollover. |
| 7 | Dispatcher can record Return & Not Ready with radio source/reason through the existing readiness endpoint. |
| 8 | Native Report badges use the actual incident lifecycle stage and matching appearance. |
| 9 | Mobile clearance uses one specific alert; a delayed saved event replaces the generic fallback without replaying it. |
| 10 | Web correction/review alerts are mapped and respect preferences; submission/preparation updates avoid duplicate notifications. |

Validation: **189 backend regressions passed** in a fresh disposable PostgreSQL
18/PostGIS cluster, including responsibility locks, the roster/dispatch race,
return/readiness, report/photo isolation, review revisions, PHT calendar boundaries
and bounded list/recommendation queries. The server was stopped afterward; external messaging
and configured storage/database were not used.

The full web suite had **516 passing tests and the same three existing WebSocket
URL-test failures**. This includes the native hook/status regressions through local
test doubles; their focused recheck passed 28 tests. Web production build and
Android JavaScript export passed. Existing repository lint findings remain; the
newly changed UI components and regression harnesses pass targeted lint.

## Original findings and evidence

### 1. P1 — Automatic recommendations disagree with dispatch eligibility

The recommendation filter excludes only `team_status == active`, and accepts an
available truck anywhere at the team's station. The dispatch writer instead
requires the team to be Standby and its own assigned truck to be Available.
Consequently an inactive team, or a standby team whose truck is unavailable but
whose station has a spare, can be recommended and then rejected when dispatched.

With automatic dispatch, incident creation commits the incident before attempting
the selected dispatch. The rejection returns an error although the incident was
already saved. Retrying the intake can create a duplicate incident.

Sources: [recommendation eligibility](../backend/auto_dispatch.py#L70),
[dispatch guards](../backend/services/dispatch.py#L67),
[incident creation](../backend/routers/incidents.py#L179).

Verified: two eligibility/dispatch disagreement cases and an automatic-dispatch
request that returns 409 after saving its new incident.

Fix: share authoritative team/truck/personnel eligibility between recommendation
and assignment. Handle a lost or invalid candidate as an undispatched saved
incident, with an explicit response, rather than a misleading intake failure.

### 2. P1 — A returning Driver can be moved and dispatched elsewhere

Web team editing allows removal/addition of personnel while their former team is
Returning. Adding the person to another team creates a Standby membership; the new
dispatch checks that membership but not the person's outstanding return custody.

The same Driver can therefore receive Incident B while still responsible for
Incident A's returning truck. Mobile selects the new active assignment for tracking,
while the earlier truck's return remains unfinished. The initial scope deferred
complex handovers, so this transition should be blocked until readiness or an
explicit, audited handover is supported.

Sources: [membership removal/addition](../backend/routers/teams.py#L154),
[new-assignment member checks](../backend/services/dispatch.py#L77),
[web roster editing](../frontend/src/components/EditTeamModal.jsx#L132).

Verified: remove the responsible Driver from Alpha after clearance, add them to
standby Bravo, and successfully dispatch Bravo while Alpha's truck remains Returning.

### 3. P2 — Web Personnel lists returning crews as Standby

The Personnel serializer accepts `dispatched`, `onscene`, `standby` and `offduty`.
It does not accept `returning`, which the clearance path now writes. An on-duty
returning member therefore falls through to Standby, while the Team, Truck and
mobile Home correctly indicate Returning/Not Ready. The Personnel page also labels
Standby as Ready to Deploy and has no Returning filter.

Sources: [serializer fallback](../backend/routers/personnel.py#L77),
[Personnel filters/cards](../frontend/src/pages/PersonnelPage.jsx#L88).

Verified: clearance leaves the team/truck Returning but `/api/personnel` serializes
the responsible Driver as Standby.

Fix: use a common personnel response/readiness mapping and add Returning to the
Personnel list, counts, filters and exports. Keep tracking collection mode separate
from readiness when presenting mobile map status as well.

### 4. P2 — Consolidated reports can retain stale fire times

The consolidated report captures its timing snapshot only when first created.
`report_timeline` then keeps that first snapshot, refreshing only the control time.
If the dispatcher prepares a draft during response and the team subsequently records
suppression start/fire out, the report can be reviewed and closed while still
displaying those times as missing. Analysis uses the recorded incident times instead.
Later audited timestamp corrections have the same mismatch.

Sources: [initial snapshot](../backend/services/incident_reports.py#L136),
[snapshot selection](../backend/services/report_timing.py#L93).

Verified: create the consolidated draft, submit actual fire times, complete and
review/close. The incident has fire out, while the reviewed report timeline returns
null fire out and suppression start.

Fix: distinguish the immutable personnel submission snapshot from the dispatcher
consolidated report's current/reviewed timeline. Capture the verified timeline for
the reviewed revision and retain earlier snapshots as audit evidence.

### 5. P2 — Unassessed live incidents still save casualties as None

Live intake hides the casualty picker but submits `fire_casualties: "None"` as a
literal string. This bypasses the backend's Unconfirmed fallback and makes an
unassessed outcome look like an explicit report of no casualties.

Source: [live intake payload](../frontend/src/components/LogIncidentModal.jsx#L159).

Verified with the rendered intake component: submitting a pending live incident
without casualty input sends the string `None`.

Fix: submit null/Unconfirmed for unknown outcomes. Save None only after an explicit
no-casualties confirmation; retain the shared fatalities/injured text summary.

### 6. P2 — Incident register date filters still use UTC boundaries

The register's Today, This Month and This Year filters start at UTC midnight,
although incident displays and operational time inputs use Asia/Manila. A November 6
incident at 07:00 PHT is excluded from November 6's Today list after 08:00 PHT.
The first eight hours of a month/year have analogous boundary problems, and the
filtered exports inherit the register population.

Source: [period filtering](../backend/routers/incidents.py#L53).

Verified using a fixed clock and a 07:00 PHT incident. Its ID is absent from the
same Philippine day's filtered register.

Fix: derive calendar boundaries in Asia/Manila, convert those instants for the
database query, and reuse the boundaries across display counts and exports.

### 7. P2 — Dispatcher cannot record Not Ready through the web

The return panel offers Record Return & Ready, but no Not Ready action. Generic
fleet editing correctly rejects availability changes while the return is unfinished.
If the Driver is offline and radios that the truck has returned but needs refill or
repair, the dispatcher has no corresponding UI action, although the readiness API
already accepts an administrator's `ready: false` with a reason.

Sources: [web return controls](../frontend/src/components/IncidentWorkflowPanel.jsx#L62),
[availability guard](../backend/routers/trucks.py#L67).

Verified: component controls omit Not Ready; generic Unavailable edit returns 409;
the reasoned dispatcher readiness API can correctly record the fault.

Fix: add a dispatcher Back at Station / Not Ready action using the existing endpoint
and require the radio source/reason, preserving the same audit and notifications.

### 8. P2 — Mobile Report screen always labels the incident Under Control

The report summary always renders `incidentControl(incident).label`. Now that reports
can be opened during response and from closed history, a Responding, Operation
Complete or Closed incident still appears as Fire Contained/Situation Under Control
on this screen. My Incidents and the web use the actual derived stage.

Source: [report summary badge](../../bfp_capstone_mobile/screens/ReportScreen.js#L225).

Verified by tracing the unconditional JSX and the status-independent control-label
helper. This is a source finding; it was not checked on an actual phone.

Fix: use the shared incident status label and stage-based badge appearance here.

### 9. P3 — One clearance produces duplicate mobile in-app alerts

The status-difference effect emits Dispatch Ended when the active assignment
disappears; the saved-event effect independently emits Team Cleared for the same
transition. Deduplicating saved event IDs does not reconcile the two sources.

Source: [mobile alert derivation](../../bfp_capstone_mobile/hooks/useAlertLog.js#L68).

Verified with the hook: a single clearance snapshot produces both alerts.

Fix: prefer the specific saved workflow event, using Dispatch Ended only when no
matching clearance/release event explains the transition.

### 10. P3 — Report correction/review alerts are missing on web

The backend sends `report_corrected` and `report_reviewed` workflow updates and the
native app recognizes their corresponding saved events. The web workflow message
map does not include these kinds. Report data refreshes, but these updates do not
produce the promised web notification.

Sources: [web workflow message map](../frontend/src/App.jsx#L606),
[backend notification kinds](../backend/services/push.py#L162).

Verified by tracing the backend kinds to the web message lookup and report-update
handler. This finding does not claim actual Expo/phone delivery was tested.

Fix: map correction and review updates to web alerts and reconcile them with
report-submitted notifications to avoid another duplicate path.

## Verification and limits

- Eight isolated database probes reproduced the backend/data discrepancies above.
  The temporary PostgreSQL 18/PostGIS cluster migrated through 0034 and was stopped
  after the probes. Shared database and external messaging/storage were untouched.
- Three local component/hook probes reproduced the live casualty default, missing
  web Not Ready control and duplicate native in-app clearance alerts.
- The original audit probes have been converted to desired-behavior regression
  checks and extended for the fixes. Historical descriptions above document what
  was found; the implementation-results table records the current local outcome.
- Actual-phone push delivery, background/foreground execution, app restart and
  connection-loss tests remain outstanding. Existing lint and WebSocket URL test
  findings from the implementation pass are separate from these workflow findings.

These fixes fit the existing Dispatcher and Personnel account model. No new account
type or organizational approval workflow is needed to address these code gaps.

## Field reporting after personal arrival (2026-11-07)

The active incident modal and report API previously allowed a Team Leader to submit
field observations before personally arriving. The native report action now waits
for the leader's own arrival. My Incidents returns `can_submit_report: false` with
a personal-arrival `report_blocker`, and the submission API applies that same check
under the incident lock before creating a report or uploading photos. A driver's
or truck's arrival cannot unlock another person's submission. Read-only records
explain the arrival requirement. Verified legacy personal-arrival evidence still
qualifies, and ended-assignment reporting remains available to historical leaders.
Containment, release, operation completion and truck readiness remain separate.

Validation: **109 backend tests** passed on a fresh disposable PostgreSQL/PostGIS
cluster, which was stopped; **56 web/native component tests** passed. Python syntax
checks, focused test lint and the Android JavaScript export passed. No migration
is required. Running clients need the updated API and mobile bundle; actual-phone
acceptance remains outstanding.
