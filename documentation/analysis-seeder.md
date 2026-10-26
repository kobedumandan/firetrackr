# Populate Analysis in the main local database

To exercise live dispatch workflows automatically, use the separate
[unattended simulation runner](unattended-simulation.md). It tests browser alarm
escalation and mobile API actions in a disposable database; this seeder supplies
historical examples for analysis.

`backend/seed_analysis.py` adds auxiliary dispatch evidence to the existing
synthetic incident register. It targets the local PostgreSQL database configured
by `DATABASE_URL` (environment takes precedence over `backend/.env`), at migration
`0031`. It does not switch the application to the older Analysis review database.

Affected incidents use **`record_kind=operational`** so the local demo appears in
normal dashboard, heatmap and Analysis views. No special Test selection is needed.
Generated audit events retain `source=analysis_seed_v1`, `verified=false` and
synthetic provenance in metadata; response times and GPS are simulated.

## Run

From `firetrackr/backend`:

```powershell
# Read-only preview: computes a plan without changing rows or sequences.
& .\venv\Scripts\python.exe seed_analysis.py

# Makes a pg_dump backup, verifies its contents can be listed, then seeds atomically.
& .\venv\Scripts\python.exe seed_analysis.py --apply
```

Repeat application preserves the completed batch and any subsequent edits. The
completion manifest is stored in `incident_events`; a second seeder holds a
transaction advisory lock and checks that manifest before inserting anything.
An error rolls back the entire seed transaction. PostgreSQL sequences can advance
on a failed apply even when no rows survive. Preview does not allocate IDs.
For an earlier batch classified as Test, `--apply` backs up the database and moves
that batch into the normal operational population without generating more rows.

`pg_dump` / `pg_restore` must be available on PATH or under the standard Windows
PostgreSQL installation directory. Backups go to ignored `backend/seed-backups/`.
`--backup-dir` changes that location. An apply fails before writing if its backup
cannot be created or listed. Backups contain the original database, including
account data, and should stay local. Listing is an archive integrity check;
restore validation was performed separately on the development copy.

Optional `--recent-count 96` controls the number of recent replays (24–500).
`--as-of 2026-10-24T20:00:00+08:00` makes the simulation cutoff explicit; otherwise
the current time is used. A completed batch keeps its original dates on reruns.

## Generated data and assumptions

- Untouched closed incidents receive dispatches, truck assignments, acknowledgment,
  departure, arrival, suppression/fire-out, physical clearance, operation completion,
  crew snapshots and synthetic after-action reports. Original IDs, dates, locations,
  addresses, severity and alarm levels stay intact. Old modified incident field
  values are retained in that incident's `analysis_seed` event metadata.
- Incidents with dispatches, reports, events, operational classification or timing
  evidence are skipped. Imported BFP historical records are excluded. Original
  active incidents and existing dispatch records are preserved.
- Ninety-six new incidents replay source locations across approximately 24 months,
  including the past day/week/month, to populate current trends and preceding-period
  comparisons. Twenty additional named scenarios exercise quality and exception
  handling. Replays have `[SYNTHETIC]` addresses and keep their source incident ID
  in provenance. Some original rural locations can be skipped if no directed road
  route or available simulated crew can be found; the CLI reports skipped counts.
- Existing Panabo stations, crews, shifts, trucks and members supply simulation
  inputs. These are assumed historical assignments, not evidence that today's
  roster existed on an old incident date. Team/truck status and current locations,
  memberships, accounts and credentials are not modified. New teams/accounts are
  not needed. New dispatches have terminal statuses, including cases with missing
  historical endpoints, to keep fixtures out of live dispatch automation.
- Simulated assignments reserve teams, trucks and personnel through clearance,
  completion and a recovery interval. Legacy open dispatches and legacy completion
  intervals longer than ten hours reserve four hours **for simulation scheduling
  only**. Their original database endpoints are untouched. The seeder does not
  establish their true clearance times.
- The application's ALT router computes directed paths on the actual exported
  Panabo road network. Normal dispatches retain one planned route; the route-revision
  scenario saves alternatives and a subsequent change. Predictions use base road
  travel times; simulated actual travel adds varying turnout, traffic and stop
  delays. Current exported constraints are simulation inputs, not reconstructed
  historical traffic or a test of model accuracy. Road connections may stop at a
  snapped access point near a rural incident rather than at its exact pin.
- Invented vehicle fixes follow the route geometry at 20-second intervals with
  simulated accuracy and receipt delay. Explicit truck/dispatch/personnel links and
  a departure fix allow comparable-trip ETA analysis. GPS is not real telemetry.
  Scene photo attachments are not fabricated.
- Suppression length varies with severity. Medical and rescue responses have no
  suppression endpoints. Physical clearance, operation completion and report
  submission have separate times. Crew snapshots preserve role segments and releases.

## Evaluate the Analysis page

| View | Select | Checks |
| --- | --- | --- |
| Response & Operations | Default recorded operational view; select **All recorded dates**, a recent period or custom dates | Incident first-arrival/overall-operation cards, response stages and trends; team comparison, mean/median/p90 and quality counts; independent incident/dispatch pagination, both full filtered CSVs, incident GPS/routes and dispatch revision details |
| Operational Reports → Personnel Deployment | Default operational view | Personnel totals, assignment log, role segments, missing rosters, clearance coverage, personnel/team/station/shift/date filters and both CSVs |
| Operational Reports → Fire-Prone Areas | Default historical view | Barangay weighted ranking, severity coverage, known-severity filter and CSV |
| Operational Reports → ETA Prediction Error | Default operational view | Predicted/actual travel, signed error, MAE/median error, eligible/excluded trips and CSV |
| Coverage Planning | Recompute, then **3 / 5 / 8 minutes** | Real station/road reachability, map, barangay gaps and export; this view uses stations and roads rather than seeded incident timings |

Response & Operations opens recorded milestones by default. The optional BFP-history
synthesized-demo selector remains a separate legacy source; it is not needed for
this dataset. The seed is included in the default historical heatmap and ranking.

The CLI manifest prints an example incident ID for each scenario:
`reinforcement_first`, `cancelled`, `recalled`, `missing_receipt`,
`missing_acknowledgement`, `missing_departure`, `missing_arrival`, `gps_gap`,
`no_gps`, `origin_mismatch`, `no_baseline`, `route_revision`, `missing_roster`,
`roster_change`, `missing_clearance`, `clock_error`, `above_six_hours`, `medical`,
`rescue`, and `unknown_severity`.

`clock_error` deliberately stores a dispatch arrival before departure, leaving
the individual truck arrival unknown so database chronology constraints remain intact.
`above_six_hours` deliberately stores a corrupt arrival over six hours after
departure. These two cases evaluate quality guards and are not realistic journey
examples. Response & Operations shares the six-hour response guard across incident,
dispatch and truck response intervals. Suppression and overall operation durations
can exceed six hours. Invalid response endpoints remain inspectable in detail
timestamps with quality reasons; they do not enter valid response or ETA averages.
Counts still differ when one incident has several dispatches or trucks. Missing arrival/clearance cases are
closed administrative records with incomplete evidence, not current field activity.

## View a team's route

Open **Analysis → Response & Operations → Incident records → an incident row**, select its responding
truck/team, and choose **Travel**. The map shows saved planned route choices and
the vehicle's recorded GPS track as a dashed line. It does not join tracking gaps.
The travel comparison uses the route selected at departure, even if a later choice
changed the dispatch's current route. Without historical GPS, a planned route alone
cannot identify the path driven. In these fixtures the dashed track is simulated.

**Response Performance → dispatch detail** also shows saved route revisions and
their planned geometry. Its map currently displays the selected planned revision;
the historical vehicle GPS overlay is in the Operational Times detail map.

## Show seeded incidents on the heatmap

The Command map includes the seeded data normally. Use **All time** to remove
date restrictions; no record-population switch is needed. The API returns 323
closed incident points and the displayed Panabo boundary includes **312 points**.
Eleven fixture coordinates lie inside the stored barangay polygons but outside
the frontend's municipal outline. Two canceled fixtures and five original
incidents that are not closed are also excluded from the heatmap.
Shared source coordinates can place several incidents at one map pin; hover/click
that pin to inspect them.

## Local validation

The local read-only integration checks are in
`backend/tests/check_analysis_seed.py`. Run with the backend virtualenv after
seeding the intended validation database. They exercise actual FastAPI routers
without starting the application's SMS/push/background tasks. The full apply path
should be tested on a restored disposable copy before use on another main database.
The seeder does not run schema migrations or change either app's `.env` file.

### Applied to the main local database on 2026-10-24

The validated batch was applied to `bfp_capstone` after making
`backend/seed-backups/before-analysis-seed-20261024-204954-971726.dump`.
The database now has 330 incidents: all 214 original records plus 116 replays
and scenarios. Of the originals, 203 untouched closed incidents were enriched.

The batch added 390 dispatches and truck assignments, 392 routes, 317 after-action
reports, 116 heatmap rows and 21,782 simulated vehicle GPS samples. Useful examples
include **INC-1101** (route revision with the original departure choice preserved),
**INC-1106** (GPS gap), **INC-1114** (reinforcement arrives first), **INC-1095**
(medical response), and **INC-1098** (missing clearance).

Seven read-only integration checks passed on both the restored disposable copy
and the seeded main database. They covered API response populations, recent and
preceding date windows, chronology, incomplete/excluded observations, pagination,
CSV agreement, personnel intervals, ETA eligibility, route history, GPS gaps and
all 40 barangays across the three coverage bands. Checksums confirmed preservation
of all pre-existing dispatches, routes, reports, telemetry and heatmap rows, and
all resource/account/configuration tables. A repeated main-database apply changed
neither rows nor sequence values. Python syntax and whitespace checks passed.
These are API/data checks; no interactive browser or physical-phone acceptance
test was performed for this seeding task.

The initial batch's Test classification was subsequently changed to Operational
for this offline demo, after backup
`backend/seed-backups/before-analysis-seed-20261024-211013-567894.dump`.
All 319 seeded incidents now appear in normal operational views; the extra heatmap
population selector was removed, and Operational Times defaults to recorded
milestones. Eight backend integration checks and 26 frontend tests passed with
these defaults, and the frontend build passed. The original source markers and
simulated-data metadata remain available for later cleanup.
