# Response Performance implementation plan

Status: combined web implementation; web review and mobile field acceptance pending. Prepared
2026-10-18; implementation status updated 2026-10-20.

## Integration delivery status

The combined implementation is now installed in the original `firetrackr` checkout,
on its existing `feature/gnn-inference-mode` branch, alongside model management and
the constraint editor. Existing local source changes and private environment files
are preserved. The original local `bfp_capstone` database was backed up and upgraded
from 0026 to 0028; all existing row counts, including 214 incidents, are preserved.
No synthetic records were seeded and no old receipt times or record kinds were
invented. That installation did not commit, push or merge the work to main.

`../firetrackr-web-response-performance` on `feature/web-response-performance`
remains the combined review snapshot with its separate synthetic database. The
earlier response-only worktree and `firetrackr_review` database remain separate.
The original-checkout run instructions remain in the local, uncommitted
`documentation/web-response-performance-review.md` guide. Test-database launchers,
fixtures and review guides are excluded from application commits.

Mobile is `../firetrackr-mobile-response-performance` on
`feature/response-performance-integration`; the user deferred physical phone review.
That review is tracked separately from the web implementation.

Implemented: a Metrics overview and an Analysis page with Response Performance,
Operational Times and Coverage Planning tabs; explicit date/team/kind/
station/barangay/severity filters, independent overall first arrival, per-dispatch
observations, monthly team trends with gaps and accessible tables, mean/median/p90,
quality counts and reasons, equal-window comparisons, retained route revisions and
assignment context, filtered full CSV export, and server-received mobile acknowledge/
depart actions. New intake displays receipt time and record kind explicitly;
backdated intake clears receipt and defaults to unknown. Legacy records remain
unclassified. The original web chain's already-applied `0025` (constraint segment
identities) and `0026` (model registry) are preserved. New `0027` adds operational
timing; new `0028` adds response performance. The colleague's compatibility repair
is unnecessary here because authoritative `0024` already adds dispatch type.
Do not point this chain at the earlier response-only review database: its same
numeric revision IDs represent a different schema. Use a fresh database or the
verified original constraint/model chain with a backup and explicit migration step.

Attributable GPS stores dispatch/personnel and only assigns truck identity when
manning is verified. Retry keys deduplicate fixes. Dispatch deletion cascades sample
history, and incident deletion explicitly removes associated vehicle logs.
Collection has no automatic age-based purge yet; a deployment retention policy still
needs agreement. GPS milestone automation defaults off behind
`OPERATIONAL_GPS_AUTOMATION`; phone validation is required before enabling it.
Existing stage-analysis maps remain available, while the new history view presents
preserved planned routes. ETA comparisons require a reliable departure fix matching
the predicted origin.

Validation uses a separate disposable PostGIS cluster and local test fixtures.
Fresh migration upgrade, isolated rollback/re-upgrade, backend/API behavior and
frontend unit checks are exercised; see KNOWLEDGE.md for final results. Outstanding
acceptance: physical-phone actions/screen-lock/delayed-network checks, intended-data
read-only sufficiency audit, deployment retention agreement and field demonstration.
No calibrated performance or AI improvement is claimed. Migration reconciliation
in this branch adds new revisions after the original history. Original applied
migration IDs are unchanged; the original local database received the additive
0027/0028 schema changes after a verified backup.

## Purpose and delivery boundary

Help station officers review response trends, identify cases worth investigating,
and trace a monthly statistic back to its dispatch records and route information.
This is descriptive operational analysis, not a team leaderboard or proof that AI
routing caused faster responses.

Deliver a dedicated Response Performance view inside the Analysis page. Metrics
retains the overview; the sidebar's former standalone stage-analysis and Planning
entries are grouped under Analysis as Operational Times and Coverage Planning.
Use the current React state navigation, API client, CSS tokens, Leaflet components,
and admin authorization. The separate mobile project is at `../firetrackr_mobile/`.

Defense scope: monthly team comparisons, incident/dispatch drill-down, transparent
data-quality counts, mobile acknowledgement/departure collection, and preserved
planned route history. Actual GPS replay is a second milestone; collect attributable
GPS now so the data exists when replay is implemented. No application changes or
database operations are authorized by this planning document itself.

## Verified starting point

- `backend/routers/metrics.py` computes one overall average: incident timestamp to
  earliest recorded arrival per incident. It excludes durations outside (0, 6h].
- `fire_incident_datetime` can be manually backdated to incident occurrence; it is
  not a dependable call-received timestamp for every record.
- Dispatch records link incidents, teams, selected routes, dispatch time and arrival.
  Acknowledgement and departure timestamps do not exist. Arrival is a server timestamp
  written when a team member presses the mobile arrival action.
- Route records contain WKT despite the `route_path_geojson` column name. Rerouting
  deletes and replaces dispatch routes, losing previous geometry and estimates.
- Mobile location history uses `device_id=None`, coordinates and receive time without
  personnel/dispatch attribution. CurrentLocation has identity but is overwritten.
  Truck logs have truck identity but no explicit dispatch link.
- Local database contents and usable sample counts have not been inspected. Existing
  records cannot establish data sufficiency solely because the schema has timestamps.

## Metric contract

Calculate durations in seconds on the backend, aggregate before rounding, and display
minutes and seconds. Return null for unavailable measurements, never zero placeholders.

| Measure | Definition | Unit and sample |
| --- | --- | --- |
| Overall first-arrival response | First eligible crew arrival minus call received | Time; one observation per incident |
| Team response after dispatch | That dispatch's arrival minus its dispatch time | Time; one observation per dispatch |
| Dispatch handling | Dispatch time minus call received | Time; per dispatch |
| Acknowledgement delay | First acknowledgement minus dispatch time | Time; per dispatch |
| Turnout | Departure minus dispatch time | Time; per dispatch; includes acknowledgement delay |
| Travel | Arrival minus departure | Time; per dispatch |
| Period change | (Current mean - previous mean) / previous mean * 100 | Percentage; negative means faster |
| Within target | Valid observations at or below an agreed target / valid observations * 100 | Percentage; optional |

Acknowledgement delay is a subset of turnout; do not add both in a stacked timeline.
Call-to-arrival is not currently available reliably for all legacy records. Present
legacy incident-time-to-arrival only as an explicitly labeled proxy, separately from
verified call-to-arrival. Do not combine them into a single average.

Overall service response always considers all crews, independently of team selection.
Team filters affect the team analysis section, not the overall first-arrival card.
An incident with three dispatched teams contributes once to overall service response
and up to three observations to dispatch analysis. Never average team averages to
produce a combined mean; aggregate their underlying eligible dispatch observations.

Use explicit start/end dates, half-open intervals [start, end), and calendar-month
buckets in Asia/Manila. Team cohorts use dispatch time; overall cohorts use call
received time. Compare equal-length preceding date windows; label calendar-month
comparisons explicitly. Missing or zero baselines produce no percentage change.

Each aggregate returns candidate, valid, pending/no-arrival, invalid and excluded
counts, plus metric-specific completeness. Count unfinished dispatches visibly but
do not treat them as zero-duration arrivals. Do not silently remove slow responses.
Flag chronology errors and durations above the existing six-hour guard for review;
show exclusions and reasons. Retain all raw observations for inspection.

Show sample count with mean and median; include p90 with its calculation method
documented and a descriptive small-sample notice. No minimum sample count is a claim
of statistical significance. A month without measurements is a chart gap.

Default to operational data; offer drill/test and legacy/unknown as separate filters.
Do not classify old records as operational automatically. Target attainment remains
hidden until BFP agrees on a metric and threshold; no external standard is assumed.
Team comparisons expose location, distance, shift, severity and reinforcement context
where recorded. They do not attribute delay or performance causally to a team.

## Data collection and migrations

Use new Alembic revisions after the actual current head (0026 at integration start); leave
existing migrations and user changes untouched. New historical fields are nullable.

1. Incident context: add `call_received_at`, `created_at`, and a constrained
   `record_kind` (operational, drill, test, unknown). Preserve occurrence time.
   New live intake records an explicit call-received time, defaulting visibly to
   intake time; historical intake may leave it unknown. New `created_at` is generated
   server-side. Leave legacy values unknown rather than inventing backfills.
2. Dispatch milestones: add acknowledgement and departure timestamps and actors.
   Snapshot team name, station, shift and initial truck identity at assignment, so
   later renames/reassignments do not rewrite historical context. Legacy snapshots
   can use current metadata only with a visible provenance label.
3. Append-only selected-route snapshots: dispatch ID, revision, selected time,
   selection reason, geometry, distance, ETA, origin, routing region/inference mode,
   and source route ID as a nullable reference. Snapshot data must survive deletion
   of replaceable operational Route rows. Store the initial selected route, manual
   switches, full reroutes and driver/station fallback changes. Preserve historical
   snapshots without changing current route ownership behavior.
4. Attributable GPS observations: append a dedicated dispatch location history table
   with dispatch, personnel, truck when authorized, recorded/received timestamps,
   coordinates, source and optional accuracy. Derive identity/truck authority from
   JWT and dispatch membership; do not trust client identity fields. Use an event ID
   or equivalent uniqueness rule to deduplicate retries. Index dispatch/time and
   enforce coordinate/clock validation consistent with live location handling.

Capture route snapshots through one shared helper called by every route-selection
writer, including services/routing.py, the full-reroute endpoint and manning fallback.
Write snapshot and selected-route updates in the same transaction where possible.
Initial snapshots from routes still present at migration time are marked legacy;
previously deleted routes cannot be reconstructed. Preserve the original prediction
separately from estimates generated during travel.

Travel ETA validation requires a plan captured at departure from an appropriate
origin. A station-origin assignment ETA may not match a crew departing elsewhere;
display both without treating them as comparable by default.

Define retention, deletion and access for GPS history before deployment. Existing
explicit incident deletion semantics must account for new dependent tables; do not
silently convert delete into archival. Lifecycle retention policy is a separate
decision from append-only snapshots during normal routing updates.

## Backend and mobile contracts

Add analytics query/aggregation logic in `backend/services/response_performance.py`
and admin-only handlers under the existing metrics router:

- `GET /api/metrics/response-performance`: filters, definitions, overall and team
  summaries, per-month series, completeness and prior-period comparisons.
- `GET /api/metrics/response-performance/dispatches`: paginated dispatch rows with
  incident/team context, milestones, durations, eligibility and missing-data reasons.
- `GET /api/metrics/response-performance/dispatches/{dispatch_id}`: historical
  timeline, route revisions and context; no dependence on active-dispatch endpoints.
- Milestone APIs: `PATCH /api/dispatch/{id}/acknowledge` and `/depart`, returning the
  first saved timestamp and actor. Repeated identical actions return existing state.

Validate dates, filter enums, team IDs and bounded pagination. Use the same filtered
query definitions for cards, chart, drill-down and export. Allow selection of teams
with historical records even when no longer operational. Prevent join multiplication
from photos, routes, members or GPS points. Add indexes based on query inspection.

Keep existing `dispatched` status after acknowledgement for client compatibility;
departure transitions it to `en_route`. Leader or currently authorized driver may
acknowledge/depart; the first actor marks the team-level milestone. Verify role and
membership server-side. Reject mutations after arrival/completion. Departure may
implicitly acknowledge at the same server timestamp, marked as implicit. Continue
accepting legacy arrival without departure; travel remains unavailable. Do not
fabricate travel timestamps for older clients.

Update mobile status payloads, API helpers and active dispatch actions, using the
existing polling/WebSocket mechanism. Show saved milestone times and pending/errors;
disable duplicate submissions while in flight. Server receive timestamps are the
first milestone implementation's timing source. Delayed/offline taps can bias these
measurements; label them as recorded actions. Durable offline milestone synchronization
and GPS-assisted arrival verification are follow-up work.

Broadcast milestone events only after commit and invalidate affected analytics
caches on dispatch, arrival, incident time/context edits and completion. Reconcile
through App's existing socket, with a manual refresh and fetch-on-view fallback.
Do not add a second analytics socket or run history aggregation per GPS update.

## Dashboard design

Provide Overview and Response Performance tabs in Metrics. Link the current response
KPI to the new view and label the existing metric's legacy semantics accurately.

1. Date range, team multi-select, record kind, optional station/barangay/severity,
   and explicit refresh. Default to the latest 12 calendar months and operational data.
2. Separate overall first-arrival summary from selected-team dispatch analysis.
   Cards show mean, median, p90, sample size, completeness and period change.
3. Monthly line chart comparing selected teams with a common duration axis, legend,
   accessible data table and per-point sample counts. Use existing SVG conventions;
   selecting a month filters the dispatch table. Keep missing months as gaps.
4. Paginated table: incident reference, team, incident location/date, dispatch,
   acknowledgement, departure, arrival, response duration and data-quality status.
   A row represents a dispatch, so the same incident can appear for different teams.
5. Detail panel: timeline and duration breakdown, incident navigation, planned-route
   map with revision selector, origin and destination, initial ETA and missing-data
   explanations. Convert WKT/GeoJSON explicitly and preserve coordinate order.
6. CSV export of filtered dispatch observations, including raw timestamps, durations,
   provenance and exclusions; reuse formula escaping. Paginate the export or expose
   its limit; never silently truncate. PDF/DOCX reporting is outside the first delivery.

Actual trace replay is a later view over attributable GPS, distinct from planned
routes. Show driver/truck samples, gaps and accuracy; do not draw a continuous journey
through missing observations or infer that interpolated lines are roads traveled.

## Implementation order and acceptance gates

### A. Data audit and collection foundation

- Read-only audit: count dispatches/arrivals by team and month, missing/invalid
  timestamps, retained routes and test/legacy records. Use aggregate output; avoid
  exporting reporter contacts or credentials. Confirm the intended DB before access.
- Add migrations, snapshots, context fields, milestone APIs and mobile actions.
- Begin attributable GPS collection, with replay UI deferred.
- Gate: repeated actions preserve first timestamps; unauthorized teams cannot mutate;
  new route revisions survive reroutes; historical records remain explicitly unknown.

### B. Defense page

- Implement shared aggregation, drill-down, dashboard tabs, chart, history map and CSV.
- Preserve the current summary API contract; introduce explicit new metric definitions
  without silently redefining existing clients' response values.
- Gate: every chart point reconciles with eligible dispatch rows; multiple teams at
  one incident count correctly; current team filters never change overall first arrival;
  missing values are visible; historical route detail works after dispatch completion.
- Use clearly marked drills to demonstrate sparse months; never present generated
  history as operational results. No invented performance improvements.

### C. Historical travel review and evaluation

- Add GPS trace/replay after collection quality is verified on a physical phone.
- Add travel-versus-ETA evaluation only for compatible departure/route observations.
- Add agreed response targets and target-attainment percentages when defined by BFP.

## Validation and completion evidence

Use a disposable PostGIS database for migrations and behavioral checks. Verify
upgrade/backward compatibility with nullable legacy data and rollback in isolation.
Focused cases must cover multiple crews/late reinforcement, weighted aggregation,
Manila month boundaries, missing departure/arrival, invalid chronology, duplicate
milestone requests, ownership rejection, route replacement and historical labels.
Compare aggregate totals with hand-calculated fixtures and exported rows.

Run frontend lint/build and appropriate focused backend checks. Current repository
policy keeps tests local; report that fresh-clone CI coverage remains unavailable
unless that policy is separately changed. Exercise mobile acknowledge/depart/arrive
on a physical device, including delayed network responses and screen-lock tracking.

Before calling the feature ready, demonstrate: live intake -> dispatch -> mobile
acknowledgement -> departure -> arrival -> completed incident -> monthly drill-down
-> retained planned route. Also demonstrate an old record missing departure and a
month with no observations. Update KNOWLEDGE.md/CLAUDE.md only with implemented and
verified behavior. Do not claim field accuracy from the demonstration.

## Decisions to confirm before their dependent implementation

- BFP's meaning of call-received time and whether a response target exists.
- GPS history retention and who may inspect it beyond current admin access.
- Existing database data classification; leave unreviewed records unknown.

These do not block planning or a legacy dispatch-to-arrival view. Target percentages,
operational claims about old data and production GPS retention depend on the answers.
