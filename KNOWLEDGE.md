# FireTrackr — technical knowledge base

## Basis and maintenance

### Cancelled incidents excluded from analytics (2026-11-13)

Metrics and Analysis exclude cancelled, canceled and recalled incidents from
totals, breakdowns, trends, response/operation cohorts, dispatch observations,
personnel deployment reports and their exports. Cancelled records remain in the
incident register and retain their cancellation history. No migration is required.

### Pending incident cancellation (2026-11-12)

The incident details archive icon becomes Cancel incident while pending and is
enabled after its dispatch list loads empty. Cancellation uses the same shared
confirmation dialog as archiving, with a required reason field. Other statuses
retain the archive action. `POST /api/incidents/{fire_id}/cancel` requires a trimmed
reason of 1–500 characters and locks the incident against concurrent dispatch.
Only unarchived pending incidents without any dispatch records or operation
completion qualify. The status event stores the reason, actor and server time;
details expose this as `cancellation`. Cancelled incidents remain in the register
and are excluded from active incidents. General edits cannot cancel or reopen
cancelled records. No database migration is required. Dispatch cancellation and
cancellation after dispatch are deferred in [the plan](plans-todo/incident-cancellation.md).

### Local PostgreSQL with Supabase photos (2026-11-12)

The configured API now uses a fresh local PostgreSQL/PostGIS database copied
from the current Supabase application data at revision `0038`. All 28 application
tables, 47,365 rows and 25 sequence states were verified during the copy; both
referenced private report photos downloaded successfully from Supabase Storage.
`DATABASE_URL` selects the local database independently of
`REPORT_PHOTO_STORAGE=supabase`. The previous local database and cloud database
were preserved. The snapshot, prior environment and verification records live
outside the repository in `local-backups/cloud-to-local-20261111T234100Z/`.
New application writes go to the selected local database; the retained cloud
database does not receive them. Keep the local API, PostgreSQL and ngrok running
for hosted dashboard/mobile access.

### Command routes end at arrival (2026-11-12)

The Command map hides main and alternative truck routes after confirmed truck
arrival, using dispatch arrival status/timestamps even when the driver's GPS
stops or becomes stale. An unarrived responder's shared approach remains a
personnel route through to the incident; it disappears on personal arrival.
This affects live map visibility and preserves generated routes for history.

### Hosted clients through a local ngrok backend (2026-11-11)

Backend browser CORS origins can be overridden with comma-separated
`CORS_ORIGINS`; defaults retain the Render dashboard and local Vite origin and
include Expo web on localhost/127.0.0.1 port 8081. Native Android requests do not
require a browser origin. Dashboard `VITE_API_BASE_URL` and mobile
`EXPO_PUBLIC_API_BASE_URL` are embedded during their respective builds; backend
`PUBLIC_BASE_URL` controls reporter links and local photo URLs. See
[ngrok setup](documentation/ngrok-local-backend.md).

### Mobile milestones require team arrival (2026-11-11)

The leader's personal arrival alone no longer enables containment, suppression
start or Fire Out. These mobile actions also require the assignment to be
`on_scene`, which the assigned manning driver's truck-arrival confirmation sets
(or personal arrival for an assignment without trucks). The API enforces the
same prerequisite. Personal arrival and field reporting remain separate.
Existing fire timestamps are preserved; affected records need verified timing
review through the administrator operational-time controls before retrying an
arrival blocked by fire chronology.

### Team details navigation (2026-11-11)

Team details link to their station, assigned truck and personnel records.
The former View on map action was removed because it targeted the station's
coordinates while teams have no separate map pin.

### Personnel map focus (2026-11-11)

Personnel's Track on map applies the latest valid GPS position immediately,
including positions outside Panabo. This avoids a flight animation being
interrupted by raster/3D renderer startup camera synchronization. If GPS is
not yet available, the request waits for a valid location and centers once;
subsequent GPS updates move the pin without following it with the camera.
Incident View on map and other Command map destinations also apply their
camera position immediately, retaining repeated focus requests and constraint
bounds fitting without a startup-interrupted animation.

### Assignment history protection (2026-11-10)

Dispatch lists, response analysis, vehicle evidence and return-station displays
use preserved context rather than current team/station/truck assignments. New
dispatch snapshots also capture team code, station coordinates, truck identities
and member designations. Report author names/ranks are captured on insertion,
including ORM imports. Completed dispatch rosters do not follow later membership
changes. Personnel can still be removed from one team and added to another as
separate operations; temporary unassignment is valid.

Migration `0038` must run before this backend starts. It preserves missing display
metadata on existing dispatches and report authors using values available at
upgrade, labeling the metadata as a legacy baseline. It preserves all existing
snapshot keys and does not manufacture verified legacy roster/attendance records.
Original assignments already lost before upgrade cannot be reconstructed.
Personnel reassignment/removal and station relocation reject active responses
and unfinished truck return/readiness; incompatible personnel shift edits require
removing team membership first. Home stations remain independent assignments.
See [resource transfers](documentation/resource-transfers.md) for rollout and checks.

### Resource retirement and retention (2026-11-09)

Teams, trucks, personnel and stations now archive instead of being permanently
deleted. Personnel archiving disables account access without deleting identity,
reports or tracking evidence. Account access controls also cover administrators.
Administrator accounts are protected from disable actions, including attempts by
other administrators. Personnel enable and disable actions require confirmation.
Account Access filters enabled/disabled accounts alongside search and pagination.
Personnel tracking shows ACCOUNT DISABLED for disabled accounts in the table,
cards, details and exports, taking precedence over device/location signals;
these accounts are excluded from the Live Tracking count.
Archive browsing is centralized under Settings → Data → Archive, below Preferences,
with category tabs; account controls are under Settings → Account → Account access.
Completed/cancelled incidents archive while retaining dispatches, reports, photos
and historical analytics; resolved obstructions remain in history. New migrations
are `0036` and `0037`, after the existing workflow/model-name revisions. Validation
used a separate loopback PostGIS database. Hosted Supabase was subsequently
upgraded from `0035` to `0037` on 2026-11-09, with affected row counts unchanged;
the local application database setting was preserved.
See [resource archiving](documentation/resource-archiving.md) for contracts,
restrictions, migration steps and local checks. This supersedes older deletion
descriptions below.

This document began with source inspected on 2026-10-12 at commit `deb09e1`,
with implementation updates through 2026-10-20. It records code capabilities, not proof of a
live deployment, trained-model quality or successful field trials. Recheck source
when updating it. Shared development rules are in [AGENTS.md](AGENTS.md), with
commands in [CLAUDE.md](CLAUDE.md).

Evidence includes [README.md](README.md), backend routers/services/models/config,
AI and GIS code, migrations `0001`–`0023`, frontend API/App/pages/hooks/export helpers,
dependency manifests, environment examples, [.gitignore](.gitignore), custom skills,
the [coverage audit](documentation/response-coverage-algorithm-audit.md) and
[plans](plans-todo/). No manuscript is present in the tracked repository inspected.
Plans and docstrings are cross-checked against handlers and callers.

## Purpose and system overview

### Alarm escalation (2026-11-09)

Fire alarms progress through First to Fifth Alarm, Task Force Alpha through Echo,
with escalation toasts recognizing every upward transition. Both incident and
workflow WebSocket snapshots compare alarm ranks before replacing the previous
snapshot, so a workflow event arriving first cannot consume the alarm change.
Repeated snapshots of the same level do not produce duplicate escalation toasts.
Notification summaries also use the full shared alarm list.
The progression ends at General Alarm.
Intake, editing, filters, timeline and live notification ranks
share the dashboard progression. The escalation modal retains its three-step
`.eam-track`, showing a moving window of levels. Escalation proceeds only
after a separate confirmation summarizes the incident, alarm transition and selected
additional teams. Back or Escape returns to the selection without changing the alarm
or dispatching units. A warning appears before escalating
to Third Alarm. Persistent fire-colored cards beside the map-style control show
every active incident at Third Alarm and above, independently of incident-tab
selection, with the location name, incident ID and address. Cards clear when the
warning count falls to zero. Two or more warnings default to compact accordion
rows showing the name, ID and alarm; opening one closes the others. Expanded
rows hide their summary and provide a collapse button. A single warning stays expanded.
Cards also clear when the
incident leaves the active list or no longer meets the alarm threshold:
the dispatcher must request assistance from neighboring cities' fire stations.
This is guidance only; no external assistance request is sent automatically.
The supplied alarm table provides truck ranges and control guidance. Recommendation
targets use each range's minimum (4, 6, 8, 10, 15, 24, 28, 32, 36, 40, 44).
General Alarm selects all returned eligible teams, with a minimum target of 44;
recommendations are limited to 100 teams per request. External units outside the
resource roster are not counted or dispatched by this flow.

### Response Lab station return (2026-11-09)

Truck return payloads include the recorded return station's latitude and longitude.
Response Lab starts synthetic driver return travel after actual scene clearance,
retracing the approach and connecting to that station. The schematic path is not
road routing. Arrival opens driver Ready / Not ready controls; a not-ready truck
requires a reason and can be confirmed ready later through the existing workflow.

### Model-processing memory budget (2026-11-09)

Modal protocol 2 submits verified baseline/annotation inputs; the cloud worker
builds the complete training snapshot and checks its effective label hash against
the backend reservation. The API streams compact label summaries using `ijson`,
without prediction attributes or local Parquet/GeoJSON snapshot writes. Local
training retains full snapshots. Preview and export review also stream features.
Model summary/initialization, Modal reservation and result completion require
32 MiB working-set headroom in finite Linux cgroups; local reservation retains
96 MiB. The guard excludes reclaimable inactive file cache and retries after
garbage collection/glibc heap release before returning 503. Completion polling
retains pressured jobs for retry. The shared memory-work lock limits overlapping
large operations but cannot reserve memory against unrelated requests. Redeploy
Modal and the backend together; the source/protocol gate rejects older trainers.
See [Render trial notes](documentation/render-free-trial.md).

### Hosted health checks and road catalog (2026-11-09)

Render's Blueprint probes public `GET /health/live`, which checks the serving
event loop without a database query or thread-pool dependency. The dashboard
continues using `/health` for its API/database diagnostic. Neither certifies
routing readiness. Existing manually managed services must deploy the new route
and update their Health Check Path. Road catalogs stream only required GIS
attributes under the shared memory-work lock, and road-edge GET JSON encoding
runs in the worker thread. See [Render trial notes](documentation/render-free-trial.md).

### Response and Operations shift comparison (2026-11-09)

Shift comparison appears below team analysis in a separate `.ro-shift-analysis`
disclosure, collapsed by default with the same header style as team comparison.
It shares the analysis window and page refinements, uses dispatch dates,
and defaults to initial assignments. A dedicated filter panel controls interval,
assignment and median/average/p90. Preparation, travel and dispatch-to-arrival
use two shift lines with hourly buckets for windows up to two days, daily up to
62 days, and monthly otherwise, in Asia/Manila. Missing periods remain gaps.
Statistics and quality counts sit beside the chart in the team trend grid layout,
stacking on smaller screens. Selecting a period scopes those statistics;
clearing it restores raw-sample statistics for the full window.
The response-performance summary includes `shift_comparison` groups for all,
initial and reinforcement assignments. Legacy current-metadata attribution is
counted and disclosed; unknown shift labels are omitted and counted separately.
Suppression and overall operation durations are not assigned to a shift.

### Response and Operations filters (2026-11-08)

Response and Operations offers only Recorded Operational Times in its Timing Data
selector. The synthesized BFP history option is no longer exposed on this page.
Analysis Window and refinement filters use title-cased labels and displayed values.
The page refresh and stage-selection clear buttons are removed; existing filter
resets, chart selection toggling and automatic refresh remain available.

### Reporter contact display (2026-11-08)

Incident responses include separate `reporter_name` and `reporter_contact` fields
alongside the existing `reporter` display fallback. Incident details shows the contact
number separately. The edit modal prefills both stored values, reviews the actual
previous number, and sends only changed fields; clearing the contact removes it.

### Incident report export (2026-11-08)

Incident details places Export beside Edit and Delete. Its preview modal offers
PDF and editable DOCX, a custom title, portrait/landscape orientation, A4/Letter/Legal
paper, content switches, optional signature lines, and a file name. The PDF preview
renders actual document pages; Word uses native editable headings and paragraphs
with the same content, with possible pagination differences. Documents use letterhead,
numbered sections, open fact layouts and full-width narratives rather than register
tables. Sections use deterministic narratives based on recorded incident, report,
assignment and timing data. Summary wording distinguishes Interim/current information
from Final/closed records, names the report source and severity separately, includes
the address/area, and includes structure and alarm statements only for fire operations.
Casualty statements preserve recorded observations without summing team reports.
Responding teams appear as separate blocks below the introduction, with a shared local
team icon and editable Name/Team Role crew tables. Roles use assignment `member_role`,
not personnel designation. Unit reports use bordered blocks headed by the recorded
report author and team, grouped under one numbered Unit Reports section. Missing
submissions are headed Awaiting Team Report with their team name. Milestone history
uses an editable Action/Time/Source table with human-readable event and source labels,
Philippine-time timestamps and the recorded actor; unverified/corrected events remain
identified. Unknown codes are converted to words. Section numbers use fire orange
and section labels use Title Case.
Incident and unit analysis show four icon cards with prominent duration values plus
a colored proportional bar and percentage legend. Bar percentages use the sum of
available nonnegative processing, preparation, travel and applicable suppression
durations; missing stages are omitted, zero stages have no width, and an empty total
shows a no-data state. Unit analysis has its own bordered block and unit icon.
Analysis Status and Timing Basis fields are omitted; preliminary and synthetic
context remains in the narrative. Missing crew rosters remain explicit. Missing
field values display as dim dashes in both formats; pending submissions, unreviewed
reports and non-applicable metrics retain their explicit status. Content switches
select the incident summary, responding assignments and crew,
attributed unit reports, overall report, and response analysis. Open incidents retain
Interim classification; closed incidents retain Final classification even with a custom
title. Missing submissions and pending reviews remain explicit. Optional response
analysis includes incident/truck durations, planned travel comparisons and milestone
history; open analysis is preliminary and synthetic timing is labeled demonstration
data. Opening/retrying the modal reads a fresh authenticated snapshot, shared by the
preview and download. Requested sections that fail to load block download until retried
or deselected. Times use Asia/Manila. Photo counts are included; photo images remain
on the incident page rather than embedded in the document.

### Command route popups (2026-11-08)

Personnel pin cards omit the kind label and provide a View personnel button
below the GPS update line. `/personnel?personnel=<per_id>` opens that person's
detail pane after the roster loads; the query survives login and browser history.

Clicking truck or personnel routes opens a card with a route icon, route type,
unit name, distance and ETA. Truck metrics describe the stored route; personnel
distance describes the displayed segment and ETA is unavailable because the
connector response has no travel-time metric. The Routing tab omits deviation
cards. Personnel approaches hide for off-duty, stopped, stale or arrived units;
GPS fixes expire after the greater of 60 seconds or three tracking intervals,
checked every 15 seconds even if no new location response arrives.

### Resource status and register filters (2026-11-07)

Returning badges use amber and the Dispatched blinking dot on Personnel, Teams,
Trucks, and station resource lists. Personnel adds team and tracking filters;
tracking offers Live and Offline choices and follows fresh location updates.
Resource exports include these filters.

Incidents offers a Range control beside the date presets. `GET /api/incidents`
accepts `period=custom`, `date_from`, and `date_to` as inclusive Asia/Manila
calendar dates. Calendar inputs apply immediately when either date changes;
leaving From blank has no lower bound, and leaving To blank includes through
today. Clearing both restores All Time. Malformed, reversed, or future dates
return HTTP 422. The range applies before status counts, list
filters, and pagination, and is preserved in register exports. Presets clear it.
The incident register export modal also offers a Date range filter immediately
below Office: current page filters, all time, or a custom From/To range. It
refetches matching rows for the preview, PDF/Word/CSV download and printing while
preserving other incident filters. Invalid ranges and pending requests block
export actions; resource export modals retain their existing snapshot scope.
The incident export column options include Cause immediately after Units,
enabled by default for PDF/Word/CSV. Register and Metrics share cause precedence:
the imported BFP source cause, then the latest nonempty incident-report cause,
otherwise Not recorded. Register list/detail APIs expose the selected cause.

Metrics uses the same Range control and immediate date changes. Either boundary
can be left blank with the same meaning as Incidents, and clearing both restores
All dates. `GET /api/metrics/summary` accepts either custom boundary; the range
also limits chart history, selected-month breakdowns and export labels.

### Model display names (2026-11-07)

Model history offers an edit-name modal next to each review action. Administrators
can set a trimmed, nonempty display name of up to 120 characters through
`PATCH /api/models/{version}` with `{ "name": "..." }`. Names appear in history,
search, the current model and the review heading; version IDs and artifact paths
stay stable. Migration `0035` adds nullable `model_versions.name` and was applied
to the local loopback database. Other installations must apply it before running
the updated API. Names are shared registry data rather than browser preferences.
The retrain confirmation also accepts an optional model name below its message.
`POST /api/models/retrain` accepts an optional `{ "name": "..." }` body using the
same validation and saves the name while reserving the training job. Existing
requests without a body remain supported. If model status changes while the
confirmation is open, its status notice replaces the description and hides the
name field until the user closes and reviews the latest state.

### Incident deletion guard (2026-11-07)

`DELETE /api/incidents/{fire_id}` rejects deletion with HTTP 409 while any linked
dispatch is `dispatched`, `en_route` or `on_scene`, or a truck has started its
return without readiness confirmation. The check holds the same incident row
lock as dispatch assignment and clearance. Rejection preserves response records,
crew/truck state and report photos. The delete confirmation modal checks current
workflow status, explains any dispatch/return blocker inside the modal, and keeps
confirmation disabled until deletion is eligible.
Eligible deletions retain the existing child-record and photo cleanup behavior.

### Current local testing profile (2026-11-06)

Backend recovery on 2026-11-07 stopped duplicate Uvicorn reload instances after
one stalled during source reload while retaining port 8000. The recovered local
API uses a single server without auto-reload. The no-constraint routing path now
retains its existing graph and pool on unchanged synchronization polls; initial
startup and explicit forced reloads still build a replacement.

The ignored backend/frontend/mobile `.env` files now select the existing loopback
`bfp_capstone` database, local API on port 8000, and local Vite dashboard on port
5173. The native test APK uses an ngrok HTTPS tunnel to that API; backend public
photo/reporter links use the same tunnel. The local testing region was subsequently
changed to `new_corella` in both backend and frontend env files, and both services
were restarted. New Corella's OSM graph is online (19,246 nodes, 38,905 edges), with
raw travel-time routing and no predicted constraints. Panabo assets are preserved.
Local photo storage is enabled and SMS is disabled for testing.

The loopback database was backed up and upgraded from `0032` to `0034`, preserving
all existing table row counts, including 331 incidents. All four referenced report
photos are available on disk, including two recovered from private storage without
changing remote objects. The cloud database was not migrated or changed.
The signed standalone APK contains the verified ngrok URL and its own JS bundle.
Local API, Vite proxy, ngrok health and routing startup passed; actual-phone
acceptance remains pending. Subsequent network checks observed intermittent DNS
failures and ngrok reconnects on this PC; local API/proxy health remained OK. System
network settings were not changed. The workspace's `local-device-testing/` directory holds
the APK, restart instructions, setup record and logs; `local-backups/` holds the
pre-change env files and verified database dump. Neither directory is in this repo.

### Two-account response workflow (2026-11-06)

Implemented locally across the backend, web dashboard and separate personnel
client. The loopback test database now has additive migration
`0034_response_workflow.py`; other installations need it before running the updated
API. No shared/cloud database migration or hosted deployment was performed.

- Accounts remain `admin` (Dispatcher) and `personnel`. Existing team assignments
  determine Team Leader and Driver authority. The backend exposes `workflow_version: 2`,
  `lifecycle_stage` and `effective_response_kind` without changing stored incident
  status keys. Stages are Pending, Responding, Under Control, Operation Complete
  and Closed; fire operations display Fire Contained at Under Control.
- The incident editor displays the same five lifecycle stages, including a
  read-only Operation Complete step. Its current step and header recognize both
  the server lifecycle and recorded operation-completion timestamp. Editing other
  incident fields preserves the stored status; completion and closure remain
  dedicated Response & Reporting actions. Intake forms retain their existing
  stored-status choices.
- Assigned leaders submit attributed `field` reports, including prior verified
  assignments through mobile My Incidents. Historical roster evidence survives
  membership changes. Reporting for an earlier incident leaves a newer assignment
  intact. Closed incidents remain readable; dispatcher corrections go through the
  consolidated report. Unsent form text is not persisted across app termination.
  On active assignments, field submission requires the leader's own confirmed
  personal arrival. Truck/driver arrival alone does not qualify. The native action,
  My Incidents eligibility and report API enforce the same rule; blocked history
  entries show `report_blocker` and remain readable. Ended-assignment reporting
  remains available to verified historical leaders without inventing old arrival
  evidence. Reporting still does not require containment or release resources.
- Dispatcher reports are separate `consolidated` records with revisions and review
  metadata. Saving text/photos never clears teams, restores availability or closes
  an incident. Explicit Review & Close verifies the exact report revision and
  operational prerequisites. Existing reports retain `legacy` ownership/purpose
  rather than receiving invented review or operational timestamps.
- The reporting interface calls the final document **Incident Report**. For open
  incidents, Response & Reporting is the creation entry point: one field report
  prefills the editor through Review Field Report; multiple submissions are shown
  for an explicit starting-report choice; no submissions still permits preparation
  from confirmed information. Original submissions/photos remain available as
  evidence. Report preparation and editing pool submitted scene photos in a compact
  horizontally scrollable picker, with source attribution available on hover and
  in the save review. Clicking a thumbnail opens the shared scene-photo viewer
  with navigation and keyboard controls; the separate checkbox selects the photo.
  Closing the viewer returns to the report draft. Selected photos share the existing stored image;
  original submissions retain their attachments. New uploads, existing attachments
  and field selections share the eight-photo limit. The administrator save contract
  accepts optional `field_photo_ids`; the server verifies same-incident field/legacy
  ownership, deduplicates stored images and audits source photo/report IDs. Report
  JSON retains `photos` URLs and adds `photo_attachments` metadata (`photo_id`,
  `file_name`, `original_name`, `url`) for selection and stable duplicate detection.
  No schema migration is required. Closed records retain the existing missing-report recovery action.
  Workflow controls and the filed incident report share one **Response & Reporting**
  details section, with the global incident status pill used in the workflow.
  Workflow tasks reuse the unit-card and compact action-button styles; task
  statuses sit at the right of each task header as plain text (amber while waiting,
  grey when not prepared). Completion requirements name the responding teams
  beside truck icons instead of bare dispatch IDs. Labels use dim text in title
  case, and field-report counts use the shared command count badge.
- Dispatcher release authorization records the field command instruction. Team
  release and radio-confirmed clearance controls live in
  each Responding Units card on Incident Details, using compact `act-btn block`
  buttons. Authorize Team Release opens the shared web confirmation modal with
  the selected team/dispatch, final-team work warning and inline save errors;
  the release request is sent only after confirmation. Response & Reporting
  shares the same workflow state and focuses on
  operation completion and reports without a second team list. Actual
  leader clearance (or a reasoned dispatcher radio confirmation) ends only that
  dispatch and starts its trucks Returning. Receipt of a notification has no state
  effect. The captured responsible Driver retains return/readiness access after
  clearance, incident closure and app restart. Back at Station / Ready restores
  availability; Back at Station / Not Ready records a fault/replenishment reason.
  Confirmed station arrival ends crew Returning even when the truck is Not Ready:
  the on-duty crew is Standby, the truck stays Unavailable, and unfinished readiness
  still blocks manual/automatic dispatch and Driver reassignment until Ready.
  All trucks must have arrived before a multi-truck team leaves Returning.
  Team/personnel reads derive this distinction for older Not Ready records without
  rewriting their timestamps; off-duty personnel remain Off Duty after return.
  Generic fleet edits cannot bypass unfinished returns. Standalone maintenance
  readiness also requires a dispatcher reason, with actor/time stored on the truck.
  Dispatcher return/readiness recording lives in **Trucks > selected truck >
  Return & Readiness**, with a confirmation modal and mandatory radio source or
  reason. Incident Details omits truck return/readiness status from Responding Units.
  Truck JSON adds `pending_return` with the original dispatch-truck ID, response
  team and return station, so unfinished returns remain accessible after incident
  closure. The existing readiness endpoint and responsible-Driver permissions
  remain unchanged.
- Incident Details includes the five-stage progress timeline beneath the hero
  statistics, with the shared Edit Incident step styling. Responding unit cards
  show only the station below the team name and the arrival clock time. On Scene
  uses amber in web/mobile status badges, personnel indicators and map pins;
  completed and cleared states retain green.
- Normal release preserves on-scene coverage. Before Fire Out, a fire-response
  team can be authorized/cleared only while another distinct, uncleared team is
  already on scene; dispatched/en-route/ended assignments do not count. Final-team
  release requires Fire Out and the dispatcher's audited confirmation that the
  team's assigned work is finished. Every new authorization explicitly confirms
  that work through `POST /api/workflow/dispatch/{id}/release` with
  `{ "work_finished": true }`. Authorization and actual clearance both recheck
  eligibility under the incident lock; parallel clearances cannot remove the last
  team. Legacy final-team authorizations need confirmation/renewal, not backfilled
  evidence. Web/mobile status exposes the shared `release` eligibility and reason.
  Mobile orders personal arrival/control ahead of separate release/reporting tasks;
  field reports remain independent of containment and never release resources.
- Dispatcher operation completion requires all eligible responding teams cleared
  and fire out for fire operations. Returning trucks can remain unavailable after
  the incident closes. Return GPS preserves driver/truck attribution and stays out
  of approach tracks, response routing, suppression and response-time evidence.
- The Command incident panel counts only active, uncleared scene assignments and
  keeps ended assignments under Response History across live updates and reloads.
  Acknowledgement, departure and arrival broadcasts update the shared dispatch
  list used by the team cards and On Scene / En Route counts. Personal arrival
  counts toward team arrival only when the server confirms the dispatch is on
  scene; delayed milestone events cannot revive cleared teams or undo arrival.
  Drivers who confirmed personal arrival before claiming their truck can use
  Confirm Truck Arrival in the mobile incident modal after claiming it. This
  records the vehicle arrival explicitly and preserves the personal arrival time.
  After every responding assignment has confirmed clearance, its summary shows
  All teams cleared and links to Response & Reporting. Cleared assignments have
  no response route controls, fallback warnings or deviation panels. Release
  authorization alone preserves the team's on-scene assignment and routes; return
  readiness, operation completion and closure remain separate confirmations.
  Personnel deviation panels show status, detection time and team; manual
  Force Reroute remains one control per active dispatch in its route group.
- Casualties use one shared text summary, e.g. `0 fatalities | 1 injured`.
  Missing facts remain Unconfirmed. The first field observation is provisional;
  other teams' observations remain separate, without summing or silent overwrite.
  Dispatcher consolidation/review owns the canonical outcome.
- Known operation type controls classification, fire timing eligibility and metrics.
  Contradictory new declarations are rejected. Corrections retain previous timing
  facts and audit the classification change. Fire timing inputs and operational
  display use Asia/Manila explicitly.
- Arrived, assigned Team Leaders can record **Suppression Started** and
  command-declared **Fire Out** from the native incident's Fire Milestones controls,
  without a narrative or report. `POST /api/workflow/dispatch/{id}/fire-milestones`
  accepts `kind` (`suppression_start` or `fire_out`), timezone-aware `occurred_at`
  and an `idempotency_key`. Ownership, current leader authority, personal arrival,
  active response and incident-row locking are enforced server-side. Saved retries
  reconcile after clearance; conflicting updates require dispatcher correction.
- Verified Fire Out is accepted with unknown suppression start through personnel
  milestones, dispatcher milestones, reports and corrections. The start remains
  null and suppression duration remains missing; known receipt, dispatch, arrival,
  containment and fire times still constrain chronology. Fire Out does not release
  a team or finish an operation. New personnel Fire Out entries require the incident
  to be marked contained first. If Fire Out was already recorded while Responding,
  the leader can recover the status through `/api/dispatch/{id}/contain` with a
  verified `occurred_at` at or before Fire Out. The native confirmation leaves this
  time blank until selected; the API checks known chronology and preserves the
  original Fire Out. A stale containment action without that time remains rejected.
  Fire milestone events reach incident participants while
  team release events retain their team scope. No additional migration is needed.
- Web Response & Reporting provides per-team release/clearance, return readiness,
  field submissions, completion and review/closure. Register/Analysis labels,
  summaries, filters and exports share the derived stages. Workflow events clear
  fleet caches and refresh open views; mobile also refreshes on reconnect, focus,
  foreground and polling. Outstanding tasks are loaded from the backend after
  missed notifications. Push delivery and actual-phone background behavior still
  require a device rehearsal; radio remains the operational communication channel.
- The Command map removes incident pins and response routes at Operation Complete,
  including live updates, reloads and reconnect recovery. Contained/Under Control
  incidents remain visible until the operation ends; Fire Out alone does not hide
  them. Completed incidents remain in the register and Response & Reporting for
  report preparation, review and explicit closure.

Implementation and rollout checks are recorded in
[the workflow plan](plans-todo/mobile-web-operational-workflow.md).

### Follow-up workflow fixes (2026-11-06)

- Recommendations and assignment share `services/resource_availability.py` checks
  for team readiness, the team's own truck, active personnel and unfinished returns.
  Recommendations batch availability reads across teams; assignment rechecks the
  same conditions under locks before reserving resources.
  A lost automatic recommendation returns the already saved incident with
  `auto_dispatch.status=no_team_available`; a successful automatic assignment
  returns its actual Responding stage. Intake retries are not required to recover
  from an unavailable candidate.
- Captured Drivers cannot be removed, transferred, have their assignment role or
  status changed, or receive another dispatch until their return has `ready_at`.
  Not Ready keeps that responsibility open. Web roster controls show the same
  server-provided reason. Membership/dispatch writers serialize shared personnel
  using sorted transaction advisory locks. If a new dispatch appears while taking
  the team lock, roster editing returns 409 for a fresh retry before changing data.
  Stale truck manning requests after clearance/completion also return 409 and do
  not remove return custody or GPS attribution. Normal claim/release retries remain
  idempotent. Pending field reports still do not prevent a ready team's assignment.
- Personnel lists/filters/counts/exports show Returning; active or returning work
  remains visible across shift rollover. The separate duty flag still controls GPS
  privacy. Native Home/map crew status uses active assignments and physical return
  evidence; pending truck readiness is displayed separately from Standby and GPS
  collection mode. Native report badges use the actual stage.
- Consolidated drafts show current verified timing. Review captures the timeline
  for the exact report revision; audited time or operation-type corrections bump
  that revision and invalidate review without changing the original closure time.
  Older review snapshots and personnel submission evidence remain available in the
  event history. Re-review is explicit and old review submissions are rejected.
- Live casualty intake defaults to unknown, not an inferred None. Incident calendar
  filters use Asia/Manila boundaries for Today, This Month and This Year, including
  month/year rollover. Counts and exports reuse the same filtered population.
- Dispatcher web controls include reasoned Back at Station / Not Ready for radio
  fallback. Mobile clearance alerts prefer the saved Team Cleared event, replacing
  a generic Dispatch Ended fallback even when the event arrives on a later poll.
  Web correction/review alerts respect notification preferences and do not duplicate
  report-prepared/submitted notifications.

These fixes add no migration beyond the prepared workflow migration `0034`.
The [audit and resolution record](plans-todo/mobile-web-operational-workflow-audit-2026-11-06.md)
records the targeted test/build results and remaining actual-phone acceptance.

### Incident control labels (2026-11-06)

- Dashboard incident status-pill spans use the compact non-fire label Under
  Control and omit indicator dots across Command, Incidents and Analysis.
- Personnel actions, timelines, notifications and register exports use
  "Fire Contained" for Firefighting Operations and "Situation Under
  Control" for non-fire or unclassified incidents. When operation type is absent,
  only an explicit fire response classification enables fire wording. A known
  non-fire operation takes precedence over a conflicting legacy classification.
- Mobile status includes `dispatch_type` and `response_kind`; dashboard incident
  JSON also includes `response_kind`. Existing `contained` status values, event
  timestamps and the `/contain` API remain compatible; no migration is needed.
- Reports and milestone forms show suppression/fire-out timing only for fire
  responses. Situation control, each team's clearance, and command's existing
  operation-completion milestone remain separate. Report filing does not clear
  teams or restore resources; dispatcher review/closure is explicit and does not
  supply an operational completion time.

### GPS routing admission and connection use (2026-11-06)

- Accepted GPS uploads keep their existing history, deduplication, tracking
  policy and immediate position broadcasts. Automatic driver-online refreshes
  and deviation calculations share one process-local worker, with the latest
  pending calculation per dispatch/personnel pair. The queue holds at most 128
  waiting pairs; work older than 30 seconds is discarded. New GPS fixes can
  request current work again. These limits apply to derived routes, not uploads.
- Computation runs outside the AnyIO worker pool used by synchronous HTTP
  endpoints. Queued work holds no database session. Automatic driver and
  personnel calculations release their read transaction/connection during
  graph work, then revalidate route revision, dispatch activity, truck ownership
  and current-position checks as appropriate before saving. Manual navigation
  retains its existing transaction behavior. Shutdown discards pending work and
  waits for the running calculation before disposing the routing engine.
- The supplied Render logs and Events entry show a five-second HTTP health-check
  timeout around 10:45 AM Philippine time, graceful shutdown and recovery at
  10:46 AM. All 36 logged GPS uploads returned 200; no exception or memory-limit
  event is present in that excerpt. Overlapping route work and connections held
  during computation are confirmed code risks, not proof of the exact resource
  bottleneck behind that hosted timeout. The HTTP health contract is unchanged.

### Faster current-position route updates (2026-11-07)

- Claiming a truck queues a driver refresh immediately when its last accepted
  mobile fix is recent, after dispatch, and has recorded accuracy of 25 m or
  better. Missing, stale or inaccurate GPS retains the next-upload refresh path.
- Main and pool engines prepare ALT landmarks during construction, including
  replacement engines. Two-way position routing compares primary paths first
  and generates full options only for the chosen direction.
- Force Reroute, recommended driver navigation and automatic driver refreshes
  publish the primary route first. A separate bounded queue adds alternatives
  without replacing the selected route ID, geometry or personnel branches.
  Explicit fastest/alternative selections retain their objective. Completion
  rechecks route revision, dispatch/incident activity, manning, destination,
  obstructions and model generation; optional failures retain primary navigation.
- Route responses/events may carry `alternatives_pending`; completed option
  events use `options_only`. Dashboard consumers reject stale option events and
  retain options when a delayed primary response arrives. Mobile immediately
  refreshes a new primary and ignores option-only events.
- Local three-run medians on representative routes: New Corella 999.4 ms full
  before versus 278.8 ms primary first; Panabo 4102.2 ms versus 408.6 ms. Complete
  options remained identical in these comparisons. These are graph timings,
  excluding phone/network latency and persistence, not field ETA measurements.

### Dashboard URL navigation (2026-11-06)

- Screen selection follows browser paths: `/command`, `/metrics`,
  `/analysis/response`, `/analysis/coverage`, `/analysis/reports`, `/incidents`,
  `/personnel`, `/teams`, `/stations`, `/trucks` and `/settings`. The browser
  History API records screen changes and handles Back/Forward without restarting
  App's shared session WebSocket. Re-selecting the same screen adds no entry.
- Incident details use `/incidents/{fire_id}`; Analysis details use
  `/analysis/response/incidents/{fire_id}` or
  `/analysis/response/dispatches/{dispatch_id}?incident={fire_id}`. Analysis keeps
  its underlying workspace mounted while viewing details, preserving table state
  and focus on return. Station selection uses `/stations?station={station_id}`.
- Personnel assignment cards open `/teams?team={team_id}` with the assigned
  team selected and its details visible. Assigned cards support hover and keyboard
  activation; unassigned cards are disabled. Team selection links survive refresh
  and login redirects.
- Crew rows in team details open `/personnel?personnel={per_id}` with that
  person's details selected, using mouse or keyboard activation.
- Station and assigned-truck fields in team details open the corresponding
  station or truck details. Unassigned trucks retain the assignment action.
- Station detail team, truck and personnel rows open the corresponding resource
  details. Truck selection uses `/trucks?truck={truck_id}` and survives refresh
  and login redirects, like team and personnel links.
- Administrator-only `GET /api/incidents/{fire_id}` returns the existing incident
  JSON shape (404 when absent), allowing bookmarks outside the register's current
  page/filters. `/api/incidents/active` retains its earlier static route ordering.
- Signed-out bookmarks redirect to `/login?next=...`; successful login restores
  only recognised local destinations. Logout replaces the current URL with
  `/login`, and protected browser-history entries still require a session.
  Root/unknown paths fall back to Command or login. HTTP access checks remain
  server-side. The public backend `/report/{token}` GPS pages are unchanged.
- Vite development/preview serve the SPA for deep paths. Production static
  hosting must rewrite application paths to `/index.html` (HTTP 200); see
  [frontend setup](frontend/README.md). This change does not update live hosting.

### Dashboard incident alerts (2026-11-07)

- The latest 50 alerts, original timestamps and read/unread state persist in
  account-scoped browser storage across page reloads. Restoring history does not
  replay old toast popups. Remove, Clear all and logout also clear saved entries;
  storage failures leave the in-memory alerts usable.
- Toasts and alert history use neutral card surfaces. New alerts have a thin,
  dim fire-coloured border glow; read history returns to a neutral border. New incident
  and alarm escalation labels omit the extra Critical badge. Escalation icons use
  the fire accent; critical alerts
  retain their existing announcement and manual-dismiss behavior.
  Other toast notifications auto-dismiss after 20 seconds, with the countdown
  animation using the same duration.
- On-scene alerts use neutral borders and amber icons. Titles use the arrival
  role in title case (for example, Team Leader On Scene); descriptions show
  Name | Arrived at Location, with a dim pipe separator. Driver/truck arrivals
  use the same named-person format without duplicating the accompanying
  personal arrival event.
- Under-control alerts use a very dim green border glow. Response updates use
  neutral borders and muted gray icons, with amber for Suppression Started.
  Specific titles include Release Authorized. Their descriptions identify the
  team and next step (for example,
  Alpha | Awaiting leader confirmation), with a dim pipe separator. Team names
  resolve from the matching dispatch; incident-wide updates use the location.
  View details opens `/incidents/{fire_id}?section=response-reporting` and
  scrolls/focuses Response & Reporting. This action remains available after
  the incident leaves the map, and repeated clicks refocus the section.
  Suppression Started instead offers View response analysis, opening
  `/analysis/response/incidents/{fire_id}?section=incident-milestones` with
  Incident Milestones expanded, scrolled into view and focused. The section
  survives reload/login, and repeated alert clicks reopen and refocus it.
  Truck Ready and Truck Not Ready alerts use firetruck icons. Ready uses green
  and the description Team Name | Ready and On Standby; Not Ready retains a
  muted icon and unavailable wording. Existing history receives this formatting.
- Tracking offline alerts appear under the Tracking notification tab, with
  neutral borders and a muted gray Wi-Fi-off icon. They use
  title-cased titles and explicit text such as No new GPS locations received
  for 15 minutes. The reported duration reflects the age when the alert arrived.
  View last location restores Normal view and personnel pins, then focuses the
  person's latest fix or the alert's saved location at zoom level 18 or closer.
  Saved history retains this target; an explicitly focused old pin bypasses the normal
  eight-hour visibility cutoff without exposing other old pins.
- New incident icons use the shared operation classification: fire responses
  show a flame, while other and unclassified incidents show a beacon. Both icons
  use the fire accent.
- New incident descriptions label severity explicitly (for example, Moderate
  Severity | 1st Alarm), using a dim pipe separator in both toasts and history,
  including retained alerts. Fire alarms appear only when applicable and recorded;
  non-fire operations omit alarm text. Toast and history timestamps update every second,
  showing elapsed seconds, minutes, hours or days and refreshing on tab return.
  Both surfaces format descriptions when rendering, so notifications retained
  during a hot update also receive the severity label and applicable alarm text.
- An active incident's View on map action returns to Command's Normal view,
  enables incident pins, selects the incident, opens its Incident tab and zooms
  to its coordinates. Repeated history actions refocus the same incident.
  Closed incidents remain in session history without an active map action.

### Hosted dashboard startup and availability (2026-11-05)

- Development REST and WebSocket traffic uses the Vite page's origin, with
  `VITE_API_BASE_URL` selecting the proxy target. Production still uses the
  configured public API origin. This avoids local hostname/port CORS failures.
- Concurrent Metrics, coverage and Response & Operations reads share pending
  requests. Analysis reads remain uncached after completion; cancelling a page
  cancels its own consumer without aborting another page's shared read. Metrics
  and coverage retain their two-minute caches, with session keys and invalidation
  protecting against stale refresh responses. StrictMode's discarded initial
  dashboard setup sends no requests; GPS polls cannot overlap or run in hidden tabs.
- The stale-driver watchdog performs synchronous database and route work in
  an awaited worker thread, with the session created/closed there. WebSocket
  broadcasts stay on the event loop, and shutdown waits for a running scan.
  Four standalone fake-session checks cover liveness during a blocked query,
  cancellation cleanup, fresh GPS and stale route rebuilding. A health request
  completes within a 200 ms test deadline while that fake query remains blocked;
  this does not establish hosted latency or memory limits.

- Incident intake explains severity as overall incident seriousness used by
  sorting and reporting across operation types. Fire alarm selection, structure
  type and alarm escalation apply to Firefighting Operations; other known
  dispatch types save NULL alarm/structure values and display "Not applicable"
  in the general incident views.
  Legacy records with no dispatch type retain their existing alarm controls.
- Choosing Other for structure type reveals a required description (100-character
  limit). Both intake forms save the entered text in `fire_structure_type`;
  editing reopens custom values as Other without changing the stored value.
- Fire Metrics, the fire heatmap and fire-prone-area rankings share a fire-only
  population: Firefighting Operations, or an explicit `response_kind=fire` when
  dispatch type is absent. Known non-fire operations and unclassified records
  remain in the incident register and general response analysis, but do not
  affect fire counts, response KPIs, chart breakdowns or concentration weights.
  Existing historical imports already declare Firefighting Operations. New
  non-fire closures do not create heatmap points; existing points are filtered
  on read, without deleting any incident history.

- Metrics replaces the six-month shortcut with an inclusive Philippine-calendar
  date range. `GET /api/metrics/summary` accepts `period=custom`, `date_from` and
  `date_to` (YYYY-MM-DD); both dates are required, ordered and cannot be future
  dates. KPIs, monthly activity and breakdowns use this window; a chart-month
  selection intersects it. Exports retain the selected dates.
- Reporter links default to the configured API origin, with optional
  `VITE_PUBLIC_BASE_URL`. SMS uses backend `PUBLIC_BASE_URL`, falling back to
  `RENDER_EXTERNAL_URL` on Render. Vite proxies reporter pages and API/WebSocket
  traffic to its configured backend. Update any deployed public-URL override
  when moving hosts.

- The login health indicator allows 30 seconds per request and retries temporary
  fetch failures, startup HTML and gateway errors within its 90-second recovery
  window. Sustained failures say status is unavailable rather than asserting that
  the API is down. Sign-in remains available; database failures retain their own state.
- Command startup and WebSocket recovery request
  `GET /api/dispatch?active_incidents_only=true`. The optional server filter keeps
  dispatches whose incident is pending, active, dispatched or contained, including
  completed/recalled crews belonging to those incidents. Full and per-incident
  history remain the default for other callers. Administrator access is required.

### Coverage and retraining resource limits (2026-11-04)

- Cold isochrone/gap requests and overlapping forced refreshes share one coverage
  computation per API process. Planning waits for initial isochrones before asking
  for gaps. Station/model invalidation advances a revision; an in-flight result
  cannot repopulate the cache after its inputs change. A racing computation retries
  current inputs once, then returns a retryable 503 if they keep changing.
- Coverage, model-summary/snapshot preparation, routing-overlay construction and
  replacement graph builds share a thread lock to avoid overlapping large temporary
  allocations. Ordinary reads and health checks do not take it. Retrain submission
  releases the lock and snapshot locals before cloud I/O; durable job reservation,
  acknowledgement recovery and candidate review/promotion behavior stay intact.
- Panabo no longer imports OSMnx and its plotting dependencies during API startup.
  The OSM adapter imports them on demand; the production QGIS road source is unchanged.
- Validation uses a new disposable loopback PostGIS database, the actual registered
  v1 bundle and mock private storage. Four simultaneous coverage requests previously
  performed four computations and reached 682.26 MiB resident memory on Windows.
  The final screen performs one and peaks at 481.50 MiB across coverage, mocked
  retrain preparation and routing/reload, with OSMnx/Matplotlib absent. Thirteen
  standalone regressions and two existing isolated inactive-station checks pass.
  Actual cloud training was not submitted;
  only snapshot preparation and a mocked runner were exercised. These local samples
  do not prove Linux container memory use or sustained hosted-load safety.

### List-query performance (2026-11-03)

- `GET /api/teams` eagerly loads station, team shift, truck, membership/personnel
  and personnel shift relationships, alongside the existing batched dispatches.
  Empty/unassigned teams remain included. The current five-team Supabase sample
  now takes three SELECTs instead of 28, without per-member queries.
- `GET /api/incidents` obtains its five status counters in one grouped query,
  retaining zero-valued keys. Stats still reflect the period before status,
  severity, alarm and search filters; filtered totals, sorting and pagination
  retain their prior behavior. A normal page now uses three SELECTs instead
  of seven, excluding authentication.
- Original and updated handlers returned identical full payloads in one
  read-only repeatable-read snapshot, including a filtered incident request.
  Sample fetch/serialization times were 3.50 -> 0.80 seconds for teams and
  0.59 -> 0.25 seconds for the incident page. These are individual local-to-cloud
  measurements excluding HTTP/authentication, not latency guarantees.
- All 41 focused checks passed on a fresh disposable PostGIS database, covering
  list query budgets, team details/dispatch flags, period boundaries, filters,
  pagination, access checks and existing team-truck/report workflows. Live API
  health and authenticated reads pass; anonymous/personnel list access is denied.
- The follow-up pass also batches Personnel, current map locations, dispatch
  routes/crews/trucks, station commanders and fleet stations. Scalar reference
  loads for the unordered personnel/location base lists use select-in batches
  so joins do not change their observed return order. Dispatch routes still
  belong to their individual dispatch and sort by rank with null ranks last.
- Current map locations batch active assignments and personal-arrival evidence.
  `arrivals_for` preserves modern-event precedence and verified legacy actor/time
  checks. Tracking policy accepts optional server-derived batches; other callers
  retain their existing live-query path. Multiple distinct active dispatches
  remain ambiguous, duplicate memberships do not create false ambiguity, and
  a vehicle's arrival still does not establish every crew member's arrival.
- Metrics current/prior counts and severity totals share one conditional
  aggregate. Response comparisons join scalar context metadata while retaining
  batched collections, historical snapshot precedence and first-arrival cohorts.
  All seven original/updated read handlers returned identical complete payloads
  in a fixed-clock, read-only repeatable-read cloud snapshot:

  | Read | SELECTs before -> after | Sample seconds before -> after |
  | --- | --- | --- |
  | Personnel | 44 -> 7 | 4.16 -> 0.66 |
  | Current map locations | 43 -> 6 | 5.14 -> 0.53 |
  | Stations | 2 -> 1 | 0.24 -> 0.10 |
  | Fleet | 5 -> 1 | 0.44 -> 0.09 |
  | Metrics summary | 22 -> 15 | 2.31 -> 2.08 |
  | Response comparison | 30 -> 17 | 4.31 -> 3.24 |
  | Complete dispatch history | 1,167 -> 4 | 114.08 -> 5.18 |

  Metrics timing is the median of three further paired runs with alternating
  execution order; the initial single run varied despite fewer queries. Other
  timings are individual samples, excluding HTTP/authentication. Collection
  batches can split at larger sizes; these counts describe the current dataset.
- All 78 focused checks pass in a fresh disposable PostGIS database after this
  pass. They cover query growth, optional relationships, route ownership/rank,
  current/prior counters, month boundaries, personal/legacy arrivals, duty,
  ambiguous assignments, role checks and the earlier team/report workflows.
  Planning's computed coverage cache and Settings' bounded account/history reads
  remain in use; the station-read improvement also benefits Planning.

### Supabase database activation (2026-11-03)

- The configured development API now uses Supabase PostgreSQL 17.11 and PostGIS
  3.3.7 in `extensions`, through the TLS Session pooler on port 5432. The API and
  frontend still run locally. FastAPI continues to own authentication; private
  Supabase report-photo Storage remains enabled. `DATABASE_URL` selects the live
  database; `SUPABASE_DATABASE_URL` alone does not switch it.
- `database.py` supports `DB_POOL_SIZE`, `DB_MAX_OVERFLOW` and `DB_CONNECT_TIMEOUT`.
  Unset pool values retain 20/40; the prepared environment uses 8/4 and a 10-second
  connection timeout. The watchdog/reaper's held raw connections consume slots
  within that pool, not additional connections outside its maximum.
- The local PostgreSQL 18.3/PostGIS 3.6.2 source remains available at revision
  `0032`. A quiet final snapshot copied 54,412 rows across all 28 application
  tables, preserving IDs, accounts, hashes, revocations and operational history.
  Every table's count and canonical row checksum matched; 25 sequences and all
  51 foreign-key definitions were verified. The target uses revision `0033`.
- Rehearsal uncovered three legacy nullable dispatch attribution columns present
  only in the source database. The models and additive revision `0033` preserve
  them, including the recorded historical value. Downgrade refuses to discard
  non-null history. These text fields are not verified actor references.
- The session pooler initially returned `extra_float_digits=0`. `database.py`
  explicitly sets `extra_float_digits=3` on each physical connection, preserving
  full floating-point precision. Startup options were accepted but ignored.
- All 29 public application/migration tables have RLS enabled and public,
  anonymous and authenticated API-role table grants revoked. The backend's
  database role bypasses RLS, so FastAPI's role/ownership checks remain required.
  Platform and Storage schemas were preserved.
- Consistent source dumps, row exports, manifests and private environment backups
  are retained under `local-backups/`. The application-data restore was rehearsed
  on a fresh isolated PostGIS cluster, then trialed in a rolled-back cloud
  transaction before the final import. A full binary archive restore was not run.
  Reconcile any cloud writes before reverting to the retained local source.
- Live checks pass: API/database health, copied-account administrator reads,
  all 323 incident reports, four signed photo downloads matching their private
  Storage objects, denial of public photo access, and both advisory locks.
  Anonymous API access and personnel access to administrator incidents are denied.
  Password login and physical-phone submission were not exercised during cutover.
- Validation passed 59 isolated report/storage/migration checks plus a separate
  floating-point round-trip regression check. The application-data import also
  passed isolated and rolled-back cloud rehearsals before final activation.
- Backend tests refuse non-loopback targets and strip live Storage credentials.
  The disposable runner pins both database environment variables to its own new
  local cluster. See [database setup](documentation/supabase-database-setup.md)
  for target permissions, PostGIS schemas, copying, verification and cutover.

### Optional Supabase report photo storage (2026-11-02)

- `REPORT_PHOTO_STORAGE=local` preserves disk uploads and the existing URL shape.
  Supabase mode uses a private `report-photos` bucket through the Storage HTTP API
  with `httpx`, keeping the existing database `file_name` values as object keys.
  No database schema change, Supabase Auth integration or client SDK is required.
- The existing team-leader/membership upload checks and administrator report-read
  checks run before storage access. The backend owns `SUPABASE_SECRET_KEY` and
  signs a report's photo URLs in one batch (one-hour expiry by default). The
  dashboard preserves the remote hostname and signed query; only local `/uploads/`
  URLs are rewritten to its configured API base.
- Startup verifies the configured bucket is private. Supabase mode removes the
  local uploads mount. Completed uploads are compensated on later upload/signing/
  commit failures; incident deletion attempts storage cleanup after its commit.
  Cleanup failures are logged; crashes or ambiguous network failures can still
  leave unreferenced objects. Storage calls from async handlers use the thread pool.
- Existing local photos must be copied to the bucket root without renaming before
  switching modes. Reopen/refetch a report after its viewing links expire. See
  [storage setup](documentation/supabase-storage-setup.md).
- Live Storage activation on 2026-11-02 verified the private bucket and uploaded
  the two photos referenced by the local database. Their authenticated and signed
  downloads match the local bytes; public-object access is denied. All six local
  files were backed up and retained; four unreferenced files stayed local. The
  private environment now selects Supabase storage. After the development-server
  reload, API/database health pass, old local photo URLs return 404 and report
  reads without authentication return 401. At that stage the database remained local and no
  report records were changed. Physical-phone submission and visual dashboard
  acceptance remain unverified; no public app deployment is claimed.
- Local verification: 42 isolated backend storage/report checks and 23 focused
  frontend report checks pass, along with Python compilation and the frontend
  production build. Existing full-project lint/dependency findings remain; see
  the storage guide for scope and limits.

### Metrics month selection (2026-11-01)

- Clicking a month in Monthly incident activity filters Alarm levels, Incidents
  by barangay (including the map), and Top reported fire causes to that calendar
  month in Philippine time. Hover and focus inspect values without filtering;
  clicking or Enter/Space selects and pins the tooltip. The tooltip uses the
  Operational Times chart style with the full month/year, a plain incident count,
  and up to five reported causes. Months without recorded causes omit the causes
  section. The close button appears only for a selected month. Its close button,
  Escape or Clear month restores reporting-period
  breakdowns; selecting the same month keeps it pinned. Changing the reporting period clears
  the month selection. Overview KPIs and the chart history retain their own
  reporting-period scopes.
- `GET /api/metrics/summary` accepts optional `month=YYYY-MM` for the breakdowns.
  Monthly rows include stable `month_key` values so months from different years
  remain distinct, plus `top_causes` for tooltips without extra hover requests.
  These monthly cause rankings exclude the synthetic `Not recorded` label;
  overview rankings continue to show unknown causes explicitly.
  Selected-month requests and errors cannot replace a newer
  selection. PDF/PowerPoint exports use the visible breakdowns and label their
  month separately from the overview period.
- Metrics and Analysis methodology disclosures share `MethodNote.css`; report
  fire-operation fields show dimmed dashes when their values are unknown.

### Administrator after-action reports (2026-10-31)

- Incident Details shows Add report or Edit report for eligible incidents,
  including active and closed records. The dedicated modal contains cause, casualties, damage estimate,
  incident remarks, narrative and recommendations. General Edit Incident no
  longer edits or clears casualty/remarks fields when changing status.
- Administrator-only `PUT /api/incidents/{fire_id}/report` creates a missing
  consolidated report or updates the record identified by `report_id` and `revision`.
  A stale or mismatched revision returns 409. Narrative is required; existing photos,
  operational times, submission time and original leader attribution survive
  corrections. Report changes and the editing administrator are audited in
  incident events. New reports identify their administrator author directly.
- The November 6 workflow replaces the former report-triggered close/release.
  Saving a report leaves response and resource states unchanged and does not
  manufacture operation timestamps. Report casualty summaries and incident
  outcome fields are saved together. The dashboard refreshes reports and
  incident rows after local saves and report WebSocket events.
- Report reads include `closed_at` from the recorded closure event so a report
  added later does not move the incident's closure time. Unknown closure stays
  unknown for administrator recovery reports.
- Apply migration `0032_admin_incident_reports.py` before using this workflow:
  it adds the optional administrator author reference, permits reports without
  a personnel author, and expands incident casualty summaries to 255 characters.
  Existing leader-report submission and photo viewing remain supported.

### Dispatcher report photo additions (2026-11-02)

- The after-action report modal in Incident Details supports dragging/dropping or
  browsing for additional JPG, PNG and WebP photos, with previews and removal of
  pending selections. Existing attachments remain visible and are preserved.
  A photo-only edit enables save and appears in the existing review step. Failed
  saves retain the draft and previews; object URLs are revoked on removal/close.
- `saveIncidentReport` keeps text-only edits on the existing JSON PUT endpoint.
  When files are present it sends a multipart POST to
  `/api/incidents/{fire_id}/report/photos`, with JSON in `report` and repeated
  `photos` fields. This administrator-only endpoint uses the same locked report
  save, revision guard and notification behavior, without closing or releasing resources.
- The server enforces eight photos total including existing attachments, a
  10 MiB per-file limit and actual image format verification with Pillow. Report
  text and additional objects commit together; upload, signing or commit errors
  roll back the edit and compensate completed new uploads. Existing photos,
  leader attribution, submission time and operational evidence are preserved.
  The report audit records the administrator and `photos_added` count. No schema
  migration or mobile API change is required.
- Validation uses 57 checks on a disposable PostGIS database with live Storage
  disabled/mocked, and 35 focused dashboard checks. Synthetic-data browser review
  covers dark/light layouts, file-drop feedback and a 390px viewport without
  horizontal overflow. Real report data is not modified by these checks.

### Team truck assignment during dispatch (2026-10-30)

- Edit Team locks the truck field while the team has a `dispatched`, `en_route`
  or `on_scene` dispatch. Team responses include `has_active_dispatch` so this
  does not depend on the team's editable status label.
- `PATCH /api/teams/{team_id}` rejects assigning, replacing or removing a truck
  during an active dispatch with HTTP 409. An unchanged truck and other team
  edits remain allowed. The team row is locked while checking and saving,
  matching dispatch creation's team reservation lock. Completed, canceled and
  recalled dispatches do not block later truck changes.
- Active-dispatch truck hot-swapping is not supported; team edits do not rewrite
  the dispatch's truck assignment or its response history.

### Fire-report operational timing (2026-10-26)

- The assigned team leader can record actual suppression-start and fire-out times
  while filing the after-action report in the personnel app or Response Lab. Both
  use Philippine time and preview suppression duration. Fire contained at is fixed
  to the server timestamp of the containment action and is read-only in both forms.
  Unknown suppression/fire-out times remain optional; filing time supplies neither.
- Multipart `POST /api/dispatch/{id}/report` accepts optional `response_kind`,
  `suppression_started_at`, `controlled_at` and `fire_out_at`. Times require timezone
  offsets and chronological order. `controlled_at` may only echo the existing
  containment time; reports cannot add or replace it. Fire out requires a suppression start; existing
  verified milestones cannot be replaced. Unknown classification requires explicit
  fire confirmation before fire timing is accepted; non-fire reports remain supported.
- Report, incident milestones, attributed audit events and closure commit together
  under the incident lock. The containment status event records its occurrence,
  receipt, actor and dispatch when the leader confirms containment. Retries keep
  the original timestamp. Its time takes precedence over legacy report-added
  `op_fire_control` evidence; that older evidence is a fallback when no containment
  status event exists. `op_report_timing` keeps the submitted timeline by report ID,
  and report reads always use the canonical containment time. Existing columns and metadata
  store this evidence, with no migration. Report reads include `operational_timing`;
  mobile status supplies the same shape for prefilling. Existing clients may omit it.
- The dashboard report shows the saved event times and calculated suppression
  duration; Response Analysis uses the same incident milestones. Missing historical
  containment times remain unknown rather than being manufactured during reporting.

### Notification recovery and personal alerts (2026-10-26)

- Mobile alert history reads `personnel_status` and the effective personal route
  (`personnel_route_wkt`, falling back to `route_wkt`). Independent arrivals and
  approach changes now notify the signed-in person; another unit arriving does
  not announce that person as arrived. Payloads without the personal status field
  retain their previous shared-status fallback.
- Dashboard tracker-offline alerts require tracking eligibility. Off-duty pins
  remain stale for map display, but intentional duty stops do not generate device
  fault alerts. Genuine stale on-duty trackers still notify.
- The dashboard opts into `/ws?notifications=true` and retains its last
  `notification_cursor` for the current login. Replay checks current administrator
  access and token revocation. The server retains the latest 1,000 low-frequency
  lifecycle/model events in memory, without storing high-frequency GPS samples.
  Reconnect replays newer events in order, suppresses duplicates, and refreshes
  incidents, dispatches, locations and reporter pins. Initial connections silently
  seed the cursor; legacy mobile/lab sockets keep their live protocol.
- Replay remains process-local, consistent with the one-worker deployment. A
  restart or expired buffer cannot recover every old event: the dashboard emits
  a Connection Recovery alert and refreshes current state. The corresponding
  browser-local preference controls these notices. Alert history now survives a
  browser reload in account-scoped browser storage and is cleared on logout;
  there is no server-side alert archive or cross-device history.

### Complete Response Lab workflow (2026-10-26)

- Reopening an already-arrived responder keeps that person's accepted dispatch
  location even when stale. It never restarts at a route origin/station; absent
  a valid accepted fix, synthetic GPS is withheld. Saved arrival and current
  distance from the incident are displayed separately. Route completion more
  than 500 m from the incident cannot trigger automatic arrival.
- Response Lab now offers per-person initial locations selected on an interactive
  map or entered as coordinates before departure. The selected position survives
  dispatch and connects through the existing driver/personnel navigation APIs.
- Manual arrival, leader containment, scene clearance and after-action report
  filing use the existing mobile endpoints. Report submission supports narrative,
  cause, casualties, damage estimate, recommendations and optional scene photos;
  it closes the incident and releases all responding teams. These leader actions
  remain manual even when automatic travel is enabled.
- Mobile GPS ingestion locks the incident before inserting dispatch evidence.
  This prevents the observed foreign-key/incident lock cycle between simultaneous
  crew GPS and arrival confirmations. Ended dispatches are rechecked after locking.
- Zero-distance routes whose origin and incident snap to one road node now emit
  parseable LineString WKT with repeated endpoints, avoiding a PostGIS error when
  an already-arrived crew sends GPS. Distance and ETA remain zero.
- Street tiles require internet access; route overlays and coordinate entry remain
  available if tiles fail. See the sibling simulator's README for startup and
  disposable-database workflow acceptance commands.

### Independent personnel and vehicle arrival (2026-10-25)

- Personal arrival confirmation also accepts a sole truck's existing legacy
  dispatch-level arrival timestamp. It preserves that vehicle evidence rather
  than trying to overwrite it with the current confirmation time. The caller's
  personal arrival is still recorded independently and switches tracking cadence.
- Response Lab no longer swallows arrival conflicts or resubmits forced GPS on
  every animation tick. A rejected action holds an explicit error for retry while
  GPS follows its normal cadence; refreshed personal arrival resolves the hold.
- The dashboard now notifies on `personnel_arrived` as well as truck arrival.
  Personal arrival events include `personnel_name` and `member_role`, allowing a
  named leader alert even when the truck is still travelling. Both alert types
  respect the existing `onScene` preference; a driver's simultaneous personal and
  truck arrival produces only the unit alert. Previously the new personal event
  updated map state without creating an alert, which regressed notifications
  for both Response Lab and native-app arrivals.
- `PATCH /api/dispatch/{id}/arrived` records the authenticated member's own
  arrival in an attributed, idempotent `op_personnel_arrival` event. Only arrival
  by the confirmed manning driver also records its truck's arrival timestamp
  and status. A separately arriving leader or firefighter does not mark a
  still-travelling truck on scene or create a vehicle response-time milestone.
- Mobile status and live-location rows expose `personnel_status` and
  `personnel_arrived_at` independently of the dispatch's shared status. Tracking
  switches to 20 seconds for the arriving person; others retain their 3-second
  dispatch cadence until their own arrival. Response Lab and native personnel
  screens use the personal state. An arriving truck likewise does not stop a
  member who is still following their own approach.
- Arrival confirmations serialize under the incident/dispatch locks and retain
  the first timestamp on retries. Existing historical arrival timestamps are
  preserved. No database migration is required; personal arrival uses the existing
  incident-event audit table and does not count as vehicle arrival in metrics.
- Existing `crew_confirmation` vehicle-arrival audit events can also establish
  personal arrival for their verified authenticated actor. This compatibility
  reader matches personnel through the event's user ID, without copying a shared
  dispatch arrival to other members or rewriting any historical milestones.

### Personnel map pins (2026-10-25)

- Personnel pins follow the active raster or photorealistic map's tilt. Clicking
  a pin opens a card with the person's name, rank, team role, response team,
  station, response status, assigned truck and last-location freshness.
- A confirmed truck manning assignment replaces initials with a truck icon;
  releasing it or completing the dispatch restores initials. The optional
  `manned_truck` object (`truck_id`, `truck_platenum`), or `null`, is display
  metadata on the existing personnel-location poll and WebSocket payload.
  It reads the existing assignment, without changing dispatch, GPS or routing
  behavior. Stationary manning changes appear on the next 10-second location poll.
- Pin detail cards stay open through GPS and content refreshes. Projected maps
  re-anchor the same popup after marker/content updates, and the photorealistic
  renderer retains its marker and hover card for position-only changes. Manual
  close, clicking elsewhere, selecting another pin and removing the pin retain
  their normal dismissal behavior.
- The selected main route's traveled/remaining display follows only the confirmed
  manning driver's valid, non-stale fix. Personnel ahead of the truck do not trim
  it. Without an unambiguous truck fix, the full main route remains visible;
  individual personnel branches continue to display independently.
- Updated 2026-10-31: completed road segments no longer leave a faint dashed
  history on the command map. The truck keeps its own remaining route; a bright
  amber personnel approach covers any shared segment behind it that a fresh,
  still-approaching responder needs. Multiple followers share the segment from
  the rearmost position to the truck, and an off-route branch that merges behind
  the truck keeps its shared continuation visible too. Arrived/stale responders
  and hidden personnel layers do not retain these segments. Both web renderers
  consume the same route overlays. Web pins use received GPS positions without
  interpolation or dead reckoning; the native client's prediction is separate.

### Moving-truck route changes (2026-10-25)

- Route selection works without driver GPS, including an active dispatch whose
  driver is offline. It selects the saved path without requiring motion or an
  online phone. When fresh driver GPS is available after departure, switching
  recalculates from that position. Position routing snaps to the
  current directed road segment, includes its remaining distance/time and carries
  incoming-edge context into ALT to prevent reversing over the partial edge just
  traversed. Updated 2026-11-04: recalculation compares both available directions
  on two-way roads and selects the lower-cost route, restoring direction-independent
  planning. Recent GPS movement no longer locks the starting direction or triggers
  a turnaround loop. One-way roads and active obstructions remain enforced; the
  geometry still begins at the current GPS fix. Before departure, station-origin
  selection remains supported. School/private-access restrictions are not encoded
  in the current road graph, so this does not exclude all campus shortcuts.
- Explicit forced planning uses the station when driver GPS is unavailable.
  A manning driver's first accepted fix, or a returning driver's fix after an
  offline period, automatically replaces the plan with driver-to-incident routes,
  even when the fix is on the planned path and no deviation is detected. The chosen
  objective is retained when available; otherwise automatic refresh uses the
  available recommended path. Unreachable live routes retain the previous plan.
  Route replacement is atomic; original choices
  remain in route audit snapshots. Superseded background deviation work is discarded.
- Full route sets are broadcast to the dashboard and mobile clients after commit;
  the dashboard replaces changed IDs/geometry and surfaces selection failures.
  Response Lab holds its exact coordinates on disconnected revisions and lets the
  assigned manning driver request `POST /api/dispatch/{id}/navigation-refresh`
  after publishing a current fix. Other roles cannot use that truck-routing API.
  Non-manning responders use `POST /api/dispatch/{id}/personnel-navigation` for
  their own road approach without replacing the truck's routes. Mobile status
  additionally exposes that responder's `personnel_route_wkt`. The existing
  connector JSON attributes branches by personnel and selected-route revision,
  so one member rejoining does not erase another member's separate approach.
  The dashboard consumes branch WebSocket updates as well as location polling.
  Response Lab holds its coordinates while reconnecting, continues GPS and retries
  failed navigation every five seconds. The earlier driver-only simulator hold
  has been removed for non-drivers.
- Automatic manning-driver deviation routing uses the same exact-position road
  routing as manual route refresh, preserving the selected objective where available.
  Automatic deviation uses a 25 m trigger and a 10 m rejoin threshold. Entry
  requires two consecutive accepted mobile fixes outside 25 m, no more than
  30 seconds apart, both reporting accuracy of 25 m or better. Missing or poor
  accuracy preserves navigation state and cannot schedule automatic correction.
  Initial/returning driver refresh also requires reported accuracy of 25 m or
  better; explicit navigation requests retain their existing single-fix behavior.

### Separate personnel movement simulator (2026-10-25)

- The sibling `firetrackr_personnel_simulator/` project provides Response Lab, a
  standalone local browser client of the mobile API. It signs in personnel,
  watches their actual assignments, interpolates the selected routes and submits
  synthetic GPS with server-owned duty leases and 30/3/20-second cadences.
- Automatic response acknowledges/departs permitted roles, claims truck manning
  for drivers, and confirms arrival. It supports multiple accounts, pause/resume,
  speed controls, manual actions, route changes and sign-out revocation. Dashboard
  personnel are visible in normal view with that layer enabled at zoom 13+.
- The local bridge excludes administrator APIs and avoids CORS/auth changes.
  Simulator sessions remain in memory. Its schematic route preview needs no map
  provider key. It writes real mobile evidence to the configured backend; use demo
  accounts/incidents. Native phone/push behavior is outside its scope. See the
  [simulator guide](../firetrackr_personnel_simulator/README.md).
- Successful dashboard dispatch clears cached team availability, so a second
  manual dispatch dialog reloads the roster instead of offering the same busy crew.

### Unattended dispatch acceptance checks (2026-10-25)

- `tools/simulation/run.py` runs the real API and dashboard against a fresh local
  PostGIS database with synthetic accounts/resources, captures notifications and
  saves results/screenshots before removing its database. It exercises browser
  alarm escalation, three-team dispatch, mobile API actions and closure, then
  runs the existing web/mobile tests and web build. See the
  [runner guide](documentation/unattended-simulation.md) for prerequisites and limits.
- Dispatch creation now rejects busy crews/trucks and terminal incidents, with
  incident/team/truck locks and a single resource-reservation transaction. Report
  closure releases every active dispatch on the incident, matching administrator
  closure. Native phone UI/background behavior and external notification/map-tile
  delivery are outside this automation's acceptance coverage.

### Command incident panel interface (2026-10-25)

- Updated 2026-10-30: heatmap, road-obstruction and GAT-constraint tool panels
  remain expanded while their view is active. They share the camera controls'
  page-base surface, rounded border, spacing and orange view-heading icons.
  Panel bodies scroll on short screens; obstruction placement/cancel/removal,
  constraint editing, and heatmap preset/refresh controls retain their callbacks.
  Each heading has a CAMERA-style badge (HEATMAP, ROADS or GAT). Constraint
  helper text and obstruction section/help copy are removed. Heatmap uses
  All time / Last 30 days / Last 365 days presets without custom date inputs;
  its summary card shows the selected period and closed-incident count, with
  explicit loading/unavailable values instead of showing zeros during failures.
- Incident View retains its 290px dock and one full-width response action per row.
  Its height is capped at 520px (60% of the viewport height on shorter screens)
  and does not grow when heatmap or constraints changes the dock's available space.
  Tab content scrolls within the card. The redundant Report timestamps disclosure
  is removed; receipt time remains in the header and incident time in the Timeline.
  A clearer summary, labeled keyboard-accessible tabs, grouped report details and
  notes, and expandable team rosters replace the flat detail list. Team cards show
  station, truck, dispatch status and the team leader; rosters describe current
  membership rather than confirmed incident attendance.
  Updated 2026-11-07: report time sits beside the incident ID; status appears
  with severity and the applicable fire alarm. Non-fire/inapplicable alarm
  chips are hidden. The main section is labeled Details, with larger gaps
  after the response summary and before Assigned teams.
  Routing section headings match the 10px Details heading, and successive
  team route groups have a 21px gap (three times the panel spacing).
  Dispatch Routing uses title case, with the same 21px gap between its
  overview and the first team route group.
  Incident IDs use smaller, dimmer text. Leader previews separate the title and
  name with a dim pipe; leader, roster and sidebar headings use title case.
  Obstruction and heatmap view/summary headings and Refresh Data use title case;
  the redundant map helper paragraph is removed.
- Incident time and report receipt are separate fields; panel and timeline clocks
  use Philippine time. Unknown severity is neutral, closed incidents show their
  actual status and terminal incidents offer no response actions. Existing dispatch,
  escalation, route switching, reroute confirmations and map-layer controls remain
  wired to their existing callbacks. Short screens can scroll the dock above the
  independent camera controls. Presentation changes require no API or schema change.

### Metrics overview interface (2026-10-25)

- Updated 2026-10-30: barangay rankings show the top ten. Cause-count context
  appears below the ranking, and expandable methodology uses two sections for
  incident windows and response/data quality. Export PDF opens a focus-managed
  preview of the actual downloadable landscape PDF, using an immutable summary
  snapshot. Slides include KPIs, alarm levels, all monthly counts (twelve per
  slide), top-ten barangays and causes, period scope and missing-data context.
  Export settings now offer PDF or PPTX, title/filename/preparer/accent, individual
  section and visual toggles, value labels, optional supporting tables and preview
  zoom. Visuals include monthly lines, an alarm donut with counts/percentages,
  a projected GeoJSON barangay choropleth and cause bars. Missing boundaries fall
  back to rankings. PPTX embeds the same rendered preview images as widescreen
  slides (charts are not editable objects). PDF/PPTX generation and preview rendering
  load on demand; no new API is required.
  The metrics export modal reuses the incident export's `eim-panel`/`xpm-*`
  shell, zoom toolbar, settings sections, format icons and badges, switch cards,
  filename extension field and footer. Format cards select without radio inputs;
  printing uses the preview PDF for either export format.
- Metrics shares the centered 1440px workspace, responsive padding and heading
  typography used by Analysis. Period controls update the incident summaries,
  alarm breakdown, barangay counts and reported causes. Response analysis remains
  accessible from both the header and response-time card.
- Monthly context is explicitly labeled: All dates uses all recorded months;
  other periods retain the API's last-twelve-month context. The chart headline
  counts plotted incidents and an expandable table exposes every monthly count.
  Recorded incidents labels the existing total; response durations retain their
  separate verified-receipt cohort. Unknown measurements and historical source
  assumptions stay visible. Loading charts use skeletons; failures offer retry
  without presenting zeros as observations. Boundary failures preserve the counts
  and explain the unavailable map.

### Coverage Planning interface (2026-10-25)

- Coverage Planning shares the centered 1440px Analysis workspace, responsive
  padding and heading typography. The response-time budget controls its summary,
  sortable/searchable barangay table and CSV review; the map shows all three
  reachability bands. Selecting a barangay enables its status overlay and zooms
  to its boundary. The regional default zoom is also the map's minimum zoom;
  users can zoom in and return to that level. Map sizing follows panel changes
  and tables scroll internally.
- Coverage/population definitions remain unchanged. Thresholds and the area-weighted
  population assumptions appear under How to read this coverage. Superseded band
  replies are ignored; recomputation waits for fresh table measurements and failed
  barangay requests offer retry rather than implying an empty dataset.

### Combined response and operations analysis (2026-10-24)

- The combined view now uses a compact overview, grouped refinements with removable
  selections/reset, selectable response stages linked to the trend chart, and a
  common-sample distribution beside the chart. Team comparisons expand on demand;
  incident tables retain full CSV previews, bounded scrolling and sticky identifiers.
  The interface adapts to its available width in both themes. These presentation
  changes do not alter timing calculations or the API populations.

- Analysis now has Response & Operations, Coverage Planning and Operational Reports
  tabs. The first combines incident lifecycle cards/stages/trends and incident
  records with dispatch/team comparisons, quality counts and
  independently paginated full filtered incident/dispatch CSV reviews.
  Dispatch observations also have table-only team, response-quality and
  initial/reinforcement filters. These intersect the analysis filters and selected
  chart month, apply before pagination, and are shared by dispatch CSV exports.
  Table refinements and paging fetch dispatch rows independently of analysis cards
  and charts. The table's month dropdown and chart selection share the same month
  filter. Its reset icon clears that month and the other table refinements.
  Dispatch pages without derived-quality, reinforcement or snapshot-station
  refinements are counted and paginated in SQL before observation serialization.
  The view retains up to twelve exact dispatch-query results for quick resets and
  page revisits; operational events, manual/focus refreshes and the foreground
  timer refresh cached results while keeping their loaded rows visible.
  Incident records have equivalent table-only month, responding-team,
  call-to-arrival-quality and initial/reinforcement-presence filters, applied
  before pagination and shared with incident CSV export. The month dropdown is
  linked to the operational trend chart's selected month. Team and assignment
  filters select whole incidents without recalculating first arrival from a
  selected team; an incident can contain both initial and reinforcement dispatches.
  Demo timelines disable team/assignment controls because they imply no actual
  assignments. Incident page results use the same bounded, refresh-aware cache
  for quick resets; resetting clears its month and other table filters.
  Incident and dispatch table View actions open the same Response Analysis page;
  a dispatch link preselects that assignment. Older dispatch-ID-only entry points
  resolve the parent incident into the same review. The first-arrival metric has
  the strongest visual emphasis, beside incident-wide operation and suppression
  summaries. These totals remain unchanged when selecting a dispatch.
  Incident details appear directly below those metrics: address, barangay,
  incident occurrence and report receipt times, dispatch type, alarm, severity,
  structure, reporter and casualties, with expandable remarks. The operational
  detail payload includes the shared `incident_record` serializer, so these
  fields and the register link remain available without any dispatch assignment.
  A single dispatch selector scopes the assignment context, recorded timeline,
  truck travel/ETA comparison and responder map. Multiple trucks within an
  assignment have a separate vehicle selector. Dispatch evidence, interval
  quality, actor attribution, unit metrics, operational audit events and verified
  milestone entry sit in expandable supporting sections.
  Dispatch evidence groups the interval-quality comparison beside recorded
  actors and assignment context, with selected-truck timings and audit events
  below. On narrow screens, durations and quality badges stack within each row;
  missing attribution and current-metadata provenance remain explicit.
  The incident lifecycle has its own expandable evidence section. The page uses
  the shared details shell without the former context sidebar or nested dispatch
  page. Back restores the mounted table's filters, pagination, expansion, scroll
  and focused View button. Operational evidence refreshes loaded details in place.
  The combined review omits the generated-route history panel, keeping recorded
  responder GPS and the selected-route ETA comparison as the route evidence.
  Preserved route revisions remain available in the legacy dispatch modal.
  Verified milestone entry groups the event, classification and occurrence fields
  beside a live scope/time preview. The form labels Philippine time explicitly,
  preserves failed submissions for retry and shows inline save feedback, while
  reusing its existing confirmation API contracts and idempotency keys.
  Selecting a recorded milestone prefills its Philippine timestamp and the
  incident classification. The time remains editable; unchanged values make no
  request, and Keep recorded time restores the stored value after an edit.
  Administrators save timestamp corrections through
  `PATCH /api/operational-times/{fire_id}/milestones`, supplying the previous
  occurrence time for conflict detection. This also handles recorded dispatch
  clearance and classification times; classification values remain locked.
  Corrections preserve chronological order and append an attributed event with
  the old/new time, retaining original events and incident/dispatch status.
  A mirrored dispatch arrival follows its corrected truck aggregate so response
  metrics do not keep using a superseded time. Independent crew arrival evidence
  remains preserved. Original confirmation/mobile/report writers still reject
  timestamp replacement. Historical operations can be corrected without reopening.
  Response Analysis's single Responder Route History map also offers an optional vehicle-GPS
  layer when dispatch-unit GPS paths are available. Dispatch/member filters scope
  that layer without changing personal GPS counts or timings. Vehicle timing
  and selected-route ETA comparisons appear before the map.
  Operational trend points include a `breakdown` (common-cohort count, mean
  stage `seconds`, and metric `values`/`counts`), so chart selections update stage distribution for that timeframe.
  Each point also includes a full metric `summary`. Chart selections filter the
  lifecycle overview and stage KPI means, quality statistics and percentage changes.
  Changes compare the selected bucket (clipped to the analysis window) with an
  equal-length immediately preceding window, using the same filters. KPI measurements
  continue to include all valid stage samples in either distribution mode.
  Selecting the same timeframe again, closing the tooltip or clearing the selection
  above the stage cards restores the full-window KPIs and distribution.
  The distribution panel includes averages and sample counts and controls both
  views with All valid measurements (default) / Four stages recorded. The latter
  uses the same complete-incident sample for chart values and stage percentages;
  the former compares stage means without percentage shares. Call-to-arrival and
  overall operation are separate intervals available only in All valid measurements. The
  operational chart no longer has a separate chart-data table.
- Shared response timing helpers govern first arrival, chronology and the six-hour
  review guard across the combined view and retained APIs. Suppression and overall
  operation can exceed six hours. Incident cohorts use receipt/occurrence dates;
  dispatch cohorts use dispatch dates. Team filters affect dispatch comparisons,
  while incident first arrival includes all responding teams. Missing receipt
  prevents receipt-based measures but does not erase known truck travel times.
- The default is recorded operational evidence over the latest twelve calendar
  months, with recent-period/custom/all-date choices. Synthesized BFP timelines
  remain a separate source. No schema migration or stored timestamp changes are
  needed for this consolidation.

### Duty tracking and objective reports (2026-10-24)

- Operational Reports now uses three report choices, grouped filters, shared KPI
  cards, and a single deployment table with Personnel summary / Assignment log
  views. Wide tables scroll within their panels, severity scores include relative
  bars, and methodology stays in an expandable disclosure. Theme and mobile
  layouts retain the existing report populations and full filtered CSV exports.

- Original web/mobile source now includes duty-gated 30-second standby tracking,
  existing 3/20-second dispatch cadence, server policy leases, attributed/deduplicated
  phone history and explicit mobile acknowledgement/departure/clearance controls.
- Migration 0031 adds location attribution, dispatch clearance and operation
  completion without inventing historical values. It was tested on disposable
  PostGIS and applied to the original local database after a verified backup,
  preserving all existing row counts including 214 incidents.
- Operational Times exposes independently measured overall operation time and
  record-kind filtering. Analysis > Operational Reports adds audited roster-based
  personnel deployment, weighted historical barangay rankings and comparable-trip
  ETA errors with filtered CSV review/export. The weighted ranking lives in Analysis;
  Metrics retains its overview. Old rosters remain unknown and demo timing stays separate.
- See [implementation/review guide](documentation/capstone-objectives-implementation.md)
  for contracts, validation and limitations. Physical native-phone acceptance,
  retention policy and guaranteed next-shift background wake-up remain outstanding.

### Command station pins (2026-10-20)

- Clicking a station pin opens its details and a View station action in both
  themes. The action opens Stations with that station selected after loading.
  The popup uses the shared Leaflet overlay path for standard and enhanced maps.

### Resource export previews (2026-10-30)

- Personnel, Teams, Trucks and Stations Export buttons reuse the Incident register
  preview and formatting controls: PDF, Word (DOCX), CSV, paper size, orientation,
  document title/office, summary counts, signatures, columns and file name. PDF is
  the default; PDF/Word use the paged PDF preview and support printing. CSV uses
  the spreadsheet preview. All formats use the same snapshot of matching rows,
  preserving the page's filters and sort order. Close dismisses without downloading.
  Export is disabled while loading or when no rows match; download/print require
  at least one selected column. Analysis CSV review modals retain their controls.
- Resource CSVs use UTF-8 with a BOM, preserve quoted/multiline values and numeric
  zeros, and escape formula-like text. Filenames use the Philippine calendar date.

### Analysis CSV review (2026-10-20)

- Response Performance and Coverage Planning exports open a CSV review modal
  before download, reusing the incident register's spreadsheet preview. The
  preview shows up to 100 rows; download preserves the complete CSV captured
  when Export was clicked, including its filters and Coverage Planning time band.

### Local Analysis review data (2026-10-20)

The database review launcher and its review guides are local validation tooling;
they are intentionally not included in application commits. The following notes
describe that optional local setup, not a prerequisite for running the application.

- `backend/analysis_review.py prepare` clones the loopback database configured in
  this checkout into the fixed `firetrackr_analysis_review` database, excluding
  phone push tokens, then adds 24 explicitly synthetic test incidents and 40
  dispatches in one transaction. Repeats preserve the batch. It never replaces an
  existing database or writes fixtures into the original database.
- `analysis_review.py run` starts the same original app against that copy with
  SMS/GPS automation disabled; `.env` remains unchanged and normal `run.py` still
  selects the original database. See the local `documentation/analysis-test-data.md`
  for commands, exact expected values, limitations and return instructions.
- Fixtures use stored milestone columns to exercise Operational Times recorded
  mode only in the isolated database. That view does not filter `record_kind`;
  the test population must not be interpreted as measured operational performance.
- Coverage percentages use unsimplified cumulative reachable polygons. Map
  simplification is separate, and display bands retain the narrower polygons so
  larger time budgets cannot visibly lose previously covered areas.

### BFP historical import and metrics (2026-10-20)

The local database subsequently received a requested operational demonstration
history for December 2025–November 1, 2026: all 22 old 2026 incidents were replaced
by 37 complete incidents, while the 78 BFP records were preserved. The new batch
has natural display text, computed Panabo road routes, full timings, GPS, rosters
and reports; internal generation provenance remains in its audit events. See
[operational history](documentation/operational-history-2025-2026.md) for counts,
validation and backup locations.
The same-day route-history refresh separated all 37 generated pins within their
original barangays, kept their addresses intact, and added 99 continuous personal
GPS tracks (16,534 samples), alongside recomputed route/vehicle histories.
Response Analysis's route-history Team selector now switches its shared selected
dispatch, truck comparison and evidence together. All 78 BFP records are preserved.

**Operational replacement applied November 10, 2026:** the configured local
database now uses 78 real BFP CSV incidents, replacing the 319 provenance-marked
synthetic Analysis incidents while preserving 22 separately entered incidents.
The current importer preserves CSV coordinates and barangay names exactly,
including mismatches and the unresolved name. It uses the team's supplied CSV
alarm annotations (58 first alarm, 20 second alarm), with user-annotation provenance.
It generates no operational times, severity, casualties, damage or responding units. Dates display as
date-only; all 78 appear in the heatmap. The former demo import behavior below is
historical and is superseded by
[BFP operational import](documentation/bfp-operational-import.md).


- `backend/import_bfp_history.py` validates source Excel rows against the cleaned
  location review, prepares deterministic demonstration timings, and imports one
  incident per source record. It performs no schema DDL. A caller must back up the
  database and supply an explicit, reviewed list of dummy IDs before replacement.
  The task-local import artifacts and backup are outside the Git repository under
  the parent workspace's `outputs/bfp_history_import/` directory.
- The imported workbook contains 78 incidents dated 2023–2024. Actual times, alarm
  levels, crew assignments, severity and casualties were not provided. Source and
  normalized cause/category values, geocode review flags, and synthesized timings
  are preserved in one `incident_events` row of type `bfp_import` per incident.
  A unique content-derived `idempotency_key` prevents repeat imports. Synthetic
  operational timestamps stay in `event_metadata.synthetic_timeline`; they do not
  populate the actual incident/dispatch/truck timestamp columns. No fake team,
  truck, dispatch, route or personnel report is created for imported history.
- Alarm levels use the earlier reviewed showcase assumptions (58 first alarm,
  20 second alarm), not official BFP alarm observations. Source incident dates stay
  on their original dates, stored at midnight PHT with date-only precision noted
  in metadata. Unknown severity remains null and displays as Not recorded.
- `services/historical_incidents.py` batch-loads provenance. Operational analytics
  defaults to recorded data; `source=demo` explicitly selects synthesized import
  timelines. Real operational timestamps/dispatches take precedence. The current
  dashboard initially opens the labeled demo view and the All period. It
  provides a selector for recorded data. Demo timelines never enter recorded KPIs.
- `services/reporting_periods.py` supplies an All window from the earliest incident
  through now for Metrics and Operational Time Analysis; the old fixed historical
  API period remains supported. All has no previous-period comparison.
  Operational pagination returns `page_size=5`,
  `page`, `total`, and `total_pages`, with invalid high pages clamped to the last
  page. Compact numbered navigation with previous/next arrows sits at bottom right.
  The frontend cache includes the recorded/demo source. The details modal
  displays demo intervals without suggesting a real truck or historical route.
- Metrics retains the severity API for compatibility and adds `alarm_levels`,
  `top_causes`, source-quality counts, and the historical period. Causes count each
  incident once; imported source causes take precedence, otherwise the latest
  non-empty personnel report cause is used. Barangay counts prefer the known FK;
  legacy spatial fallback selects one polygon to avoid double-counting overlaps.
  Unresolved imported barangays are not inferred from approximate coordinates.
- The Metrics donut displays alarm levels with proportional slices and no fixed
  gaps, so small nonzero counts retain their arc length. The barangay map/ranking
  and top-ten cause bars sit side by side on wide screens and stack on smaller screens. The
  map refits to boundaries on resize. Unknown severity and response duration are
  shown as unavailable rather than synthesized into the recorded KPI cards.
- All 78 imports now have explicitly estimated heatmap pins: 52 address candidates
  inside the matched barangay, 25 reproducible points inside the barangay polygon,
  and one Panabo reference point for the unresolved Brgy Lemonsito address.
  `services/historical_pins.py` records the coordinate basis and limitations in
  `event_metadata.pin_specification`. These are not verified fire-site coordinates.
  Heatmap detail cards show the specification, date-only precision, and assumed
  alarm basis. Shared representative pins can create apparent area hotspots;
  they must not be interpreted as exact property-level clusters. The unresolved
  barangay remains null and is not inferred from its display pin. The local
  `incident_pin_specifications.csv` records the coordinates used, and
  `before_representative_pins.dump` preserves the database before this update.

FireTrackr supports BFP Panabo City dispatchers in recording fires, choosing response
resources, viewing routes and responder locations, and assessing station reachability.
It connects incident information and personnel/fleet status rather than requiring
dispatchers to reconcile those records manually.

```text
React dashboard ── REST + authenticated session WebSocket ── FastAPI
Separate mobile client ── personnel REST/location updates ──────┤
Reporter phone ── public /report/{token} GPS page ───────────────┤
                                                              ├─ PostgreSQL + PostGIS
                                                              ├─ local report-photo files
                                                              ├─ main routing graph + process pool
                                                              └─ PhilSMS / Expo push services
```

[main.py](backend/main.py) registers routers, explicit dashboard CORS and `/uploads`,
then loads routing, starts a worker pool and schedules background maintenance.
[state.py](backend/state.py) holds process-local connections, sessions and caches.
Request handlers use synchronous SQLAlchemy sessions; reusable behavior is in
[services](backend/services/). PostgreSQL advisory locks prevent duplicate watchdog
and token-reaper loops across server workers. They do not share WebSocket events.

The frontend uses URL paths and the browser History API for screen selection,
through [useAppNavigation.js](frontend/src/hooks/useAppNavigation.js) and
[appNavigation.js](frontend/src/utils/appNavigation.js). Pages and
modals call [api.js](frontend/src/api.js), while [App.jsx](frontend/src/App.jsx)
owns a persistent session WebSocket, event reconciliation and location polling.
The personnel client is not included here; its backend support can be verified,
but its installed behavior cannot.

## Implemented capabilities

| Area | Source-backed capability | Qualification |
| --- | --- | --- |
| Authentication | Separate admin/personnel logins, JWTs, profile editing, password changes, logout blacklist, successful login history | Local FastAPI auth; no Supabase Auth |
| Incident management | Paginated/filterable register, active list, creation/update/delete, alarm/severity/status history, details and reports | Event history records new changes; older incidents need not have complete history |
| Dispatch | Manual dispatch, auto-selection after intake, ranked escalation recommendations, selected routes, arrival and truck manning | Recommendations are read-only until dispatch; no explicit acknowledgement/en-route transition workflow |
| Resource management | Stations and substations, commander, personnel, shifts, teams/members and trucks | Some cross-resource consistency is by application convention rather than DB enforcement |
| Mapping | Incident/station/personnel markers, heatmap, region boundaries, constraint layers, routes and obstructions | Panabo is production; New Corella is a reduced local-development dataset |
| Location/rerouting | Personnel location history/current position, membership checks, truck synchronization, deviations, connectors/rebuilds and stale-driver fallback | Mobile updates plus WS events; dashboard also polls every 10 seconds |
| Reporter location | Admin sends PhilSMS link or receives a dry-run link; public page posts GPS; map receives broadcast/poll result | Sessions live only in memory; token expiry/registration enforcement is absent |
| After-action reports | Assigned team leader submits narrative/details and scene photos after containment; dispatcher can recover or edit reports and append photos | Configured private Supabase Storage with signed viewing links; local disk remains the code default |
| Notifications | Dashboard toasts, bell/history panel, configurable event alerts and WebAudio chime; backend Expo dispatch push with SMS fallback | Browser preferences and account-scoped alert history persist across reloads; logout clears history; no DB notification log |
| Metrics | Period totals/deltas, severity/containment counts, monthly/per-barangay data, first-arrival response averages | Missing measurements produce null/empty results rather than calibrated predictions |
| Coverage planning | 3/5/8-minute service areas, barangay coverage-gap tables, refresh and CSV export | Descriptive reachability, not station placement optimization |
| Incident exports | CSV, PDF and DOCX generated from a common register model with preview | Export fetch is capped at 5,000 rows |
| Settings | Account/security data and browser theme, map, session and notification preferences | Browser preferences are not shared server-side settings |

## Technology and dependencies

Exact backend pins are in [requirements.txt](backend/requirements.txt); frontend
ranges and resolved dependencies are in [package.json](frontend/package.json) and
[package-lock.json](frontend/package-lock.json).

| Layer | Declared or imported components |
| --- | --- |
| API | FastAPI 0.136.1, Starlette 1.0.0, Uvicorn 0.46.0, Pydantic 2.13.4, python-multipart, python-dotenv |
| Persistence | SQLAlchemy 2.0.49, Alembic 1.18.4, GeoAlchemy2 0.19.0, psycopg2-binary 2.9.12; PostgreSQL/PostGIS |
| GIS/graph | NetworkX 3.6.1, GeoPandas 1.1.3, Shapely 2.1.2, OSMnx 2.1.0, pyproj, pyogrio, pandas, NumPy, SciPy |
| Models | PyTorch 2.5.1, torchvision 0.20.1, torch-geometric 2.7.0; GCN/GAT/GraphSAGE/PMGCN classes |
| Dashboard | React/react-dom ^19.2.5, Vite ^8.0.10, Leaflet ^1.9.4, react-leaflet ^5.0.0, leaflet.heat |
| Exports/tooling | docx, jsPDF, jspdf-autotable, pdfjs-dist, ESLint 10, React hooks/refresh lint plugins, Vitest |
| External services | PhilSMS over HTTP; Expo push API; map tile providers configured in mapConfig.js |

Dependency completeness is an existing limitation: `security.py` imports `jose`
but `python-jose` is not declared. Default `GNN_INFERENCE_MODE=exported` with
`USE_RL=false` skips PyTorch/PyG and optional RL imports. Local GNN dependencies
live in `backend/requirements-ml.txt`; experimental RL still needs Gymnasium and
Stable-Baselines3 installed separately. SUMO/TraCI integration has optional runtime guards; enabling it also
requires external software and scenario files. README prerequisites are guidance,
not a verified version matrix for every current dependency.

Incident intake from the map and register records a dispatch type: Fire Safety
Enforcement, Firefighting Operations, Emergency Medical Services (EMS), Special
Operations, Fire/Arson Investigation, or Disaster Management. New incidents default
to Firefighting Operations; older incidents remain unspecified. The API accepts
`fire_dispatch_type` on create/update and returns `dispatch_type` in incident JSON.
The category is editable, appears in incident details, and is available in all
register export formats. It classifies the incident; crew selection is unchanged.
Apply migration `0024` before running the updated backend.

## Backend/frontend integration

- The login page checks public `/health` without credentials or cached responses.
  It shows checking, starting/reconnecting, API/database online, database unavailable,
  unreachable and browser-offline states, plus a manual check button. Slow requests
  show a waiting state after four seconds; each request times out after 15 seconds.
  Timeouts/gateway startup errors retry every five seconds for 90 seconds before
  showing unreachable; browser/network and invalid-response errors show unreachable
  immediately. After 90 seconds of failures checks retry every 15 seconds. Healthy
  checks repeat every 30 seconds. In development the health request uses Vite's
  same-origin `/health` proxy targeting `VITE_API_BASE_URL`, or the local API when
  unset; hosted production checks use the configured API directly. Checks pause
  while the tab is hidden and are canceled on unmount. A waiting state cannot prove
  that the backend is booting; `/health` is served only after startup completes.
  Online here means API/database availability, not routing-engine readiness.
- API base URL is `VITE_API_BASE_URL` (default same origin, using Vite's local
  API, health, upload and WebSocket proxies in development). WS URL is
  derived by converting HTTP to WS and appending `/ws`.
- Requests use bearer `bfp_token` from localStorage and the ngrok skip-warning
  header. A non-login 401 clears local credentials and reloads the page.
- Several resource, metric and GIS requests use a two-minute browser-memory cache.
  Mutations invalidate relevant entries; coverage has explicit refresh support.
- WebSocket event consumers reconcile incidents, dispatch/routes, resources,
  location, constraints and reporter pins. A 10-second personnel-location poll
  provides refresh/fallback behavior. WS authentication uses a query token.
- Common serializers define client shapes. Route results expose WKT strings that
  the dashboard converts from `lon lat` into Leaflet `[lat, lon]` arrays.
- Reports store public-base photo URLs; the dashboard rewrites their path onto its
  own API base to avoid tunnel interstitials on image requests.
- Notification preferences/theme/map/session settings use localStorage. Notification
  history is capped at 50 account-scoped browser entries, survives reloads and
  resets on logout. Toast visibility remains in memory.

Sources: [api.js](frontend/src/api.js), [App.jsx](frontend/src/App.jsx),
[useNotifications.js](frontend/src/hooks/useNotifications.js),
[serializers.py](backend/serializers.py).

## Database structure and relationships

[models.py](backend/models.py) defines the schema; [Alembic versions](backend/alembic/versions/)
define migration history. The combined web chain ends at `0033` (legacy dispatch attribution preservation).
Original `0025` adds constraint segment identities and `0026` adds the model registry;
both were applied to the original checkout's configured local database on 2026-10-19.
New `0027` adds operational timing. The original local database was backed up and
upgraded from 0026 to 0028 on 2026-10-20. The response-only worktree uses a different numeric chain;
do not reuse its review database with this combined branch.
PostGIS must already be enabled; migration files do not create the extension.

| Tables | Relationships and role |
| --- | --- |
| `users`, `admin`, `personnel` | Users hold credentials/role; admin/personnel profiles reference users. ORM treats profiles as singular; that alone is not a DB uniqueness guarantee. |
| `shifts`, `stations` | Personnel and teams reference shifts/stations. Substations reference a parent station; commanders reference personnel. |
| `response_teams`, `response_team_members` | Teams own membership rows linking personnel with role/status. Teams have a station, shift and optional assigned truck. |
| `truck`, `truck_logs` | Station fleet and truck location history; a truck can be assigned to different-shift teams. |
| `devices`, `location_logs`, `current_locations` | Devices reference personnel; historical logs can have a null device for mobile updates. Current location is keyed by personnel ID and includes source/time/battery. |
| `fire_incidents`, `barangay_boundaries`, `heatmap_data` | Incident coordinates/status/details link to confirming user and optional barangay; boundaries are PostGIS `POLYGON`, SRID 4326. Heatmap rows link to incidents. |
| `dispatch_records`, `dispatch_trucks`, `routes` | Dispatch links incident/team/selected route. Truck assignments record manning personnel. Routes reference incident and owning dispatch, with path, ranking, ETA and origin. |
| `incident_reports`, `report_photos` | Reports link incident, optional dispatch and personnel/admin author; photo metadata cascades with a report, bytes use configured local disk or private Supabase Storage. |
| `incident_events` | Status/alarm/severity transitions link incident/user and retain actor display text. |
| `road_obstructions`, `gnn_constraints` | Obstruction point/type/expiry and custom constraint polylines; both record creator/activity. |
| `push_tokens` | Expo token is the primary key, assigned to personnel with platform/sound settings; reassigned when a different user registers the same phone token. |
| `login_history`, `token_blacklist` | Successful login metadata and revoked JWT `jti` values with expiry; reaper removes expired blacklist rows. |

Two different route/dispatch foreign keys matter: `dispatch_records.route_id`
selects a route; `routes.dispatch_id` identifies its owner. ORM relationships
explicitly disambiguate them. Do not delete/rebuild routes without respecting both.

Incident-to-barangay assignment uses a spatial point-in-polygon query. Coverage
uses the configured barangay GeoJSON asset, while API geodata uses database boundary
rows; keep seeded data and file assets consistent. `DB_POOL_SIZE` and
`DB_MAX_OVERFLOW` configure each process's pool, with pre-ping/recycle and
`DB_CONNECT_TIMEOUT`. Unset values retain 20/40; the configured cloud environment
uses 8/4. Local test helpers use an isolated loopback database and reject cloud targets.

The fire-history heatmap reads closed incidents linked to `heatmap_data`.
`GET /api/heatmap` preserves `lat`, `lng`, and `weight`, adds `fire_id` and
`occurred_at`, and derives severity weights (Minor 0.4, Moderate 0.7, Critical 1.0;
unknown 0.5) from the current incident, including legacy seeded rows. Reopened
incidents are excluded. No existing heatmap rows are rewritten. The dashboard
filters points to its region boundary and inclusive Philippine occurrence dates.
Heatmap coordinates use the incident's location, rather than seeded jittered
coordinates. The API also supplies an `incident` display summary (ID, place,
address, severity, status, alarm, structure and casualties). Transparent hit areas
at incident locations show that summary on hover or keyboard focus in 2D and 3D;
clicking opens details. Only the heatmap shading is drawn. Records with identical
coordinates share a hit area and list their incidents together.
MapLibre, Leaflet fallback, and photorealistic Google 3D share Gaussian density
contours sampled every 100 m with a 500 m influence limit. Colors are relative to
the selected dataset's peak, rather than calibrated risk or absolute counts.
The panel supports date presets, custom dates, counts, and refresh/error/empty
states. Heatmap opacity stays at its overview strength through Leaflet-equivalent
zoom 14, then fades at closer zooms to reveal roads in all renderers. Only paint
changes during zoom; the density contours are retained. Visible heatmaps reload on incident events, WebSocket reconnection,
browser visibility, manual refresh, and a two-minute visible-tab interval.

The dashboard's `Alt+C` shortcut opens Command using the sidebar navigation
path, including from Settings and while the Alerts panel is open. Its hint appears
at the right of the Command button (in the tooltip when navigation is compact).
The shortcut is inactive on login, while typing, and while a modal dialog is open.
Light and Dark MapLibre basemaps start at 40 degrees of tilt when selected;
Satellite starts at zero. Returning to the same renderer preserves manual tilt.
The Map style selector starts collapsed. Incident markers use the original
severity-colored pins with their pulse and selection rings across renderers.
Constraint road details appear on hover in tilted MapLibre and Google 3D views,
including the road label, location, avoidance multiplier and available confidence.
Hover cards hide during drawing, camera motion, and when the layer is hidden.

## AI and road routing

### Inputs and runtime path

[ai/config.py](backend/ai/config.py) resolves region paths at import time.
[routing_setup.py](backend/routing_setup.py) loads `roads_panabo.gpkg` for Panabo
through the QGIS loader. A nodes/edges GeoJSON pair is a fallback when present.
Missing QGIS data is a deployment error; it does not silently download OSM.
New Corella uses its OSM GeoPackage, with live OSM download permitted only for an
OSM-declared region. Both datasets build a NetworkX directed road graph.

Panabo uses [best_model_predicted_constraints.geojson](backend/data/best_model_predicted_constraints.geojson)
with [constraint_style_config.json](backend/data/constraint_style_config.json).
The startup path applies predicted constraint properties/multipliers and traffic
schedules; [edge_weights.json](backend/data/edge_weights.json) is a fallback.
The trained `best_gat_manual_threshold_model.pt` is an artifact, not the live model
that generates road classifications on each request.

`GNN_INFERENCE_MODE=exported` (default) skips local model initialization and uses
constraint GeoJSON, then exported edge weights. Missing exports log a warning and
fall back to base travel times, including in routing pool workers. There is no
implicit local GNN fallback. `GNN_INFERENCE_MODE=local` explicitly constructs the
generic GraphSAGE/GAT/PMGCN node model and skips exported constraint costs. Local
mode defaults to GraphSAGE with eight node features and the shipped GraphSAGE
checkpoint; it is not the notebook's SegmentGAT. Install the optional ML
requirements before enabling local mode. Routing status includes `inference_mode`;
`gnn_type` is `exported` when no local model is constructed.

### Search and route products

Incident destinations snap to the nearest road segment, including the final
partial segment in route distance and base-time ETA. Station dispatches, routing
workers, live navigation, deviation connectors and team ETA ranking share this
behavior. Approaches preserve directed edges, blocked-road costs and terminal
U-turn restrictions; exact-node destinations retain the existing node search.
The graph and landmark tables are not modified per request. Existing saved routes
change only when recalculated. Restart the backend (including routing workers)
after updating, then use Force Reroute to refresh an existing dispatch.

[routing_engine.py](backend/ai/routing_engine.py) implements ALT (A* with Landmarks
and Triangle inequality), with 16 landmarks and directed-graph distance tables.
Search state includes the previous node so forbidden turns can be honored.
Constraint-aware cost can include base travel time, road multipliers and scheduled
congestion. Congestion is derived from exported time buckets/school schedules, not
live measured road traffic; its bucket selection uses the backend's local clock.

`compute_routes_multi_alpha()` retains its historical name but produces up to
three useful routes: `recommended` (constraint costs), `fastest` (base times with
obstructions), and penalty-based `alternative`. Duplicates/similar paths are dropped;
alternatives may be at most 35% slower than the primary and must differ enough in
shared driving time. Fewer than three routes is valid. Failure may yield no routes.

Obstructions are snapped to roads: blockades/floods become infinite cost, repairs
multiply cost by 5, accidents by 8. Active/expiry checks load operational obstructions
for dispatch computations. Returned ETA sums **base** edge travel times rather than
optimization penalties or observed turnout. The displayed confidence derives from
node scores; it is not a verified probability of timely arrival.

Constraint add/edit forms use the shared `AppModal` shell with road-condition
cards, severity choices, day chips and active-hour switches. The header and save
actions remain visible while long schedules scroll. Both themes and narrow
screens are supported; saving prevents dismissal and failed saves retain inputs.
Saved roads and baseline roads share the active export's colors by condition and
severity. The map API resolves display colors before filtering covered roads and
returns that palette for layer rows and dialog previews; routing costs are unchanged.
Settings → Model explains when retraining is disabled and reports partial-road
selections that affect routing but do not cover a whole model training road.

Custom `gnn_constraints` CRUD persists stable snapped segment identities (8 m buffer,
60% length coverage), retains deleted rows with `is_active=false`, invalidates map
caches, and broadcasts changes. In exported inference mode, active annotations
override corresponding road-segment costs through the shared engine builder.
Replacements build the main engine and warmed routing pool before swapping them;
other web processes poll committed changes every 10 seconds. Failures retain the
previous routing state and retry on the next poll. Legacy NULL segment identities
are resolved in memory until edited. Map predictions covered by active drawings
are deduplicated; `segment_uid` and `annotation_source` reach the client. Current
exports lack canonical IDs, so direction-independent geometry hashes provide
temporary identities; geometry or canonical-ID changes need reconciliation.
Apply migration `0025` before starting this backend.

The [Lightning retraining plan](plans-todo/gnn-retraining-lightning.md) is partially
implemented. Offline [training utilities](training/README.md) freeze the original
602 spatial blocks and audit pre-scored model outputs with paired block bootstrap.
The notebook is available in `backend/data/final_najud_gnn_gattt.ipynb`. The original
master layer is absent, but `training/recover_labels.py` recovers historical manual
labels from the shipped hybrid export: all 3,639 geometries and notebook Cell 8.1
labels match, yielding 1,208 constrained roads and 2,431 background zeros. It omits
model prediction/display fields and writes source-hash provenance. The champion's
fitted feature pipeline is reconstructed in an isolated CPU environment, with
73-column matrix parity against notebook Cell 13 and checkpoint output parity on
all 3,639 saved segments (max probability error `3.61e-7`; zero class changes).
The verified offline bundle in `backend/ai/models/versions/v1/` includes its pipeline,
checksums and validation report. `training/bundle.py` scores raw feature exports
without refitting; a replayed self-audit gives F1 difference and interval `[0, 0]`.
This is reconstruction validation, not new model-accuracy evidence. Snapshot
building now combines baseline manual flags and active drawings, retains deleted
annotation history, and emits hashed Parquet labels plus raw feature inputs and a
provenance manifest. Training refuses unchanged labels. The CPU GAT port uses
validation-only threshold selection and audits both fitted pipelines on identical
current-label test blocks, exporting a conservative candidate. `LocalRunner` has
durable subprocess status/logs, timeout handling, a per-directory local job lock,
credential exclusion and fresh-directory fetch. Admin registry APIs initialize
verified v1, submit local retrains, list/status/report and reject candidates.
Migration `0026` adds `model_versions` and partial unique indexes for a single
training job and champion. Transaction advisory locks serialize registry mutations;
a 10-second background poll verifies and fetches terminal job artifacts. Job IDs
commit before launch; candidates retain their assigned version name. Immediate
promotion/rollback now verify artifact and audit provenance, full training settings,
frozen split, road geometry and nonnegative routing multipliers. Main/pool engines
build before the champion transaction commits; each pool PID confirms its model.
Failed preparation/commit discards replacements. The event loop installs ready
objects and clears map/style/coverage caches. Other workers poll the committed
champion; startup loads that version, falling back only for an absent/empty
registry. The admin Settings Model tab now shows champion/job state, label guards,
comparison/uncertainty, changed-class map preview, rejection, explicit
promotion/rollback confirmation and paginated history. Retraining also requires
confirmation. The map preview opens a modal with linked before/after maps, using
the audit's champion/challenger classes and the selected theme's shared tile
configuration. Only changed roads are included; the baseline is the candidate's
original audit comparison, which can differ from a subsequently promoted champion.
`POST /api/models/{version}/cancel` requires an administrator and requests stopping
an ongoing retrain. Local wrappers terminate and reap their training child before
reporting cancellation; Modal cancels the saved call with container termination.
Unavailable cloud call identities or failed acknowledgements retain the training
reservation and return an error for retry. A cancellation request keeps the job
reserved until polling observes a terminal result, and prevents a late completed
bundle from entering candidate review. Cancelled retrains use the existing
`rejected` registry status with `report.job_status = cancelled` and attributed
request metadata; list/status responses add `job_status` and `cancel_requested`.
The UI labels them Cancelled and handles `model_training_cancelled` notifications.
No migration is needed. Local jobs must use the updated wrapper to stop promptly;
an older running wrapper cannot observe the new cancellation marker.
Summary/preview endpoints
read annotations/artifacts without training or writes. The shared App WebSocket
refreshes model state and feeds the Model updates notification preference. Browser
constraint/coverage caches invalidate on promotion, and stale requests are ignored.
Scheduling and Lightning remain pending. Modal online training is implemented as
an optional adapter (`RETRAIN_RUNNER=modal`), using the same admin retrain/review
and promotion flow. `training/modal_app.py` deploys a private T4 trainer with
Python 3.12, PyTorch 2.5.1/CUDA 12.1, one active training container and a one-hour
training limit. Local CPU training remains the default. The web environment uses
`backend/requirements-modal.txt`; training libraries stay in the cloud image.
No new database migration is required. See [setup](training/README.md#modal-online-training).
Explicit source/artifact allowlists exclude backend credentials and private app
data. Source hashes prevent stale deployments from training new snapshots.
Known runner configuration failures, including a stale Modal trainer, return
their safe setup message in the admin response and failed job history. Other
submission errors retain the generic response and server traceback. A local API
configured with `RETRAIN_RUNNER=modal` requires the same deployed training source
as a hosted API; see the redeployment command in the training setup guide.
Modal Volume status and local call metadata support restart recovery; network
outages and interrupted downloads preserve the reservation for retry. Candidate
downloads verify hashes before atomic installation. Promotion remains explicit.
Local validation covers cloud transport/worker failure cases, registry behavior
and a full 94-epoch synthetic CPU retrain with the champion unchanged. This is
not evidence of Modal GPU parity or improved field accuracy.
On 2026-10-24 the private `firetrackr-training` app was deployed to the authenticated
Modal workspace's `main` environment. Its CPU preflight was reachable and all 19
allowlisted source hashes matched this checkout. The local backend `.env` now
selects Modal; a restarted backend resolves `ModalRunner`. Deployment verification
did not submit a GPU training job or promote a model. A read-only database check
still reports champion v1, no active job and unchanged effective labels.

On 2026-11-07, local retraining failed because eight allowlisted source hashes
differed from the deployed trainer. Redeploying the same app/environment from
this checkout restored protocol compatibility and all 19 matching source hashes.
The local API/database health check and 18 isolated retraining regressions passed.
Verification did not submit a GPU training job or promote a model.

A synthetic integration run trained 94 epochs and verified failure/timeout and
concurrency handling without touching a DB or active champion. Full CPU optimizer
training matches original notebook CPU weights exactly, but historical CUDA metric
parity is outside the plan's tolerance (F1 0.7143 versus 0.7381 at threshold 0.45;
allowed difference 0.02). A subsequent user-supplied Tesla T4 report matches historical F1 exactly
(0.7381443298969073). Its remaining schema-1 failure is bitwise weights, differing
by at most 1.42e-7. Schema 2 uses absolute 1e-6 numerical agreement for weights,
probabilities and regression, with identical class/map decisions. The subsequent
user-provided Colab T4 schema-2 confirmation passes all required checks and matches
historical F1 exactly. Its source hashes match local files; report/provenance are
saved in `backend/data/retraining/cuda_parity_confirmation_v2/`. CUDA was not run
locally and historical package versions remain unknown. Synthetic-validation reports remain promotion-ineligible. The report API derives
current readiness separately from immutable offline audit fields. Admin promotion
and archived rollback require the expected current champion; stale candidate
audits are refused. No database migration or live model promotion has run. Raw GIS features still require the original fixed
road/feature baseline.

`training/parity.py` independently reproduces the notebook's original preparation
and training on a chosen CPU/CUDA device, retaining logs, weights, source hashes,
runtime versions and audit evidence. The full CPU investigation matches all 13
exact checks; its CPU historical metric comparison remains outside tolerance. The local GPU is AMD and
cannot run CUDA. Original notebook metadata identifies a T4, while library versions
were not recorded; CPU/CUDA causality is not proven. An allowlisted 20-file package
builder and CUDA Colab diagnostic notebook were verified by user-provided Colab
output. The agent did not execute CUDA locally or upload files to Colab. The optimizer now follows the input data's
device; production local training still explicitly uses CPU.

The map GAT panel now enters an explicit constraint-editing mode, with a left-side
layer list, search, barangay/source filters and geographic sorting. Incident View
and map actions hide during editing; Done restores them. Main sidebar links,
including Incidents, and the section divider remain visible. Page navigation exits
constraint editing.
Visibility is local to the editing view. The editor uses a panel with
constraint-type buttons, a searchable road list and
collapsible location/source/sort filters. Active filters can be cleared together;
the recent list stays ordered newest first. Rows show source-first, title-case
badges (Predicted with High Confidence/For Review, or Baseline with its road type),
visibility controls and a selected-road inspector with severity or traffic hours.
Updated 2026-11-04: compact inline type buttons and tighter workspace controls
leave more room for roads. Tools, the road list and the height-limited inspector
scroll separately, so expanded filters or selected details do not hide the list.
The workspace uses the constraints editor's page background; type controls omit
the help text/editing-mode badge, and list titles omit the extra road icon.
Selected rows use a neutral grey fill/border. The selected-road inspector is an
inset rounded card without a nested tinted road wrapper or heading icon; model
prediction buckets use the name Predicted Constraint and retain their separate
High Confidence/For Review type. In the map's constraints view, the legend scrolls
independently so Edit constraints stays visible and keyboard-reachable.
List titles use title case. Prediction confidence suffixes use a muted pipe and
status instead of parentheses; panel and row dividers use a dimmer neutral token.
Prediction edit and active-filter controls use the fire accent; saved-source badges use the
green theme accent and title-case labels. Button labels and prediction confidence
text are smaller, and inspector help text is quieter. Inspector/legend scrollbars
are hidden while their content remains scrollable and the edit action stays visible.
Saved-constraint Edit uses a filled fire button; Remove uses a neutral outline and
hover, with the fire eyebrow reserved for its deletion confirmation.
Remove/Restore depends on the saved constraint ID rather than the selectable-road
catalog's readiness; drawing and open edit/save dialogs still lock the action.
The constraint load state shows a small animated circle while loading and Retry
after a failed load.
Search/filter typography is smaller and muted, and Done uses a slimmer button.
Add and edit dialogs share the deletion confirmation's badge/header treatment;
constraint modal eyebrows are smaller and grey, with fire on deletion. Shared
modal header titles use title case. Road-name placeholders are dimmer. Context labels, list counts and
constraint-view headings, legend labels and edit buttons use title case. Add/edit
descriptions share the same info row. Hidden rows are greyed out; the legend's
constrained count is bright with dimmer neutral totals and Roads text. Condition,
severity and day selections use neutral grey; active switches use the fire accent.
Section headings and help text are subdued. Selected cards/days have a subtle
grey border and fill; unselected
options use the modal's base background. Description and hint rows share a small,
muted info icon, text and divider. The traffic schedule
groups day and hour controls in rounded cards without the timezone label; the footer
note is grey. The context tag and full-width weekday row use smaller typography
and controls. Layer notice banners are removed; draft selection feedback appears
inside the neutral draft card, and loading errors retain Retry in the list.
Draft headings use smaller title-case text without a dot. Active add-type buttons use the fire
accent; the map drawing banner uses neutral surfaces and small text.
Save behavior, validation and the stored road/traffic values are unchanged.
The panel supports both themes and scrolls within smaller viewports. It selects
authoritative QGIS road chains between connected junctions/dead ends rather than
drawing polylines.
Each row includes a north-up road-shape preview in its constraint color. Selecting
a row keeps that road bright and dims other road overlays; clearing the selection
restores their normal opacity. Map clicks in editing mode select the same panel
row without moving the camera, including rows outside the current filters or
first 100 results. Outside editing mode, road popups show details and an Edit
Constraint action that opens editing with that road selected. All map renderers
share these identities and actions. While adding constraints, hover shows a
dashed preview of the exact edge a click would select; hovering never saves it.
At zoom 16+, clicking a road toggles a neon-orange narrow-road or neon-yellow
traffic selection (also used for saved custom edges); polygons and
off-road clicks cannot create constraints. Narrow and traffic batches must be
confirmed and saved (or cancelled) before switching type. The server validates
edge IDs, persists exact geometry atomically, and deduplicates retries. Recently
saved edges sorts by creation time and reveals/focuses a clicked row on the map.
Baseline/model layers remain inspectable, and legacy saved constraints remain
available. Failed saves preserve selections; routing refresh status is visible.
Edge identities use the `edge-v1-` prefix. Routing overlays retain the selected
geometry. Training snapshots only label an original training feature when its
entire geometry is covered by active selections of the same type; partial-edge
annotations remain in history and are counted in the snapshot manifest.

New saves choose Slight/Severe narrow severity in the confirmation dialog. Traffic
uses an optional label (`gnn_constraints.name`) and a recurring schedule with
selected weekdays, All day, or up to eight exact time windows. The new nullable
`narrow_severity` and `traffic_schedule` fields preserve legacy row semantics.
Schedules use Asia/Manila and half-open [start, end) windows; overnight periods
continue into the day after the selected starting day. The routing engine applies
the scheduled traffic multiplier per request, without broad time-bucket rounding
or an always-on admin traffic penalty. Existing blockades still override costs.
The saved edge remains visible outside its active hours. Re-selecting an identical
saved constraint is idempotent; conflicting saves are rejected atomically and
direct the admin to edit the existing annotation. New narrow labels feed their severity into
training; a larger training feature requires complete coverage of one severity.
Schedules are operational metadata, not learned hourly traffic predictions.

Saved constraints now support in-place editing. Select a saved road in the layer
list or map, then choose Edit constraint in its inspector; the view-mode popup's
Edit Constraint action opens the form directly for a saved annotation. The shared
save dialog prefills the label, type, narrow severity and traffic schedule. Type
changes clear the previous type's details. Legacy defaults survive label-only
edits, and failures preserve form values for retry. Saving keeps the row selected
and refreshes its details, map and routing. Baseline/model roads also expose Edit
constraint and save an explicit correction, as described below.
`PATCH /api/constraints/{id}` validates the merged details, preserves canonical
edge geometry/IDs and creation provenance, and serializes with edge creation
using its PostgreSQL advisory lock. It returns routing-refresh status; a failed
notification cannot turn a committed update into an API failure. This uses the
existing 0029 fields and needs no new migration. Changed severity/type feeds the
next immutable label snapshot; road-name and schedule-only edits do not by themselves
enable retraining. Validation includes disposable SQLite API tests with the lock
mocked, frontend interaction tests and browser checks in both themes at desktop
and narrow widths; live database rows were not modified for these checks.

Baseline road editing (2026-10-24): select any baseline or model road, then Edit
constraint in the inspector or popup. The form supports narrow severity, traffic
category, optional active hours, construction and No constraint. Prediction-only
roads start with No constraint and require explicit review; probabilities never
become positive training labels automatically. Traffic subtypes and original
timing are retained unless changed. Save creates one `gnn_constraints` override
through POST `/api/constraints/baseline-override`; repeated saves update the same
active row. The server resolves the canonical segment and geometry from the model
export, rather than accepting client coordinates. Revision `0030` adds nullable
`baseline_segment_uid` and a unique index for one active override per segment.
It preserves existing annotations. Subsequent edits use the existing PATCH API.

The map hides the covered original entry and keeps the edited road selected.
Shared main/pool construction replaces the matching model segment, so lower
severity and No constraint can reduce its cost while maintaining multipliers >= 1.
Independent road annotations and live blockades retain their own behavior.
Training clears the old segment flags before applying changed override labels;
name-only or timing-only corrections preserve its original manual flags.
Removing the override via Restore original soft-deletes it, retaining history and
revealing the current model layer. The original model bundle is never rewritten.

Revision 0030 was tested against a PostgreSQL temporary table for upgrade,
downgrade/re-upgrade, original-row preservation and active-override uniqueness,
then applied to the configured local database. API submit/retry/reset and snapshot
hashes were also exercised with a PostgreSQL temporary table and separate temporary
identity sequence. Application rows, the real identity sequence and original
export hash were unchanged. Regression checks cover map deduplication, negative
labels, lower severity, restoration, main/pool routes, UI retry and both themes at
desktop/mobile widths. Modal's deployed trainer was updated to the new snapshot
rules; no GPU training or model promotion was started by these checks.

Local activation on 2026-10-23: the configured legacy database received the
approved additive response-performance schema, nullable constraint segment IDs,
and an empty model registry. A fresh custom-format backup and before/after hashes
of all original columns in 28 tables verified no existing row/value changes.
The backend restarted successfully; routing and 16 read-only API checks passed.
SQL proposals, backup and activation manifest are in the workspace-level
`outputs/response_performance_review/` (outside the Git checkout). No source-dump
incidents/dispatches were imported. The database retains legacy revision `0026`;
it must not be blindly stamped or upgraded as though that were main's `0026`.
Response Performance currently has zero measured dispatches, so averages remain
empty until actual milestones are recorded.

### Location and route correction

Personnel submit authenticated positions tied to an active dispatch and team
membership. The backend records history, resolves source/time races, updates current
location and synchronizes truck position for the person manning it. PostGIS distance
checks detect deviations beyond 25 m, with rejoining at 10 m. Automatic entry
requires two recent accepted mobile fixes with reported accuracy of 25 m or
better (at most 30 seconds apart); inaccurate fixes remain in location history
without changing navigation state or scheduling correction. Graph-heavy correction is normally deferred to a background task and
[routing_pool.py](backend/routing_pool.py), with in-process fallback.

Routes can be rebuilt from driver location or connectors can be computed for a
deviating responder. The watchdog scans every 15 seconds and reverts driver-origin
routes to station origin after the 15-minute stale window plus 2-minute grace.
This behavior depends on correctly assigned manning personnel and fresh timestamps.

### Experimental components

GCN/GAT/GraphSAGE/PMGCN definitions, Gymnasium dispatch environment, DQN/PPO/DDPG/A3C
agents and SUMO interface are present. `USE_RL` and `USE_SUMO` default to false.
Their presence does not establish an operational trained RL policy or live SUMO
traffic feed. Only the SUMO route XML is tracked; the configured Panabo network XML
and RL checkpoint directory are not supplied by this checkout.

## Important workflows and algorithms

### Incident intake and dispatch

Both log modals default response classification from dispatch type: Firefighting
Operations selects Fire, EMS selects Medical, and Fire Safety Enforcement or
Fire/Arson Investigation selects Other. Special Operations and Disaster Management
start Not yet verified. Changing dispatch type resets this selection; Fire and EMS
are fixed to their matching classification, while other types allow non-fire choices.
Moving a Command map pin preserves the classification draft. Command's manual
reporting channels are 911 Call, BFP Hotline, Walk-in and Dispatcher. Intake opened
from a reporter's shared location displays SMS Report as a read-only source and
preserves its session token. Logging contact numbers remain optional; Request
Location requires a number only for sending its SMS link.

The Incidents page and map quick-entry forms reuse `AppModal` and the shared
incident form controls. Intake puts location and assessment first, with reporter
and receipt/classification fields in expandable sections and actions kept outside
the scrolling body. The map form keeps its auto-dispatch choice visible; the
Incidents page starts live reports as Pending and dispatch follows separately.
Past-incident mode exposes history, units and outcomes, opens receipt details,
and interprets entered occurrence and receipt times in Asia/Manila. Switching
back to live mode clears historical status/outcome values. Saving prevents
duplicate submission and dismissing the modal; a failed request retains the
draft for retry. Moving the map pin continues to pass the draft to the parent.
Both intake forms fill Area / Barangay from the existing `/api/barangays`
boundary polygons when a pin is selected, including reporter GPS. Moving the pin
detects the new barangay; quick entry drops the previous automatic name from its
draft while retaining other details. Names remain editable, and edits made while
boundaries load survive the response. Polygon holes and boundary edges are
excluded, matching the backend's spatial assignment. Missing boundaries or an
unmatched pin show a manual-entry hint; submission waits for an active lookup.
New intake defaults to Minor severity. Receipt details offer Now and Unknown
actions; Unknown keeps the receipt timestamp empty rather than inferring one.

Reporter location requests use the same modal and field spacing. SMS and direct
link copying remain available while waiting; a message preview expands for manual
sharing. A received pin exposes coordinates and the existing Log incident here
handoff. SMS submission blocks duplicate requests and dismissal while pending;
copy feedback reports clipboard failures instead of claiming a successful copy.

1. Admin logs a fire; validated coordinates/details are persisted and spatial
   barangay assignment is attempted. WebSocket `incident_created` updates clients.
2. Auto-dispatch evaluates eligible teams: operational station with coordinates,
   not already active, current shift when resolvable, an available station truck,
   nonempty crew and standby-compatible membership state.
3. Haversine prefilter narrows candidates to five teams; routed ETA (or distance
   fallback) is scored with a 30-second penalty per dispatch in the previous 12 hours.
   Lowest score wins. This is deterministic ranking, not an RL dispatcher.
4. Dispatch persists incident/team/truck/route changes, broadcasts updates and
   schedules Expo notifications; SMS fallback remains gated by `SEND_SMS`.
5. Arrival, containment and report submission progress the incident. Report
   submission closes the fire and releases dispatched resources. Event rows record
   status/alarm/severity changes; dispatch timing is kept on dispatch records.

See [auto_dispatch.py](backend/auto_dispatch.py),
[services/dispatch.py](backend/services/dispatch.py),
[routers/incidents.py](backend/routers/incidents.py) and
[routers/dispatch.py](backend/routers/dispatch.py).

Shifts alternate daily A/B with an 08:00 Asia/Manila cutover and Shift A anchor
2026-01-01. A missing matching shift row removes the shift restriction in candidate
filtering. Team ranking checks an available station truck; it is not equivalent
to validating every team/truck/personnel assignment convention.

### Coverage and metrics

[coverage_engine.py](backend/coverage_engine.py) performs multi-source Dijkstra
from operational station nodes snapped within 2 km, truncated at eight minutes.
Reachable segments are bucketed into 3/5/8-minute bands, merged, buffered by 0.0004
degrees (approximately 40 m) and unioned. Barangay polygon intersections produce
area percentages: covered at least 80%, partial at least 40%, otherwise gap.
This is road-corridor coverage, not population-weighted or measured response coverage.

[services/coverage.py](backend/services/coverage.py) caches results per process and
uses `_compute_edge_costs()`. It does not explicitly apply the operational obstruction
list or time-bucket congestion like dispatch searches do. Avoid repeating the old
audit's claim that all current closures are reflected without checking this wiring.
Station changes invalidate coverage; refresh recomputes it. Without source stations
coverage returns 404; without a routing engine it returns 503.

[metrics.py](backend/routers/metrics.py) aggregates real DB records. Average response
is first arrival minus incident time, excluding nonpositive or over-six-hour samples.
[eta_validation.py](backend/eta_validation.py) is an inert measurement harness;
no endpoint exposes it. Its dispatch-to-arrival comparison includes turnout, so it
cannot independently calibrate road travel time without additional timestamps.

## API inventory

Paths below come from registered [routers](backend/routers/). `Admin` means
`require_admin`; `User` means `get_current_user`, with additional membership/role
checks where noted. Public means no bearer dependency. Consult schemas/handler
bodies for exact query parameters and response shapes.

| Method and path | Responsibility | Access |
| --- | --- | --- |
| `GET /`, `GET /health` | Liveness message; database/PostGIS check | Public |
| `GET /health/live` | API event-loop liveness without database access | Public |
| `WS /ws?token=...` | Events and ping/pong | JWT signature/expiry at connect; limitations below |
| `POST /api/auth/login` | Dashboard admin sign-in | Public credentials |
| `POST /login_user` | Personnel client sign-in | Public credentials |
| `GET/PATCH /api/auth/me` | Read/edit own profile; email change can return replacement JWT | User |
| `POST /api/auth/change-password`, `POST /api/auth/logout` | Change credentials/revoke current token | User |
| `GET /api/auth/login-history` | Own recent successful logins | User |
| `GET /api/routing/status` | Engine readiness, region/source/constraints | Public |
| `POST /api/routing/compute` | Route between supplied graph node IDs | Admin |
| `GET /api/routing/graph/summary`, `GET /api/routing/gnn-constraints` | Graph summary; predicted/custom map features | Admin |
| `GET /api/routing/nearest-station`, `GET /api/routing/snap` | Station/node proximity; road snapping | Admin |
| `GET /api/coverage/isochrones`, `GET /api/coverage/gaps` | Service areas and barangay gap rows | Admin |
| `GET/POST /api/personnel`, `PATCH/DELETE /api/personnel/{per_id}` | Roster/accounts | Admin |
| `GET /api/personnel/locations` | Live positions with age/staleness | Admin |
| `GET/POST /api/stations`, `PATCH/DELETE /api/stations/{station_id}` | Station management | Admin |
| `GET /api/shifts` | Shift lookup | Admin |
| `GET/POST /api/teams`, `PATCH/DELETE /api/teams/{team_id}` | Team management | Admin |
| `POST /api/teams/{team_id}/members`, `PATCH/DELETE /api/teams/{team_id}/members/{per_id}` | Crew membership | Admin |
| `GET/POST /api/trucks`, `PATCH/DELETE /api/trucks/{truck_id}` | Fleet management | Admin |
| `GET /api/barangays`, `GET /api/heatmap` | Boundary/incident map data | Admin |
| `GET/POST /api/obstructions`, `DELETE /api/obstructions/{obstruction_id}` | Road disruptions | Admin |
| `GET/POST /api/constraints`, `PATCH/DELETE /api/constraints/{constraint_id}` | Custom map polylines | Admin |
| `GET/POST /api/incidents`, `PATCH/DELETE /api/incidents/{fire_id}` | Incident register and mutations | Admin |
| `GET /api/incidents/active` | Current incident list | Admin |
| `GET /api/incidents/{fire_id}/report`, `GET /api/incidents/{fire_id}/events` | After-action report and change history | Admin |
| `PUT /api/incidents/{fire_id}/report` | Create a missing after-action report or correct its text and outcome | Admin |
| `GET /api/metrics/summary` | Dashboard aggregates | Admin |
| `GET/POST /api/dispatch` | List/create dispatches | Admin |
| `GET /api/incidents/{fire_id}/dispatch-recommendations`, `GET /api/incidents/{fire_id}/routes` | Ranked candidates; saved routes | Admin |
| `PATCH /api/dispatch/{dispatch_id}/select-route`, `POST /api/dispatch/{dispatch_id}/full-reroute` | Change/rebuild dispatch route | Admin |
| `PATCH /api/dispatch/{dispatch_id}/arrived`, `PATCH /api/dispatch/{dispatch_id}/truck-manning` | Arrival and truck custody | User; assigned personnel; only team driver can claim truck manning |
| `PATCH /api/dispatch/{dispatch_id}/contain`, `POST /api/dispatch/{dispatch_id}/report` | Containment; multipart report/photo submission | User; assigned personnel team leader |
| `GET /api/mobile/me/station`, `GET /api/mobile/me/status` | Own home station; team/active dispatch status | User; personnel role/profile checks |
| `GET /api/mobile/road-snap?lat=...&lon=...` | Display-only nearest routing road within 60m, including its segment for local projection; null if none, 503 when offline | User; personnel role/profile checks |
| `PUT /api/mobile/push-token`, `POST /api/mobile/push-token/unregister`, `POST /api/mobile/push-token/test` | Register/remove/test own phone token | User; personnel checks |
| `POST /api/location/update` | Own active-dispatch position | User; personnel/team checks |
| `GET /api/report-sessions`, `GET /api/report-sessions/{token}`, `POST /api/report-sessions/{token}/send-sms` | Dispatcher reporter sessions and SMS | Admin |
| `POST /api/report-sessions/{token}/location` | Reporter GPS submission | Public |
| `GET /report/{token}`, `GET /report-assets/axiforma-{weight}.otf` | Reporter HTML and whitelisted font assets | Public |
| `GET /uploads/...` | Static report photos | Public mount |

FastAPI's default `/docs`, `/redoc` and `/openapi.json` are not disabled.
There is no separate retraining, dispatch acknowledgement or ETA-validation endpoint.

## Environment configuration

Templates: [backend/.env.example](backend/.env.example),
[frontend/.env.example](frontend/.env.example). Do not copy their placeholders into
a deployment unchanged. Backend settings load `.env` at import time; restart after
changes. Vite variables are built into browser assets and need rebuild/restart.

| Setting | Source/default and purpose |
| --- | --- |
| `DATABASE_URL` | Required by database/Alembic; PostgreSQL connection URL |
| `JWT_SECRET`, `JWT_EXPIRE_HOURS` | `change-me`, `8`; HS256 token signing/lifetime; override secret |
| `PUBLIC_BASE_URL` | `http://localhost:8000`; external reporter/photo link base |
| `PHILSMS_API_TOKEN`, `PHILSMS_SENDER_ID`, `SEND_SMS` | Empty token, `PhilSMS`, `false`; outbound SMS |
| `EXPO_ACCESS_TOKEN`, `DISPATCH_SMS_FALLBACK` | Empty, `true`; push enhanced security token and fallback preference |
| `ROUTING_POOL_SIZE`, `ROUTING_POOL_TIMEOUT` | `2`, `30` seconds; pool sizing/timeout; size 0 disables pool |
| `LOCATION_REROUTE_INLINE` | `false`; diagnostic inline versus deferred rerouting |
| `BLACKLIST_REAPER_INTERVAL` | `3600` seconds; token cleanup schedule |
| `HOST`, `PORT`, `WEB_CONCURRENCY` | Launcher defaults `127.0.0.1`, `8000`, `1` |
| `REGION` | `panabo`; `new_corella` only for local testing; unknown values rejected |
| `GNN_TYPE`, `TORCH_DEVICE` | `graphsage`, `cpu`; generic node model/device |
| `USE_RL`, `USE_SUMO`, `SUMO_PORT`, `SUMO_HOME` | `false`, `false`, `8813`, external install path; experimental integrations |
| `VITE_API_BASE_URL` | `http://localhost:8000`; REST/derived WS base |
| `VITE_REGION` | `panabo`; must match backend region |
| `VITE_CARTO_MAP_API_KEY` | Browser map-tile configuration; never use a private server secret |
| `VITE_PUBLIC_BASE_URL` | Optional reporter-link fallback in LocationRequestModal |

The backend example includes obsolete Semaphore names, but no active Semaphore SMS
service reads them. It omits JWT settings. The frontend example contains explanatory
placeholder strings rather than usable API/key values. `DB_POOL_SIZE`,
`DB_MAX_OVERFLOW` and `TEST_DATABASE_URL` appear in plans, not implemented settings.

## Security and operational limitations

These are static source observations, not a full security audit or a dependency
vulnerability assessment. Follow the [security-audit skill](.agents/skills/security-audit/SKILL.md)
for a requested verified audit.

- HTTP authentication checks signature, expiry, blacklist and current DB user;
  dashboard handlers check admin role. WS connect checks signature/expiry and numeric
  subject only: it does not check blacklist, current DB user or admin role and shares
  one broadcast set. Do not assume HTTP authorization protects broadcast payloads.
- JWT signing has a weak default; password comparison currently uses string equality
  rather than constant-time comparison. Password/email changes revoke the supplied
  token, not all outstanding sessions. No login rate-limit middleware is configured.
- Reporter GPS accepts arbitrary path tokens into in-memory sessions with no enforced
  registration/expiry lifecycle; dashboard tokens are timestamp-derived rather than
  cryptographically random. Browser geolocation generally needs HTTPS outside
  localhost; phone reachability depends on the configured public backend URL.
- Report photos use randomized object names, count/size limits and private
  Supabase signed links when configured; local mode serves public static files.
  Dispatcher JPG/PNG/WebP additions are decoded with Pillow before upload; the
  older team-leader upload path still relies on MIME/size checks. Temporary links
  remain usable by their holders until expiry.
- WebSocket sessions, reporter state and caches are not shared between workers or
  durable across restarts. Single-worker real-time operation is the current safe
  architectural assumption; routing pool subprocesses are separate from Uvicorn workers.
- CORS explicitly allows `http://localhost:5173` and
  `https://firetrackr-dashboard.onrender.com`. Other dashboard origins require an
  explicit configuration change. Reverse-proxy/TLS configuration must be confirmed
  externally. API docs are enabled by default.
- New Corella lacks predicted constraints and barangay polygons; no reachable operational
  station yields no coverage. Region switches share the same database and do not
  isolate old Panabo records.
- Coverage uses buffered road area and degree-based geometry, not measured travel,
  population weighting, turnout or optimization. Its costs do not include the full
  dispatch obstruction/congestion pipeline. Cached results can age until refresh.
- Route ETA is modeled travel time. Actual field accuracy, provider delivery and
  operational suitability have not been established by this documentation review.
- Tests are intentionally excluded by [.gitignore](.gitignore); Vitest has a tracked
  script but no tracked cases. No committed backend suite or CI workflow was found.
  A fresh clone cannot reproduce local tests, and current dependency gaps can prevent
  startup. No source/dependency/database execution was required for this documentation.

## Planned or incomplete work

| Item | Current evidence |
| --- | --- |
| Public API/frontend hosting | Database and private photos moved to Supabase on 2026-11-03; API/frontend hosting remains local. See [database setup](documentation/supabase-database-setup.md). |
| Lightning retraining/challenger promotion | Local registry/retrain/review/promotion/rollback APIs and offline training are implemented; the admin Settings Model UI is wired; Lightning and scheduling remain planned. See [plan](plans-todo/gnn-retraining-lightning.md). |
| Applying drawn constraints to routing | Custom map CRUD is implemented; engine-cost integration is outstanding. |
| Shared real-time state across API workers | Warning in [run.py](backend/run.py); no shared pub/sub/session store implemented. |
| Dispatch acknowledgement/status transitions | Operational departure/arrival measurements are separate from dispatch status. Recording a measurement does not silently change the dispatch workflow. |
| ETA validation exposure/calibration | [eta_validation.py](backend/eta_validation.py) exists but is not wired into routes. |
| RL/SUMO operations | Experimental classes exist, default flags are off, required deployment artifacts are incomplete. |
| Notification feature | [Plan](plans-todo/notifications-tab.md) has stale historical context; App, hook, toast/panel and settings show the feature is implemented. Live verification remains separate. |

## Operational Time Analysis

The administrator sidebar's **Analysis** page includes an **Operational Times** tab
beside Response Performance and Coverage Planning. It uses dashboard URL navigation,
KpiCard, form fields, modal shell, theme tokens and Leaflet maps. Metrics calculations,
Planning coverage and the routing/ETA algorithms retain their existing behavior.
Metrics keeps this branch's receipt-based response key and exposes a separate verified
receipt-based metric to the dashboard, including per-unit arrivals.

Operational Time Analysis follows the Metrics visual treatment: a compact period/
source toolbar, independent call-to-arrival summary, stage cards with shared SVG
icons and observation counts, and a responsive breakdown with labels outside the
proportional segments. Trends retain missing-data gaps and offer an expandable
values/sample-count table. Recorded and synthesized demo timings remain explicitly
labeled, including the trend chart. Loading/error/empty states, readable theme
colors, table pagination and route-detail focus behavior are preserved. The detail
modal imports its own Leaflet stylesheet rather than relying on another page.

Implementation entry points:

- Frontend: `pages/OperationalTimePage.jsx`, `components/OperationalTrendChart.jsx`,
  `components/ResponseAnalysisModal.jsx`, `components/ReportReceiptFields.jsx`,
  `utils/operationalTimes.js` and `styles/OperationalTimePage.css`.
- Integration: App/TopBar navigation, api.js cache and invalidation, the two incident
  intake forms, and optional focus management in AppModal. Data refreshes after
  relevant WebSocket messages, local writes and a visible-page minute timer.
- Backend: `routers/operational_times.py`, `services/operational_times.py`, schema
  and ORM extensions, plus small hooks in incident creation, dispatch creation,
  route selection/replacement, crew arrival and mobile location updates.

The administrator-only API is `GET /api/operational-times?period=1y&page=1`,
`GET /api/operational-times/{fire_id}`, and
`POST /api/operational-times/{fire_id}/milestones`. All use existing JWT role checks.
Confirmation requires `kind`, a timezone-aware `occurred_at`, and an
`idempotency_key`; unit events also require the incident's `dispatch_truck_id`.
`response_kind` can explicitly verify fire, medical, rescue or other. Sources,
actor identity, occurrence time and server receipt time are audited separately.
First recorded milestones are not overwritten by retries or later GPS packets.

Migration `0027` adds nullable incident receipt/suppression timestamps and response
classification, per-dispatch-truck departure/arrival, event audit metadata and
dispatch-associated truck telemetry. It adds no tables and backfills no history.
Main's authoritative `0024_add_incident_dispatch_type.py` adds the optional incident
dispatch category. The response-only worktree includes a compatibility repair for
an earlier feature database; that repair is unnecessary in this original-web chain.
The supplied October 19 backup was inspected, not restored.

Merge reconciliation (2026-10-23): the old feature `0025`/`0026` files are archived
unchanged in `backend/alembic/legacy_versions/`, outside the active main migration
graph. Databases using those IDs for operational timing need a backed-up,
validated schema reconciliation before stamping or upgrading. Alembic rejects
that legacy state explicitly; the source merge does not convert the database.

Measurement rules:

- Incident report exports explain that preparation/travel describe the first-arriving
  truck rather than per-truck averages. Exported processing follows that truck's
  dispatch; dashboard processing uses the first dispatch per incident. Suppression
  remains incident-wide and is omitted from per-unit KPI cards in PDF/Word exports.

- Receipt is explicitly confirmed in an intake form or the response modal. Incident
  occurrence, record creation, reporter GPS and SMS delivery are not call receipt.
- Processing is dispatch minus receipt; preparation is unit departure minus dispatch;
  travel is unit arrival minus departure; suppression is verified fire out minus
  verified suppression start. Non-fire suppression is N/A; unknown data remains null.
- A legacy dispatch arrival is reused only for a single assigned truck with valid
  ordering, and labeled as such. It is not copied to new columns. Ambiguous
  multi-truck dispatch arrivals are not attributed to individual trucks.
- CTA is first qualifying unit arrival minus receipt, once per incident. Summary
  processing uses first dispatch per incident; preparation/travel include eligible
  units. The breakdown uses one common complete fire-incident cohort and the first
  arriving unit. Suppression is excluded from CTA, and the breakdown is explicitly
  not a continuous timeline (arrival-to-suppression delay is not included).
- Windows are rolling 1/7/30/182/365 days with equal preceding comparison windows.
  Charts bucket in Asia/Manila. All period averages require a known receipt time;
  legacy records are listed by occurrence date with a receipt-unknown label.

Existing route generation is reused. Route generation/selection writes an audit
snapshot into incident_events. Departure freezes the latest selection known at that
event time, including alternatives, geometry, original ETA, distance and origin.
Rerouting can replace live route rows without changing that frozen comparison.
Delayed confirmations cannot borrow a selection recorded after departure. Missing
historical selection means comparison unavailable, even if a current route exists.
ETA difference is actual minus predicted; percentage is computed only for ETA > 0.

Mobile `POST /api/location/update` accepts optional `accuracy_m` and `sample_id`.
Existing payloads remain accepted. Automatic vehicle milestones are disabled by
default (`OPERATIONAL_GPS_AUTOMATION=false`). If explicitly enabled after phone
validation, detection requires exactly one
explicitly manned assignment, accuracy at most 35 m, a station fix within 100 m,
then two fixes confidently beyond 150 m at least 5 seconds apart. Arrival requires
two fixes confidently within 100 m of the incident after departure. Gaps over
120 seconds reset detection. Device-time samples are sorted; duplicate sample keys
are ignored. The modal only draws associated vehicle history within the response
interval, breaking paths across gaps instead of joining missing travel.

Limitations: the separate mobile application is not in this checkout and must send
accuracy/sample IDs for GPS automation. Offline GPS is supported within a continuing
manning session; after release/completion, explicit administrator confirmation is
required rather than guessing historical vehicle occupancy. Suppression always needs
human confirmation. No operational history was fabricated for the showcase database.
The existing status/alarm/severity timeline continues to filter its own event types.

The Command map also falls back to its existing Leaflet renderer after 15 seconds
if a failed worker never emits a MapLibre load/error event. Tilt/rotation still
require a working enhanced renderer; standard tiles remain available.

Deployment: back up the target database, stop the backend, review `alembic current`,
then run `venv\Scripts\python.exe -m alembic upgrade head` through `0028` from `backend/` before
restarting it. Build the frontend with `npm.cmd run build`. Downgrade below `0027`
removes the new operational fields/history metadata, so preserve a backup first.

Earlier response-only validation includes its migration chain, downgrade/upgrade,
multi-unit and missing-data calculations, ordering/idempotence, route snapshot
survival, GPS gating/offline order, role/ownership checks, existing dispatch/mobile
contracts, UI empty/error/modal/period behavior and the existing map test suite.
Tests and local verification helpers remain unstaged according to repository policy.

## Response Performance integration (2026-10-20)

Metrics contains the incident overview only. The sidebar's Analysis page groups
Response Performance, Operational Times and Coverage Planning under browser-style
tabs beneath the Analysis title row, with a heading inside each view. The former
standalone Operational Time Analysis and Planning sidebar entries are removed.
Metrics links into Analysis > Response Performance; incident details still open
the existing register.
The Average Response Time card also opens Analysis > Response Performance by
click or keyboard activation, including while its value is loading or unavailable.
The selected Analysis tab is retained when navigating away and back. Only the
active tool is mounted, and initial coverage fitting avoids a
zoom-transition callback after its map is unmounted. Response Performance uses the
existing theme and KPI components, a compact checkbox team picker, measurement
coverage meters, readable chart labels, quality badges and responsive filters.
Missing/excluded reasons, interval definitions and chart data remain available
through disclosures. Tabs support arrow/Home/End keys; the team picker supports
Escape and returns focus to its trigger. Loading, error and empty states are
explicit, and unclassified historical records can be opened from the empty state.
Response Performance uses administrator-only handlers under
`/api/metrics/response-performance`: the summary, `/dispatches`,
`/dispatches/{dispatch_id}` and `/export.csv`. Shared service observations supply
cards, monthly series, paginated rows and the full filtered CSV without silent
truncation. CSV cells escape spreadsheet formulas.

Explicit timezone-aware start/end parameters define half-open windows; month
buckets use Asia/Manila. Defaults cover the current and preceding eleven calendar
months and operational records. End dates in the UI are explicitly exclusive.
The overall receipt-to-first-arrival cohort is independent of team selection;
selected-team analysis uses dispatch-time cohorts, one row per dispatch. Equal
preceding windows supply changes. Summaries expose means, medians, nearest-rank
p90, sample counts, missing/pending/invalid/excluded counts and reasons. The
fewer-than-ten notice is descriptive, not a significance threshold. Durations over
six hours remain inspectable exclusions; raw timestamps and invalid durations are
retained in export. Unknown receipt does not invalidate dispatch-to-arrival.

Incident `record_kind` is separate from fire/medical response classification.
New live intake visibly defaults to operational and an explicit editable receipt
time; historical intake defaults to unknown with no receipt. Older incidents are
not backfilled or reclassified. Administrators can review kind through incident
editing. The existing `report_received_at` column carries the plan's call-received
semantics; there is no redundant `call_received_at` column.

Migration `0028_response_performance.py` adds nullable creation/classification and
dispatch acknowledgement/departure/actor/context fields. Assignment snapshots
preserve team/station/shift/truck identity. Unsnapshotted legacy context is labeled
as current metadata. Existing retained routes get an explicitly unverified
migration-time snapshot; previously deleted routes cannot be reconstructed.
Selected-route writers share audit snapshots, including original geometry, ETA,
distance, origin, selection reason, region and inference mode. Detail remains
available after completion. ETA error is unavailable without reliable departure
GPS matching the planned origin; saved geometry alone is insufficient.

Mobile `PATCH /api/dispatch/{id}/acknowledge` and `/depart` derive role and team
membership from the authenticated user. Assigned leaders/drivers may confirm.
Incident-first locks serialize writers; retries return the first saved timestamp
and actor. Acknowledgement retains dispatched status; departure enters en_route
and implicitly acknowledges when needed. A sole assigned truck can receive its
departure, while multi-truck team departures are not copied to every vehicle.
Legacy crew arrival without departure remains accepted. Mobile status includes
saved milestones; actions show pending/errors and require explicit confirmations.
Timestamps measure server receipt, so offline/delayed actions can be biased.

`dispatch_locations` captures membership-checked personnel samples with recorded/
received times, optional accuracy, deduplication and truck identity only during
verified manning. Existing vehicle logs also retain personnel attribution and a
unit/time index. Dispatch deletion cascades the new samples; incident deletion
explicitly removes associated vehicle logs. Retention currently lasts until
explicit incident/dispatch deletion; no automatic age purge is configured.
Agree a deployment retention policy before using production GPS history.

The Response & Operations incident/dispatch drill-downs share the recorded
responder route viewer. Incident Details links to the incident's response analysis
with a "View response analysis" action below the report, instead of embedding the
route viewer. Its administrator-only
`GET /api/operational-times/{fire_id}/responder-tracks` endpoint reads explicit
dispatch/personnel associations, orders device timestamps, and clips samples to
the dispatch's recorded assignment/completion window. It preserves the assignment
roster's names/roles and shows members with no saved locations; legacy dispatches
without a roster list only people with attributed samples. Current team membership
and unattributed historical location logs never manufacture personal histories.
Generated plans are optional dashed overlays, separate from the coloured personal
GPS paths. The Response Analysis page consolidates vehicle GPS into an optional
layer on that map; its timeline no longer contains a second map. The legacy
timing modal retains its expandable vehicle context, and the legacy dispatch
modal retains expandable generated-route revisions. Active dispatch locations refresh
every ten seconds.
The Response Analysis page and legacy timing modal use a left-side roster of member toggle buttons:
selecting a member focuses their attributed GPS route and recording metrics;
selecting them again restores all members in the selected team scope. The page's
dispatch selector scopes its roster and map; the legacy modal retains its own
team filter. Personal metrics show the GPS recording window, usable
sample count, displayed segments and excluded fixes, rather than inferred travel
or arrival. In the legacy modal, selecting a member switches vehicle timing to
their dispatch. The combined page uses an explicit truck selector for assignments
with multiple vehicles. Incident first-arrival and overall-operation summaries
remain incident-wide. The page uses the shared details shell, an incident summary
and a dispatch review; the legacy modal retains its shared header/footer. Both support dashboard themes;
narrow screens show a horizontally scrollable member row above the map.
Gaps over 120 seconds, coordinates outside valid ranges, accuracy worse than 35 m,
and jumps over 200 km/h break the displayed line; points with unknown accuracy
remain explicitly labelled. Long traces retain gap boundaries and endpoints while
limiting display to 1,500 points per person/dispatch. These lines connect observed
fixes and do not establish the exact road taken between samples. No schema or
location-collection change is required; existing migration `0028` supplies the
dispatch-attributed samples. Historical GPS that was never recorded cannot be
reconstructed from generated routes.

Local checks use a new disposable PostGIS cluster on a separate port, without the
configured application database or its .env. Coverage includes migration upgrade
and rollback, multi-team/Manila-boundary calculations, missing timestamps, retries,
ownership rejection, route survival, context preservation, GPS deduplication,
deletion, CSV escaping, dashboard behavior and the mobile API helper. Physical
phone, screen-lock and delayed-network acceptance and the intended-data sufficiency
audit remain pending. Full frontend lint has existing errors; changed feature
modules pass focused lint without adding baseline errors. No field accuracy is
claimed. Changes are uncommitted in separate dashboard/backend and mobile
integration worktrees; neither original checkout was modified.

Earlier response-only validation results: 25 backend/database/API tests, 98 frontend tests across 15
suites, four mobile API-helper tests, Python compilation and the Vite production
build pass. Populated `0026` -> `0027` upgrade and downgrade/re-upgrade preserve
legacy null fields and label surviving route snapshots without duplication.
The mobile modules parse with Babel. Locked mobile dependencies were subsequently
installed with `npm ci`, and the Android Hermes JavaScript bundle exports
successfully. No Expo native build or physical-device run has been performed.
The SDK 52 dependency check flags pre-existing React Native/vector-icons version
mismatches; package manifests and lockfiles were preserved. The mobile review `.env`
targets the PC's Wi-Fi address; phone access requires binding the backend to
`0.0.0.0` and a compatible phone runtime. Background-location acceptance requires
a development build.
The local frontend test config narrowly allows the shared dependency junction;
run `npm test -- --config tests/vitest.local.config.mjs` in this worktree. Full
frontend lint reports existing issues; comparison with the branch base retains
the same error counts in changed files. The production bundle retains the existing
large-chunk warning.

For local visual review in the separate combined review worktree,
`backend/seed_review_data.py` reads that worktree's private
`.env` and refuses any target except loopback `firetrackr_review` or
`firetrackr_web_review` at revision
`0028` in the combined web branch. It adds 19 explicitly synthetic test incidents and 34 dispatch observations
over three months, including missing timestamps, cancellation and a duration above
the six-hour guard. Synthetic planned-route revisions support the detail map.
Repeat runs preserve the fixture batch and existing user data. No notifications
are sent. Select Record kind = test in Response Performance; these rows do not
populate its operational cohort. The running API was checked for pagination, CSV
row counts, retained revisions and independence of overall response from team filters.

The combined review worktree is `../firetrackr-web-response-performance` on
`feature/web-response-performance`. Its combined source is now installed in this
original checkout alongside the existing constraint editor, model registry and model settings.
Original applied migration files `0025`/`0026` are retained byte-for-byte; operational
timing and response performance are new revisions `0027`/`0028` after them.
Mobile physical acceptance is deferred at the user's request and tracked separately.

Combined web validation on 2026-10-20: 121 frontend checks across 18 suites, all 25
response backend/database/API tests, Python compilation and a production frontend
build pass. Fresh migrations through 0028 and populated original 0026 -> 0028
upgrade/rollback/re-upgrade preserve model registry rows, constraint identities,
dispatch categories and explicit legacy route provenance. Full application startup
loads routing and passes authenticated review login, summary, details, CSV, model
summary, constraints and operational analysis checks. Full lint still reports
existing issues; see the review document for the delivery boundary.

The separate combined review worktree's private environment targets the synthetic-only
`firetrackr_web_review` database at 0028 with the existing review admin credentials.
Startup and browser review instructions remain in the local, uncommitted
`documentation/web-response-performance-review.md` guide.

Original-checkout installation on 2026-10-20 preserves the current
`feature/gnn-inference-mode` branch, original private `.env` files, existing admin
accounts and all pre-existing local source changes. The local `bfp_capstone` database
was backed up before additive migrations 0027/0028. Existing row counts are
unchanged, including all 214 incidents; their receipt times and record kinds remain
null. No synthetic fixtures or fabricated measurements were inserted. Use Record
kind = unknown and a suitable date range to inspect existing dispatch observations.
The source/database backup and install manifest are outside the repo in
`../.web-integration-review/original-install-20261020-204237/`; treat them as private.
In the original checkout, all 121 frontend checks and the build pass. Python
compilation, schema revision and authenticated GET checks for metrics, dispatch
rows, CSV, model summary, constraints and operational analysis pass, with database
transactions forced read-only during endpoint verification. That installation did
not commit, push or merge the work into Git main.

Commit preparation on 2026-10-20 validates each staged application checkpoint in
a separate snapshot using only Git's indexed sources: production frontend build,
Python parsing, backend imports and offline migration SQL generation pass. All
132 local frontend tests and 59 selected isolated backend checks pass after fixing
the heatmap test's missing audit-table fixture. Tests and local database helpers
remain outside these commits. Live PostgreSQL upgrade/rollback and physical mobile
acceptance were not repeated during commit preparation. Existing lint findings
remain at 25 errors and 3 warnings, matching the prior committed baseline counts.

## Important decisions and facts to confirm

Keep Panabo's digitized graph separate from OSM test data; preserve common graph
construction across routing processes; separate penalized route selection from
base-time ETA; reuse serializers and export document models; keep PostGIS for
spatial containment/deviation; maintain the current one-worker event architecture
until shared state is implemented. These choices explain behavior and constrain changes.

Confirm externally before operational claims: actual DB host/version/PostGIS setup,
production origins/TLS/tunnel, dependency versions that currently run successfully,
available local tests and their database safety, mobile-project revision, push/SMS
credentials and device delivery, training preprocessing/provenance/evaluation data,
and observed field dispatch/arrival measurements. Do not record secret values here.

### Command map interaction updates (2026-10-20)

- Projected command maps show hover cards for interactive incident, station,
  personnel and obstruction markers. Popup content stays in Leaflet so existing
  React actions work, while the active renderer supplies its screen anchor.
- Obstruction markers follow map tilt; raster circle overlays align to the map.
  Historical heatmap hit areas reveal visible incident dots at Leaflet zoom 16
  (MapLibre zoom 15), retaining grouped details for shared coordinates.
- Camera controls live in an independent bottom-right slot. The incident/layer
  dock reserves space above them, including when the incident panel is collapsed.
- One camera button toggles between Bird's-eye view (zero tilt) and Back to
  default (40-degree tilt for standard maps, 55 degrees for photorealistic 3D),
  facing north while preserving the current location and zoom. Its label follows
  the live camera tilt, including changes made with the other camera controls.

- Command-map incident details are hover-only (including newly logged incidents):
  clicking selects the incident and closes hover content without creating a
  fallback popup. Heatmap incident detail popups remain available. Incident and
  obstruction cards share the constraint hover-card typography and surface style.
  Camera and Actions panels share the same 9.8px bottom offset.

### Hosted retraining recovery (2026-11-07)

- The Render Blueprint builds from the repository root, installs the optional
  Modal adapter and starts the API from `backend/`. The root `.python-version`
  retains Python 3.12. Hosted secrets supply Modal credentials independently of
  a developer's local login. `training/` remains available for source verification.
- New Modal jobs save app/volume/environment, creation time, spawn intent and
  acknowledged call ID in the existing training row's report JSON. Polling and
  cancellation resume from that metadata on an empty disk. Cloud worker status
  also records its call ID for lost-acknowledgement recovery. Recovery never
  resubmits training; legacy jobs without this metadata still need their files.
- `MODEL_ARTIFACT_STORAGE=supabase` checks the existing private model bucket
  before submission and publishes verified results before candidate status commits.
  Storage outages retain the reservation for retries. Duplicate uploads require
  verification of the stored archive and never overwrite objects. The local
  default remains explicit operator publication. Original, candidate and archived
  registered artifacts can be restored for snapshots, review and promotion checks.
- Source compatibility hashes normalize CRLF/LF without ignoring code changes.
  The updated worker/contract requires redeploying the matching Modal trainer.
  `backend/check_retraining.py` checks authentication, compatibility and private
  storage using the CPU diagnostic endpoint; it submits no training or DB writes.
  The Models client now displays the backend's safe 503 detail when provided.
- Isolated SQLite tests with advisory locks mocked and fake Modal/storage
  transports cover restart recovery, lost acknowledgements, cancellation, storage
  retries, verified duplicate uploads, restored candidate review/promotion readiness
  and source line endings. No hosted deployment, live GPU job, model promotion,
  database migration or live storage write was performed for this change.
  See [hosted setup](documentation/render-free-trial.md#hosted-retraining-setup-november-7-2026).

### Registered model restoration on ephemeral hosts (2026-11-04)

- Routing restores missing registered bundles from private Supabase model storage
  before reading constraint overlays. `SUPABASE_MODEL_BUCKET` defaults to
  `model-artifacts`; existing backend Supabase credentials are reused.
- `backend/publish_model_bundle.py` explicitly publishes a verified local bundle
  without overwriting storage objects or changing registry records. Startup only
  downloads; it does not publish or change bucket settings.
- Cache installation verifies the registered manifest digest, every file hash
  and version, bounds archive sizes, rejects unsafe entries, and installs
  atomically. Existing model directories retain the normal integrity checks.
- A disposable PostGIS cold-start check with registered `v1`, an empty model
  cache, one drawn road constraint and mocked private storage passes routing,
  coverage, HTTP and WebSocket checks. With operator approval, the 1.3 MiB `v1`
  bundle was published privately and an actual cloud download into an empty cache
  passed manifest and all six artifact hash checks. Registry records were not
  changed. See [Render trial](documentation/render-free-trial.md).
