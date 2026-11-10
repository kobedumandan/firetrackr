# Resource transfers and historical evidence

Use the existing Teams page: remove a member, save, then add them to the destination
team and save. The two actions commit independently. A failed addition leaves the
person unassigned; it does not undo a successful removal. Team shift compatibility
is checked on addition. Changing a person's shift to one incompatible with an
existing team requires removal first.

Personnel, team and truck home stations remain separate fields. Moving a team does
not silently transfer its crew or truck home stations. Make those changes explicitly
when needed. Future dispatches use the new team station and assigned resources.

Historical dispatch displays, response-performance observations, vehicle evidence,
GPS identity labels, report authors and return destinations use stored snapshots.
Completed dispatch membership does not change when personnel move. A completed
truck return displays its recorded readiness outcome even if that truck is later
dispatched again. Report content and timings are not changed by resource edits;
explicit incident/report corrections remain available through their existing flows.

Removal and personnel home-station/shift reassignment reject active assignments
and unfinished driver return/readiness responsibility. Existing team/truck station
restrictions remain in effect. Relocating a station is rejected while an associated
response or return/readiness is unfinished. Ordinary identity edits are independent
of assignment edits; saved historical names/ranks do not follow future renames.

## Upgrade

Stop application writes and back up the intended database before upgrading.
From `backend`, with the intended database explicitly selected, run:

```powershell
& .\venv\Scripts\python.exe -m alembic upgrade head
```

Revision `0038` adds nullable `incident_reports.author_snapshot` (JSONB) and fills
missing dispatch display fields in the existing `context_snapshot` JSONB. Deploy
the migration before starting the updated backend; the report ORM reads this new
column. Restart the API and reload the dashboard after upgrading.

Existing snapshot values, including nulls and empty rosters, are retained. Missing
fields are frozen from currently available metadata and marked
`metadata_provenance=migration_current_metadata`; dispatches with no snapshot use
`provenance=legacy_frozen_metadata`. These values preserve the upgrade baseline,
not proof of an original assignment. No legacy `roster` is invented. Display-only
legacy members and identities associated with recorded GPS samples do not count
as verified deployments. Evidence already overwritten before upgrade cannot be
recovered by this migration. Dispatches without a team or saved context remain
unknown rather than inheriting future resource metadata.

## Validation

Run backend integration tests only against a disposable loopback PostGIS instance:

```powershell
& .\venv\Scripts\python.exe tests/run_admin_report_checks.py tests/test_assignment_history.py tests/test_dispatch_availability.py tests/test_response_workflow.py tests/test_return_arrival_readiness.py tests/test_resource_archiving.py
```

The history regressions exercise populated migration, JSON null legacy snapshots,
new dispatch capture, report author capture, remove/add transfers, resource renames,
station relocation and blocked active/returning/not-ready assignments. They compare
dispatch output, analysis, vehicle evidence and reports before and after transfers.
The runner migrates a temporary database and stops it afterward; it does not
connect to the configured hosted database.

Validation on 2026-11-10: 152 backend integration tests passed across assignment
history, dispatch availability, response workflow, return arrival/readiness,
resource archiving, team truck locks, team release guards and field report arrival.
The populated-upgrade regression exercised revision 0038 against existing rows.
43 dashboard tests passed across dispatch details, team editing, operational
reports, after-action reports and responder route history. The frontend production
build and ESLint for the changed UI files passed. No configured hosted database
was migrated during validation.

Additional checks exposed existing suite/tooling mismatches outside this change:
seven `test_admin_incident_reports.py` cases still expect retired report-driven
closure or legacy report-edit behavior; `test_dispatch_recall.py` imports the removed
`dispatcher_mark_arrived` endpoint; one `ResponseAnalysisPage.test.jsx` assertion
expects lowercase `preceding window` while the component uses `Preceding Window`.
Repository-wide ESLint reports 21 errors and two warnings in other files, including
App, station effects and generated/test fixtures. These were not changed as part
of the transfer protection work. The complete repository suite is not passing.
