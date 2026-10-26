# Capstone objective implementation and review

Updated 2026-10-24. The original `firetrackr` and sibling `firetrackr_mobile`
checkouts contain the changes. GAT remains the selected model; model selection
and active model artifacts were not changed.

## Start and review

Restart the normal backend process and reload the dashboard to load the new code.
The original loopback `bfp_capstone` database is now at migration **0031**. A
verified custom-format pre-migration backup is stored outside this Git checkout:
`../../.capstone-validation/bfp_capstone-before-0031.dump` relative to this guide.
The migration preserved existing table counts, including all 214 incidents.
No `.env` was edited. Do not apply the migration again manually if the database
already reports 0031; other installations must follow their normal backup and
reviewed `alembic upgrade head` workflow using this checkout's migration chain.

Dashboard locations:

- **Analysis > Response & Operations**: select Recorded operational times and the
  correct record population. Overall operation time is report received through
  operation completion/all units cleared. Its card, per-incident table, trend
  selector and timing CSV use recorded endpoints. Demonstration timings stay
  separate and never supply a synthetic operation endpoint.
  This combines the former Response Performance and Operational Times tabs.
  Shared date/kind/station/barangay/severity filters apply to incident lifecycle
  analysis and dispatch comparisons. Team selection affects dispatch comparisons
  only. Incident cohorts use receipt date (occurrence fallback if receipt is
  unknown); dispatch cohorts use dispatch date. Processing counts the first
  dispatch once per incident; preparation/travel count trucks. The team section
  retains one observation per dispatch, including later reinforcements.
  Incident and dispatch tables each have a full filtered CSV review/export.
  Response intervals share chronology and six-hour review guards; suppression
  and overall operation intervals allow valid longer durations. Raw timestamps
  remain inspectable when a response interval is invalid.
  Stage trends use hourly buckets for short windows, daily buckets up to 62 days,
  and monthly buckets for longer windows, in Philippine time.
  Consolidation validation: 183 frontend checks, 39 disposable PostGIS/API checks,
  production build and focused lint passed. Browser checks used synthetic UI
  fixtures at 1440px/dark and 390px/light; no page overflow was observed. Full-project
  lint still reports 25 unrelated existing errors and three warnings. This change
  needs a backend restart and dashboard reload, with no additional migration.
  The subsequent UI refinement groups optional filters behind **Refine by team,
  station or location**, adds removable selections and **Reset filters**, and links
  each stage to the trend selector. Stage distribution shows the shared complete
  fire-incident sample. Team comparisons expand below the charts; incident records
  remain directly accessible. The calculation and export contracts are unchanged.
- Open an incident's response analysis, then **Confirm a verified operational
  milestone**. Record dispatch clearance for every eligible response, fire out
  for fire responses, and then operation completion. Administrators can record
  verified past event times. Confirmations preserve their original timestamps.
- **Analysis > Operational Reports**: choose Personnel Deployment, Fire-Prone
  Areas or ETA Prediction Error. Date bounds use Philippine time and the Until
  boundary is exclusive. Timing/deployment reports default to the latest twelve
  calendar months and operational records. Unclassified legacy history is an
  explicit population choice. CSV previews export the complete filtered report,
  including rows beyond the screen's 25-row pagination.
  Report choices appear above the filter panel, followed by summary cards.
  Personnel summary and Assignment log share a table panel; use its view controls
  to switch. Personnel/team/station/shift filters expand under Assignment filters.
  The methodology disclosure retains the report's evidence and formula notes.
- Personnel Deployment provides both detail and summary CSVs. An assignment is
  recorded roster membership, not proof that a person attended. Names/roles are
  preserved at assignment and audited on changes; historical rosters are never
  reconstructed from today's team. Duration requires recorded release/clearance,
  is clipped to the selected period, and merges overlapping intervals per person.
- **Analysis > Operational Reports > Fire-Prone Areas** contains the severity-weighted
  barangay ranking. Metrics retains its existing frequency overview. Severity weights are Minor 0.4,
  Moderate 0.7, Critical 1.0 and unknown 0.5; tied weighted scores share a competition
  rank. Use source filtering to select BFP imported history or other entries, and
  the known-severity option to exclude missing severity. Estimated locations and
  unassigned barangays remain disclosed. Heatmap and ranking APIs share their
  eligibility and filtering logic; independent UI filters must match for comparison.

## Mobile duty tracking

The backend owns the A/B roster with an 08:00 Asia/Manila handover. An unassigned
or unknown shift, explicit off-duty/inactive membership, ambiguous simultaneous
dispatch assignments or invalid session does not authorize tracking. Team shift
does not override the personnel's assigned shift.

| State | Target update interval |
| --- | --- |
| On duty, standby | 30 seconds |
| On duty, dispatched / en route | 3 seconds |
| On duty, on scene | 20 seconds |
| Off duty / signed out / permission denied | No sharing |

Both foreground and native background paths send device event time, accuracy and
a stable sample ID. Shared ownership prevents simultaneous foreground/background
sends. Server directives let a headless phone move from completed dispatch to
standby. Standby fixes update personnel only, without truck motion, route deviation
or vehicle milestones. The server checks duty and membership before writes,
rejects fixes older than two minutes, and deduplicates retry keys. Delayed fixes
from the same source cannot overwrite newer positions. Historical IoT attribution
is not invented by the additive location-log columns.

The phone uses a renewable two-minute eligibility lease capped at duty end. On
logout or expiry it invalidates pending replies, clears persisted tracking context
and stops native updates. Offline collection does not continue beyond the cached
lease; no GPS backlog was introduced. After the native service stops off duty,
open the app when starting the next shift to refresh eligibility. A guaranteed
unattended background wake-up at the next shift is not implemented.

Assigned leaders/drivers can acknowledge and depart through the incident modal.
Only an assigned team leader can record their on-scene dispatch clearance; an
administrator can confirm verified clearance through the dashboard. Clearance
records physical evidence separately from administrative closure/resource release.
Filing a report still follows the existing containment/closure workflow. Gaps
between fire out, clearance and report submission are not silently filled.

## Evidence and remaining acceptance

Validation used synthetic fixtures only in a disposable PostGIS database on
loopback port 55487, plus read-only endpoint checks against the original database.
The full migration chain upgraded successfully, and 0031 downgrade/re-upgrade
passed. API checks include role denial, duty handover, standby side effects,
duplicate/out-of-order samples, multi-team clearance, long operations, roster
changes, map/report cohort parity, source filters and saved-ETA comparisons.

Validation totals: 174 frontend tests, 55 PostGIS/API tests (30 objective checks
plus 25 existing response checks run with their URL guard redirected exclusively
to the disposable database), 24 backend unit checks, and 14 mobile policy/API
checks pass. The web build passes. Browser review covered desktop and 390-pixel
layouts in both themes using explicitly synthetic report fixtures.

The current original local database contains 214 incidents attributed to GPS,
reporter or manual sources, and no `bfp_import` provenance events. Consequently,
the BFP-imported-history source filter is currently empty. Source files/documentation
about an earlier import do not establish that it is present in this database;
this implementation did not import or replace historical incident records.

Automated mobile checks simulate native/task/network races and API helpers. The
modified mobile files also parse successfully using Babel. These checks are not
a native build or phone trial. The original mobile checkout has no installed
dependency tree in this environment; restore its locked dependencies using the
project's normal setup before running its native workflow. Permission wording in
`app.json` needs inclusion in the native build being reviewed.

Physical acceptance still needs a real phone: grant/deny background location;
observe 30-second standby updates with the screen locked; transition through
dispatch/on-scene/completion; acknowledge/depart/clear with retries; test logout,
account switch, network loss, policy expiry and duty handover; then foreground the
app at the next shift. Record actual delivery intervals and battery/data usage.
GPS milestone automation remains unchanged and disabled by default.

The current application history lacks preserved personnel rosters, so deployment
reports begin collecting evidence for new assignments. Missing historical
timestamps, severity and accurate locations remain unknown. ETA summaries include
only comparable trips with a saved prediction and reliable departure-origin fix;
an empty eligible population does not imply perfect accuracy. No calibrated field
performance is claimed. Assignment history is currently JSON-backed and read at
report time; very large datasets may need a dedicated indexed assignment table.

Repository-wide ESLint retains existing findings outside this implementation.
Focused lint on the added/changed report and analysis modules passes. The existing
production bundle-size warning also remains.
