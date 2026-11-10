# BFP Panabo operational history

The supplied `fire_incidents_2023_2024_cleaned_geocoded_review.csv` replaces the
provenance-marked Analysis demonstration batch. It contains 78 real historical
incidents: 32 from 2023 and 46 from 2024. The import uses `record_kind=operational`.

Coordinates and `barangay_clean` are retained exactly from the CSV, including
records whose coordinates do not fall inside their named barangay. Barangay IDs
match names only; coordinates never reassign a barangay. The one `Not identified`
record retains that label and a null barangay ID. All 78 receive heatmap rows.
Geocoding quality flags remain in the import audit metadata; map locations are
source estimates, not verified fire-site measurements.
The frontend retains `source_csv` points across differences in its municipal
display outline, so one boundary-edge point is displayed at its unchanged CSV
coordinates. Date and numeric-value filters continue to apply.

Incident times, official alarm levels, severity, casualties, damage and responding
units are not supplied. No values, operational milestones, assignments, routes,
reports or telemetry are fabricated. At the user's clarification, the CSV's
`synthetic_alarm_level` column supplies the team's annotated alarm levels:
58 first alarm and 20 second alarm. These are stored in the alarm field with
`alarm_basis=user_annotation`; their supplied basis/confidence are retained in
`alarm_annotation`. They do not establish official station alarm observations.
Cause/category values and original source
record IDs remain in `bfp_import` events with source `bfp_operational_csv`.

The database's incident datetime stores the supplied calendar date at midnight
Asia/Manila solely as a date container, with `occurrence_precision=date_only`.
This is not a recorded incident or report-receipt time. The incident API emits a
date-only string for these rows, and the register, details, heatmap and exports
show that the time is not recorded. Missing severity/casualty values display
as Not recorded, and unknown responding units remain null. The existing heatmap
uses its unknown-severity rendering weight of 0.5; this does not assign severity.

`backend/import_bfp_operational.py` provides read-only preview and validation.
`backend/import_bfp_history.py` delegates to it; the former demonstration-timing
generator and representative-pin substitution are no longer used by imports.
Apply requires a reviewed plan and a database backup. It checks synthetic event
provenance, terminal status, later edits, photos, unique source records and exact
barangay matches before replacement. It rejects duplicate imported records.
All deletions and insertions run in one transaction with preservation checks.

## Applied on November 10, 2026

The configured local `bfp_capstone` database was backed up, restored into a
disposable database, and the replacement was rehearsed there before application.
The exact reviewed plan removed 319 synthetic incidents with their related
simulation data, imported 78 BFP incidents and preserved 22 separately entered
incidents. Checksums verified preservation of unrelated records and resource,
account, configuration and boundary tables. No schema migration was required.

The parent workspace's `local-backups/bfp-operational-import-20261110/` contains
the full database dump, its verified listing, the untouched source CSV, the
reviewed ID plan and the rehearsal/application results. The backup includes
private account data and should remain local.

Database and API checks verified all 78 exact coordinates, source barangays,
unknown operational measurements, date-only serialization and heatmap points.
Barangay statistics assign 77 incidents by source name and keep one unresolved.
The running local API also returned all 78 imported incidents and heatmap points.
Use All time or a 2023–2024 date range to view this history.

The frontend build and 64 focused presentation, export and heatmap tests passed.
The full lint command still reports existing repository errors. Three additional
navigation tests fail because their expected deletion wording predates the
existing archive workflow; that behavior was not changed by this import.

The same-day alarm annotation update was backed up separately, rehearsed on a
restored copy and checked against every source row before application. Coordinates,
barangays and all other incident fields remained unchanged. Its backup and result
are `before-user-annotated-alarms.dump` and `annotated-alarm-result.json` alongside
the original import artifacts. The incident details and heatmap identify these
alarms as annotated.
