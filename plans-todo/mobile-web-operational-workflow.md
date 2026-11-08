# Mobile and web operational workflow implementation plan

Prepared: 2026-11-06, Asia/Manila.
Revised: 2026-11-06 for the November 13, 2026 defense.

Status: implemented locally in the backend, web dashboard and native app.
Automated acceptance and both builds have been checked. Shared-database rollout
and actual-phone foreground/background/restart testing remain outstanding.

Local test setup was subsequently completed on 2026-11-06: the existing loopback
database was backed up and upgraded from `0032` to `0034`, preserving row counts;
the web app uses the local API and a standalone signed test APK uses ngrok to reach
it. Direct/proxied/tunnel health and Panabo routing checks passed. This does not
complete the actual-phone checklist below. The workspace's
`local-device-testing/WORKFLOW-APK-2026-11-06.md` records the APK and restart steps.

The ten follow-up audit findings have been fixed locally, including the agreed
Driver reassignment restrictions. See [the audit and resolution record](mobile-web-operational-workflow-audit-2026-11-06.md)
for the original findings, implemented safeguards and regression coverage.

An additional release safeguard now prevents normal clearance of the last on-scene
fire team before Fire Out and explicit dispatcher work confirmation. Partial release
requires another uncleared team already On Scene, with eligibility rechecked at
clearance under the incident lock. Focused checks passed 58 backend tests and 58
web/native regressions, plus the web build and Android JavaScript export. The
current installed APK still needs rebuilding/reinstallation for the new layout.

Implementation verification recorded on 2026-11-06:

| Check | Result |
| --- | --- |
| Fresh disposable PostgreSQL 18 / PostGIS migration through `0034` | Passed; server stopped after testing; configured database untouched |
| Backend workflow, custody/concurrency, report timing, calendar, query-budget, intake and photo-storage regressions | 189 passed |
| Focused native hook/status and converted UI audit regressions | 28 passed; included in full web suite |
| Full existing web suite | 516 passed; 3 existing `src/api.test.js` WebSocket URL expectations fail against unchanged development-origin behavior |
| Web production build | Passed; existing bundle-size warning |
| Native Android JavaScript export | Passed; actual-device execution remains to be rehearsed |
| Repository-wide lint | Existing 21 errors and 2 warnings; no additional workflow lint errors |

The new code uses existing account roles and team assignments. Web Incident
Details now contains Response & Reporting; native Home links to My Incidents and
shows persistent truck return/readiness tasks. Personnel reports are field inputs;
the dispatcher prepares the consolidated report and explicitly reviews/closes it.
Legacy report purposes and missing operational times remain unknown.

Scope: the FastAPI backend and React dispatcher dashboard in this repository,
plus the separate [personnel app](../../bfp_capstone_mobile/).

## 1. Fixed defense scope

Keep exactly two existing account types:

- Dispatcher: uses the web dashboard.
- Personnel: uses the mobile app.

Team Leader and Driver remain existing assignments within a personnel account.
They are not new account types or additional logins. Dispatcher actions represent
recording operational instructions and reviewing incident information.

Include a lightweight My Incidents screen for personnel to revisit their own
assigned responses and unfinished field reports. Reuse the existing ReportScreen
and add an entry from Home; a bottom-navigation redesign is not required.

The backend currently calls the web account role admin. Preserve that existing
stored value, login and authentication checks; the product can continue to call
the user Dispatcher. No account-role migration is required.

Do not add command, reviewer or fleet accounts; generic permission/delegation
management; or a new hierarchy of approvals before the defense.

Deliver the seven verified fixes, consistent incident stages, individual team
clearance, dispatcher completion/closure, and essential truck return/readiness.

## 2. Verified issues and required outcomes

| Issue | Current behavior | Required result |
| --- | --- | --- |
| Casualty synchronization | Mobile writes report casualties but incident details read a different summary. | Mobile and web share the save/synchronization rule; details, reports and exports agree. |
| Report-triggered resource release | One report or direct closure can complete all responding dispatches and make trucks available. | Report actions release nobody. Closure checks prerequisites without changing resource readiness. |
| Arrival after control | Native arrival is blocked once the incident becomes contained. | Eligible personnel can arrive after situation control until their own assignment clears or the operation ends. |
| Classification mismatch | Labels/fire scope and timing use competing operation/classification rules. | One effective classification drives labels, validation, timing, metrics and exports. |
| Missing native fire timing | Native report UI and requests omit supported fire timing inputs. | Existing authorized Team Leaders can record applicable fire milestones from mobile. |
| Stale native fleet | An open Trucks screen does not refresh after resource changes. | Refresh on relevant events, focus/foreground and reconnect; retain manual refresh. |
| Mixed timezones | Some phone displays use the device timezone. | Operational dates and input previews consistently use Asia/Manila. |

Preserve the existing fire/non-fire wording change, unrelated working-tree edits,
legacy records and authorship. Keep baseline lint findings separate from new ones.

Source entry points:
[dispatch endpoints](../backend/routers/dispatch.py),
[web incident/report endpoints](../backend/routers/incidents.py),
[report service](../backend/services/incident_reports.py),
[clearance service](../backend/services/operation_completion.py),
[operational timing](../backend/services/operational_times.py),
[native incident modal](../../bfp_capstone_mobile/components/IncidentDetailsModal.js),
[native report screen](../../bfp_capstone_mobile/screens/ReportScreen.js) and
[native API wrapper](../../bfp_capstone_mobile/constants/api.js).

## 3. Responsibilities using the two accounts

| Action | Dispatcher account | Personnel account |
| --- | --- | --- |
| Create/edit incident; assign responding teams | Existing web workflow | No |
| Acknowledge / depart | View current response state | Assigned Team Leader or Driver |
| Confirm personal arrival | View the recorded fact | Each assigned person confirms their own arrival |
| Confirm vehicle arrival | Record permitted corrections with a reason | Assigned manning Driver for that truck |
| Record control and applicable fire milestones | Record supplied field updates and command declarations | Assigned Team Leader records field information/command declarations, using existing assignment checks |
| Authorize release of one team | Record the instruction received from field command | View own team's authorization |
| Confirm actual clearance | Record permitted corrections with a reason | Assigned Team Leader confirms own team and released trucks |
| Supply field information / prepare consolidated report | Dispatcher prepares the final consolidated incident report | Assigned Team Leader submits field information through the existing personnel report flow |
| Review report; complete operation; close incident | Dispatcher, subject to prerequisites | No global closure or release of other teams |
| Record return arrival / readiness | Resolve or correct with a reason | Responsible Driver for the released truck |
| Mark or resolve unavailability | Dispatcher records resolution with a reason | Driver reports not-ready/fault and keeps the truck unavailable |

Dispatcher-recorded radio/field instructions remain identified as such. A
dispatcher account does not claim to be the real-world Incident Commander.

Radio/voice communications remain part of the operating workflow; app entries and
notifications document and distribute the resulting facts/instructions. Record
who entered a milestone and its source. Recording a command declaration does not
transfer the real-world command role to a Team Leader or dispatcher account.

All permission, assignment, resource ownership and state checks remain server-side.
Cleared personnel retain authorized access to the report and the responsible
Driver's return actions. A cleared dispatch must not strand those actions.

Reporting access is based on verified participation/report authority for the
selected past assignment, not whether it is the user's latest active dispatch.
Persist/reuse attributable assignment history and the Team Leader responsibility
at the time of response. Current membership alone must not expose older unrelated
incidents or revoke a former leader's legitimate reporting access. Legacy cases
without sufficient participation evidence use dispatcher-assisted recovery.

## 4. State model

### Incident stages

| Dashboard stage | Meaning |
| --- | --- |
| Pending | Recorded; awaiting dispatch. |
| Responding | Assigned teams are travelling or working on scene. |
| Under Control | Immediate situation controlled; response work may continue. |
| Operation Complete | Dispatcher records operational completion after eligible responding teams are accounted for; fire operations also require fire out. |
| Closed | Required incident report reviewed and administrative closure recorded. |

Display Under Control as Fire Contained for firefighting and Situation Under
Control for non-fire/unclassified incidents. Fire Out remains a separate milestone.

Reuse existing raw status keys and operation_completed_at where possible. Expose
one backend-derived lifecycle_stage rather than a second independently editable
status clock. Filters, counts, map visibility, timelines and exports must agree.
An operation can show Operation Complete / Report Pending.

Preserve cancellation/recall and legacy active mappings. Historical closed records
remain readable without invented clearance or completion timestamps. Review
reinforcement/departure guards together with late arrival: control alone does not
terminate an otherwise eligible assignment.

### Team assignment progress

Assigned -> Acknowledged -> En Route -> On Scene -> Cleared.

Derive display states from existing assignment state and timestamps. Clearing one
team affects that assignment. Team assignment clearance is separate from personnel
and vehicle readiness for another call.

Receiving/acknowledging release does not make the team Standby. Actual clearance
ends its scene assignment and starts Returning where applicable. Confirmed station
arrival restores the on-duty crew to Standby, including when the truck is Not Ready.
For a multi-truck team, all its trucks must have arrived. The truck becomes Available
only after readiness is confirmed. Standby does not establish dispatch eligibility:
unfinished readiness blocks both manual and automatic dispatch, and the captured
Driver's responsibility stays locked until Ready. Off-duty personnel remain Off Duty
after their return. Web/native views show the truck blocker separately from crew status.
Report Pending is an independent task and does not block an otherwise ready team
from receiving another response. A new assignment does not clear old reporting tasks.

Normal release must preserve scene coverage. Before Fire Out, fire-response
authorization and actual clearance require another distinct, uncleared team already
On Scene; an assigned or travelling team does not count. The final on-scene fire
team requires recorded Fire Out plus dispatcher confirmation that its assigned work
is finished. Contained alone is insufficient. Do not require Operation Complete
before final-team clearance: operation completion still follows all clearances.

All new authorizations explicitly confirm assigned work is finished. The existing
release endpoint accepts `{ "work_finished": true }`, and the attributed
`op_release_authorized` event preserves this confirmation without a new schema
migration. Legacy final-team authorizations without confirmation can be renewed
through the web; earlier evidence is retained. Both authorization and clearance
read fresh assignment state while holding the incident lock, including when two
teams already hold authorization. Recall/cancellation remain separate workflows.

The web Response & Reporting panel and mobile status share server-derived `release`
eligibility/blockers. Mobile shows the next personal-arrival/control action before
separate Team Release and Field Reporting sections. Release controls appear after
personal arrival when eligible; blocked final-team release explains Fire Out.
During an active response, reporting becomes available after the Team Leader's own
personal arrival. Truck/driver arrival alone does not unlock it. The native action,
My Incidents eligibility and submission API share this requirement; blocked entries
remain readable with the personal-arrival reason. Reporting remains available
after clearance for verified historical leaders, including older assignments with
no personal-arrival record. It never changes team clearance, operation completion
or truck readiness, and containment is not a reporting prerequisite.

Fire Out no longer requires submitting a field report or knowing suppression start.
An assigned, personally arrived Team Leader records each verified milestone through
the native incident's **Fire Milestones** controls. Suppression Started and Fire Out
save independently through `POST /api/workflow/dispatch/{id}/fire-milestones` with
the selected Philippine occurrence time and a retry key. Dispatcher milestone
entry remains available on the web. Unknown suppression start stays null, so
suppression duration remains unknown; it must never be guessed to permit release.
Known timestamps must still be chronological. Fire Out alone does not authorize
release, clear a team, make a truck Available or complete the operation.

New mobile Fire Out entries require **Mark Fire as Contained** first; both the
native control and personnel API enforce this order. An existing Fire Out recorded
while the incident is still Responding does not hide containment. The leader enters
the verified containment time in Philippine time, at or before Fire Out. The
optional `{ "occurred_at": "<timezone-aware timestamp>" }` body on
`PATCH /api/dispatch/{id}/contain` supports this recovery, checks known receipt,
dispatch, arrival and suppression times, and retains separate occurrence and
recording times. No timestamp is inferred. Existing no-body containment requests
still record current control when Fire Out is absent; retries retain the first
saved containment time. No migration is needed.

### Report progress

Draft while editing -> Submitted / Pending Review -> Reviewed.

The user-facing final document is **Incident Report**. Response & Reporting is
the creation entry point for open incidents. When one field report is available,
Review Field Report opens the editor with its text prefilled. Multiple submissions
are expanded for the dispatcher to choose a starting report and reconcile other
findings explicitly. With no submissions, the dispatcher can prepare a report from
confirmed information. The editor identifies the original author and explains that
the original submission/photos remain in Field Reports. Closed records retain
missing-report recovery. No report-storage, release, clearance or readiness rules
are changed by this interface simplification; `consolidated` remains an internal
report kind.

Client-side editing can remain the initial draft mechanism. Persisted autosaved
drafts and a separate approval queue are deferred.

Dispatcher owns preparation and finalization of the consolidated incident report.
Assigned Team Leaders supply field information through the existing personnel
report submission flow. Those submissions are inputs to consolidation, not global
closure actions. Do not require every leader to submit a separate final report.
Reuse existing report storage/editor and distinguish field submissions from the
dispatcher-finalized report with minimal purpose/version metadata. Preserve field
authors, dispatcher consolidation attribution and legacy reports. Reject stale or
conflicting updates rather than blindly overwriting facts.

An unfinished field report stays accessible after team clearance, operation
completion, return/readiness and a later dispatch. Bind the report form to its
selected incident/dispatch IDs; a new current assignment must not retarget it.
Show an unsaved-changes warning before abandoning edited form contents. Persisted
autosaved drafts remain outside the initial scope; history guarantees access to
create/submit the report later, not recovery of unsubmitted text after app removal
or termination.

After dispatcher finalization and incident closure, personnel history remains
readable and submitted field reports remain visible. For the defense, corrections
to finalized information go through the dispatcher; personnel do not silently
overwrite the consolidated report or reopen the incident.

Dispatcher may review and close in one explicit action when operational completion
and reporting prerequisites are both satisfied. Record actor, time and the reviewed
report/version. Report submission or review alone releases no resources.

### Truck readiness

| Transition | Trigger |
| --- | --- |
| Available -> Responding | Backend validates dispatcher assignment; existing raw dispatched can retain this meaning. |
| Responding -> On Scene | Assigned manning Driver confirms vehicle arrival. |
| On Scene -> Returning | Team Leader confirms authorized clearance and that the released truck is leaving for its home station. |
| Returning -> Available | Responsible Driver confirms station arrival and readiness after checks. |
| Returning -> Unavailable | Arrival without readiness, replenishment needs or a reported fault keeps it unavailable with a reason. |
| Unavailable / Maintenance -> Available | Dispatcher records resolution/readiness with a reason. |

A combined Back at Station / Confirm Ready action can record both facts when true.
GPS can suggest arrival but cannot establish readiness. Release authorization alone
does not claim departure.

Back at Station / Not Ready records `returned_at` while leaving `ready_at` missing.
The crew is then Standby (or Off Duty according to duty eligibility), with an
Unavailable truck and a visible reason. Returning means station arrival is still
unconfirmed. Existing Not Ready records use their saved return evidence for display;
no history rewrite is needed. A later Confirm Ready preserves the original arrival.

Ordinary automatic dispatch excludes Returning and Unavailable resources. Preserve
existing Maintenance records. Generic truck editing cannot make an assigned or
returning truck Available without required facts and an authorized correction.

Initial return destination is the truck's home station. Direct reassignment while
returning, alternate destinations and complex handovers are post-defense work.

## 5. Minimal schema, API and tracking changes

Inspect the actual Alembic head and add reviewed migrations after it; the checked-in
chain currently reaches 0033. Preserve old revisions, identifiers and history.

| Existing area | Minimum extension |
| --- | --- |
| Incident / serializers | Canonical casualty summary, effective classification, lifecycle stage and action/blocker information; reuse operation_completed_at. |
| DispatchRecord | Reuse cleared_at; add release authorization actor/time and necessary disposition metadata. |
| DispatchTruck / assignment context | Persist return Driver, home destination, return start/arrival and readiness/not-ready evidence, accessible after clearance. |
| IncidentReport | Reuse field-report content and authorship; add minimal purpose, consolidation/review and version metadata to identify the dispatcher-owned final report without erasing personnel submissions. |
| IncidentEvent | Audit release, clearance, return, readiness, report review and closure with actor, source, occurrence/receipt time and retry key. |

No new account-role or delegation tables, separate team-activity table, or generic
return-assignment subsystem is required for the initial delivery. If existing
assignment records cannot safely express return ownership, identify that specific
modeling issue before expanding the schema.

API and backend work:

- Keep current reads, identifiers, account-role strings and login behavior.
- Extend /api/mobile/me/status with incident stage and active return/readiness
  context; retain authorized report access after clearance and app restart.
- Add a paginated authenticated personnel-history read, such as
  /api/mobile/me/incidents, and an owned incident/assignment detail read. Derive the
  caller from authentication and return only verified prior/current assignments.
  Do not expose the administrator's full incident register to mobile accounts.
- Include incident stage, the caller's assignment/reference, report status and
  allowed reporting actions in history. Validate ownership/report authority again
  on submission, independently of the current active response.
- Add dispatcher release authorization; extend existing clearance; add responsible
  Driver return-arrival/readiness and dispatcher resolution actions.
- Extend native fire timing inputs and multipart payloads.
- Split report saving/submission, operation completion and administrative closure.
  Enforce shared guards across mobile reports, dispatcher reports, generic incident
  updates and correction APIs.
- Use incident/resource locking, retry keys and stale-update checks. Protect against
  overlapping active ownership of a truck. Commit before broadcasting events.
- Advertise workflow capability/version where necessary. After cutover, reject
  unsafe legacy Submit & Close mutations with an update-required response.
- Retain Driver custody/context through returning rather than immediately unman
  every truck at assignment clearance.
- Update server/native tracking readers together; retain existing duty and lease
  rules. Return movement must not contaminate incident travel/suppression metrics.
- Stop showing/requesting the old incident approach route after clearance. Preserve
  appropriate truck position/return context without building a new return-routing
  subsystem for the defense.

## 6. Data rules

### Casualties

Keep one visible summary, for example 0 fatalities | 1 injured. None | 1 injured
is ambiguous. Missing facts remain Unconfirmed/Not recorded.

Use one shared save/synchronization rule for mobile and dispatcher report editing.
Current incident details and exports read the canonical incident summary; preserve
earlier report facts and authorship. Dispatcher reconciles the incident-wide
summary rather than automatically adding observations from different teams.

Numerical casualty analytics and automatic duplicate-person reconciliation are
deferred. Preserve free text without guessing numerical counts.

### Classification

One backend effective-classification rule governs scope, UI and timing:

- Firefighting Operations is fire-eligible; EMS is medical.
- Known non-fire operation types cannot silently gain fire milestones through
  conflicting response_kind. Unspecified legacy types use verified classification
  when available and neutral wording otherwise.
- Declared type and verified field classification remain distinguishable. A default
  form selection does not fabricate a verification event.
- Reject contradictory new writes with an actionable message. Preserve/flag old
  conflicts and require audited resolution when existing evidence contradicts a
  proposed correction.
- Replace competing raw checks in timing, correction, reports and metrics. Clients
  must explain prerequisites instead of offering unusable actions.
- Non-fire suppression is N/A. Unknown times remain missing and never become zero.
- A verified Fire Out may be recorded with unknown suppression start. Analysis,
  reports and event history retain the known Fire Out and missing start; suppression
  duration remains missing until both verified endpoints exist. Personnel milestone
  entry, dispatcher entry, report timing and audited corrections share this rule.

## 7. End-to-end workflow for the demonstration

1. Dispatcher creates an incident and assigns Alpha and Bravo.
2. Personnel receive their assignments. Assigned leaders/drivers acknowledge and
   depart; individuals record personal arrival and manning Drivers record vehicle
   arrival.
3. Leaders communicate field progress through radio/voice and record applicable
   milestones, including command-declared fire out when applicable. Late responders
   remain able to confirm eligible arrival after control.
4. When Alpha's assigned work is finished and its personnel are accounted for,
   its leader communicates readiness/requests release through radio. Dispatcher
   records field command's release instruction for Alpha; the app notifies Alpha.
5. Alpha's leader confirms actual clearance, accountability and released truck(s).
   Alpha clears; its truck becomes Returning. Bravo stays On Scene.
6. Alpha's Driver confirms return/readiness or reports not-ready. Only the correct
   readiness outcome makes that truck Available.
7. Dispatcher confirms operation completion after responding teams are accounted
   for and applicable fire out is recorded. Trucks may still be Returning.
8. Assigned Team Leaders provide field information; dispatcher reconciles those
   submissions and prepares the consolidated incident report. Submission releases
   nobody, and an injured person reported by two teams is not counted twice.
9. Dispatcher finalizes/reviews the consolidated report and explicitly closes
   after both operational and reporting prerequisites are satisfied.

Steps 6 and 8 can occur before or after completion. Return, clearance, fire out,
completion, submission and review retain their real independent timestamps.

### Radio request, app acknowledgment and operation completion

Use the sequence Ready for Release (communicated by radio) -> Release Authorized
(recorded by dispatcher) -> Team Cleared (confirmed by leader) -> Operation
Complete (recorded by dispatcher after eligible responding teams are accounted for).

Fire out and one team's task completion are not whole-incident completion. Partial
team release can happen while other teams still work. Do not mark the operation
complete first merely to obtain a team's clearance acknowledgment.

For the defense, a radio request is sufficient; a new Request Clearance screen or
mandatory request state is not required. A notification tells the leader release
has been authorized. Opening/dismissing it acknowledges receipt only and must not
record physical clearance. Confirm Team Cleared records the actual departure and
accountability facts when true, which moves released trucks to Returning.

App/network availability does not replace radio instructions. Dispatcher can record
radio-confirmed clearance through an audited on-behalf-of entry, retaining actual
occurrence time where known and server receipt separately. Later phone retries
reconcile the existing fact rather than duplicating or replacing it.

### Notifications for state changes

| Saved event | Recipients and expected app behavior |
| --- | --- |
| Field control/fire-out update recorded | Dispatcher sees the attributed incident update; participating personnel see the updated milestone/state. |
| Team release authorized | Only that team's personnel receive the release notification; leader sees the pending clearance action. |
| Team clearance confirmed | Dispatcher receives confirmation; affected Driver sees the Returning context and later return/readiness action. |
| Truck returned, ready or not ready | Dispatcher and responsible Driver see the resulting resource state and any blocker. |
| Field report submitted | Dispatcher receives an input notification for consolidated reporting; no resources or incident stages change automatically. |
| Operation completed | Participating personnel receive an informational update; clearance is already accounted for, not requested afterward. |
| Incident closed | Participating personnel and dispatcher see final administrative closure; unfinished truck return/readiness remains accessible. |

Extend existing web toasts/history and native alerts. Reuse the existing push
infrastructure for important actionable background alerts, particularly release
authorization; do not claim guaranteed push delivery. Persist outstanding actions
in backend state so they recover on reconnect/restart even if a notification was
missed. Target actual incident/dispatch participants, including cleared teams where
relevant. Deduplicate retries/replays; routine GPS samples do not generate alerts.

## 8. Client work

### Mobile

Keep existing personnel login, Team Leader/Driver assignments and manning controls.
Fix the containment-related arrival blocker, add applicable fire timing fields and
correct serialization, and replace Submit & Close with Submit Field Report.
Explain that dispatcher prepares the final consolidated report and closes the
incident; personnel submissions do not close it.

Show own-team release authorization/clearance, incident stage and return/readiness
tasks. Responsible Driver actions survive clearance and restart. Refresh fleet on
events, focus/foreground and reconnect, keeping manual refresh. Include the assigned
or returning truck even when its station differs from the fleet list filter.

Use common Asia/Manila operational formatters and input previews.

### Mobile My Incidents and pending field reports

- Add a My Incidents shortcut and a pending-report count on Home. Keep current
  dispatch/route prominent; the shortcut opens a small stack screen rather than
  requiring a new account type or full navigation redesign.
- List only the authenticated person's assigned incidents, including cleared and
  completed assignments. Use a simple Pending Reports filter and a history/all
  view with pagination; show incident reference, location/date, incident stage,
  own assignment stage and field-report state separately.
- Team Leaders with verified reporting authority can open Submit Field Report for
  an eligible previous assignment. Ordinary personnel can view their own response
  history and authorized information, without gaining leader reporting authority.
- Reuse ReportScreen with the selected incident/dispatch context loaded from the
  backend. Do not source the historical form from status.dispatch or infer that
  losing the active dispatch means reporting is no longer permitted.
- Keep pending reporting visible while the team is Standby or assigned elsewhere.
  A submit for Incident A cannot modify Incident B's state, report or resources.
- Show Submitted/Recorded by Dispatcher/Not Required where supported by the
  reporting workflow so a resolved input does not stay pending forever. Do not
  make every team leader's final report a blanket incident-closure requirement.
- Preserve read access after incident closure; direct users to dispatcher review
  for corrections to finalized records. Keep current app draft limitations clear.

### Web

Keep dispatcher login and the existing internal admin role. Add consistent five-stage
cards/filters/details, per-team release/clearance, dispatcher completion and report
review/closure controls. Show Returning/Unavailable and readiness reasons.

Update maps, resource eligibility/coverage, notifications, timelines and exports.
Refresh authoritative fleet, incident and report state on events and reconnect.
Keep labels, metrics and allowed actions consistent with the backend.

### Analysis page and operational reporting

Incident status changes apply throughout Analysis, including response-record
tables, incident summaries, filters, counts, drill-down details, timeline labels
and exported reports. Use the same backend lifecycle_stage definitions as the
Command dashboard, incident register/details and mobile views. Analysis must show
Operation Complete / Report Pending consistently before administrative closure.

Keep a team's assignment status distinct from the overall incident stage in
dispatch-level analysis. Calculate response, suppression and overall-operation
durations from verified operational timestamps, not report submission/review or
the later Closed transition. Closing an incident must not lengthen its operation
duration. Returning travel/readiness remain separate from incident response time.

Preserve missing legacy evidence as unknown, and show non-fire suppression as N/A.
Changing labels/stages must not fabricate timestamps or silently change historical
metric eligibility. Use one classification and filtering policy across Analysis,
incident views, Metrics and exports.

## 9. Delivery targets and feature freeze

Targets guide prioritization; they do not claim unverified features are ready.

| Target | Deliverable |
| --- | --- |
| Nov 6-7 | Finalize two-account scope and regressions; fix casualties, eligible late arrival, fleet refresh and timezone behavior. |
| Nov 7-8 | Shared classification, minimal additive schema, backend release/report/closure guards; isolated migration validation. |
| Nov 8-9 | Native fire timing/clearance/return actions and dispatcher stages/release/completion/report-review controls. |
| Nov 10 | Combined two-team acceptance, concurrency, return/readiness and reconnect/restart testing. |
| Nov 11 | Physical-phone testing, corrections, migration rehearsal and demonstration preparation. |
| Nov 12 | Feature freeze; final builds, complete rehearsal, backup and documented limitations. |
| Nov 13 | Defense with the verified build and prepared demonstration flow. |

Keep corrective fixes independently reviewable from workflow expansion. Defer any
incomplete expansion rather than enable an untested lifecycle change. Activate the
coordinated workflow only after supported backend/mobile/web versions and migrations
pass combined acceptance.

## 10. Acceptance checklist

Use session doubles or an isolated disposable database, never routine test mutations
against the configured shared/live database. Preserve unrelated work and identify
baseline lint findings separately.

Checked items below mean source implementation plus local automated coverage,
not an actual-phone or organizational approval. Device delivery, background
execution and deployment remain separate acceptance steps.

- [x] Only existing dispatcher/personnel account types and logins are required.
- [x] Team Leader/Driver checks use existing assignments, with server-side ownership validation.
- [x] Mobile 1 injured agrees with incident details and exports; missing facts stay unknown. Live intake now submits an unknown casualty outcome unless confirmed.
- [x] Report submission/correction and direct incident edits cannot release all teams or make trucks available.
- [x] Eligible personal/vehicle arrival remains available after situation control.
- [x] Classification, timing, labels and metrics agree; native fire times are recorded and non-fire times are N/A. Consolidated drafts/review snapshots and native badges now use their correct context.
- [x] Dispatcher release and Alpha clearance affect only Alpha's authorized resources; Bravo stays active.
- [x] Radio readiness requests, app release authorization and physical clearance are distinct; notification receipt cannot clear a team or complete an operation.
- [ ] Release, clearance, readiness, report, completion and closure notifications reach the relevant users without duplicate or unrelated-team alerts.
- [ ] Missed push/offline clients recover pending actions; radio-confirmed dispatcher entries reconcile with later personnel retries.
- [ ] Responsible Driver retains return/readiness access after clearance and restart.
- [x] Release acknowledgment, actual clearance, return readiness and report status have independent effects; acknowledgment alone cannot make a team Standby.
- [x] A ready team with an unfinished field report can receive a new dispatch without losing the prior incident/report entry.
- [x] My Incidents shows only verified assigned responses; historical Team Leader authority is checked server-side and unrelated incidents are rejected.
- [x] Reporting for Incident A while Incident B is active affects only A and preserves B's current assignment/route.
- [x] Submitted/resolved field inputs stop showing as pending; finalized/closed history is readable with dispatcher-controlled corrections.
- [x] Returning/not-ready resources are excluded from ordinary automatic dispatch; captured Drivers remain assigned until Ready, including through Not Ready.
- [x] Driver removal/transfer/role/status changes and stale post-clearance manning cannot bypass custody; a concurrent new dispatch requires a safe roster-edit retry.
- [x] Ready confirmation affects the correct truck; faults keep it unavailable; dispatcher overrides require a reason.
- [x] Completion rejects unresolved responding teams and applicable missing fire out.
- [x] Closure requires completion and reviewed reporting; historical closure remains readable.
- [x] Dispatcher prepares the consolidated report; personnel field submissions retain attribution and never close the incident.
- [x] Analysis records, filters, summaries and exports use the same incident stages; reporting preserves operational clocks, reviewed consolidated timing is revisioned, and calendar filters use PHT.
- [x] Duplicate/stale/concurrent actions preserve timestamps and reject conflicting ownership or review.
- [ ] Fleet refresh recovers after events, reconnect, focus and foreground.
- [x] Operational times agree when the phone timezone differs from Philippine time.
- [x] Return telemetry stays attributable and outside incident response/suppression durations.
- [x] Web build, native Android JavaScript bundle and focused regressions pass.
- [ ] Real-phone foreground/background, restart and connection-loss flows are exercised before freeze.

## 11. Migration and rollout

Migration `backend/alembic/versions/0034_response_workflow.py` is prepared and was
validated only in disposable local PostGIS databases. It adds release authorization,
per-truck return ownership/readiness, report kind/revision/review, casualty review
and the latest standalone truck-readiness confirmation. Existing rows receive no
invented operational timestamps; existing reports are marked `legacy`.

For the intended database, prepare a backup first, then run `alembic upgrade head`
from `backend` with the intended environment after rollout authorization. Restart
the API and update both clients together. Old personnel report writes without
`workflow_version=2` are rejected rather than following the former Submit & Close
behavior. No commit, push, shared migration or deployment has been performed.

Actual-phone rehearsal still needs: two teams at one incident, radio authorization
followed by actual clearance, app background/restart during return, Not Ready then
Ready, an unfinished report followed by a new dispatch, loss/recovery of connection,
notification ownership, and a non-Philippine device timezone. Draft text is protected
when navigating away but is not persisted through force-stop/app removal.

1. Inspect migration head; prepare additive changes, isolated upgrade checks and
   backup/restore instructions for the intended database.
2. Preserve legacy incidents, reports, authorship and timestamps. Do not infer
   clearance, readiness or completion from report time.
3. Identify casualty/classification conflicts. Repair supported facts with an audit
   record; leave ambiguity visible.
4. Rehearse with both clients, in-flight responses and returning trucks.
5. Coordinate client capability/version; reject unsafe legacy Submit & Close writes
   after activation while preserving compatible reads.
6. Prepare concrete deployment/migration for the user's authorization. This plan
   does not imply a commit, push or deployment.
7. If rollback is needed, restrict new writes and retain readable history rather
   than restoring blanket report-triggered release.

## 12. Post-defense work and BFP validation

The two-account constraint is fixed. BFP confirmation does not require adding
commander, reviewer or fleet accounts.

For the defense, describe the simplified representation: dispatcher records
release instructions, completion, review and closure; assigned personnel confirm
field actions within their existing team positions.

Before operational adoption, validate actual instruction sources, accountability
and readiness checks, report ownership and assisting-station reporting obligations.
These are local-procedure questions, not a requirement to build more account types
or a delegation-management system before the defense.

Keep radio/voice in the application design, but do not claim that radio is mandated
in every circumstance. The published BFP manual has incident-specific restrictions
on radio/cellular communications; Panabo's current communications procedures govern
actual use. This project is not replacing or certifying those procedures.

Deferred beyond November 13:

- Separate team activity-log subsystem and mandatory per-team contributions.
- Generic delegation/permission management and additional approval hierarchies.
- Autosaved report drafts, assigned report-author workflows and separate review queues.
- Numerical casualty analytics and automatic duplicate-person reconciliation.
- Direct reassignment of returning trucks, alternate destinations and complex driver/shift handovers.
- Station-specific official-form/reporting integrations following local validation.

References previously discussed:
[BFP Operational Procedures Manual](https://region11.bfp.gov.ph/wp-content/uploads/2015/12/BFP-Operational-Procedures-Manual.pdf),
[FEMA demobilization guidance](https://emilms.fema.gov/is_0703b/groups/124.html),
[ICS 214 instructions](https://training.fema.gov/EMIWeb/IS/ICSResource/assets/ICS%20Forms//ICS%20Form%20214,%20Activity%20Log%20(v3.1).pdf).
They inform the proposal; they do not establish Panabo's current local SOP or make
a dispatcher account the real-world command authority.

## 13. Definition of done for the defense

- [ ] Seven verified inconsistencies addressed with focused regression coverage.
- [ ] Essential incident/team/truck actions work through the two existing accounts.
- [ ] Reporting, clearance, completion and readiness have independent effects and timestamps.
- [ ] Clients agree on state, classification, permissions and Philippine time.
- [ ] Historical facts remain intact; unknown evidence remains visible.
- [ ] Migration, builds, isolated acceptance and actual-phone results recorded.
- [ ] Documentation and demonstration accurately explain implemented and deferred scope.
- [ ] November 12 freeze has a verified build, backup, reproducible demo and known limitations.
