# Resource archiving and historical retention

Implemented 2026-11-09. Hosted Supabase was upgraded from revision `0035` to
`0037` on 2026-11-09. All seven affected table row counts remained unchanged.
The local application database setting was preserved.

## Resources and access

Teams, trucks, personnel, stations and incidents have nullable `archived_at` and
`archived_by` columns. Existing DELETE routes now archive, remain administrator-only,
and return 204. Repeating an archive request is safe. No child records are deleted.
Operational lists and assignment writers reject archived resources. Historical
analysis continues to load relationships regardless of archive status.

**Settings → Data → Archive** opens an inline pane with tabs for teams, trucks,
personnel, stations, incidents and obstructions. Each tab loads its archived records
and provides search and restoration where applicable. The Data group appears below
Preferences. Resource pages keep the action to archive a selected record; archive
browsing is centralized in Settings. **Settings → Account → Account Access** lists
personnel accounts; administrator accounts are excluded by the API and the UI.
These controls are administrator-only.

- Archiving a team preserves membership rows and leaves its people and truck active.
- Archiving personnel disables their login, keeps their reports/devices/tracks,
  and excludes them from new deployment snapshots, roster synchronization and alerts.
- Archived or disabled personnel cannot collect duty GPS through authenticated APIs.
- Archive actions reject active responses and unfinished return/readiness work.
- A station must have its active personnel, teams, trucks and sub-stations reassigned
  or archived first. Archived stations do not contribute to coverage planning.
- Restoration requires an active home/parent station. Personnel restoration is
  blocked while their former team is responding, and keeps their login disabled.
- Enabling an account is a separate administrative action. Administrators cannot
  disable themselves or any other administrator account; this is enforced by the
  backend and disabled UI controls. Disabling a personnel account requires a
  confirmation modal. Responders must finish responses and return/readiness first.
- Disabled accounts fail both login endpoints and authenticated HTTP requests.
  Existing WebSockets recheck access on messages and at least every 15 seconds.
- `sessions_revoked_at` prevents old tokens becoming valid after an account is enabled.

## Incidents and obstructions

Incidents must be closed, cancelled/recalled, or have recorded operation completion
before archiving. Active dispatches and unfinished truck returns still block it.
Archiving hides the incident from the ordinary register and active map without
changing its status, response timings, classification, reports, photos, heatmap
evidence or historical analytics. Bookmarked incidents and analysis remain readable.
General edits and new dispatches require restoration. Archive/restore operations
append incident audit events.

Archiving is a visibility operation, not an analytics exclusion. Existing
`record_kind` values (`operational`, `drill`, `test`, `unknown`) and cancelled status
retain their existing analytics semantics. Archiving alone never declares a valid
incident invalid or changes its statistical cohort.

Obstruction DELETE now marks the row inactive with `resolved_at`, `resolved_by` and
`resolution_note`; the description and creation data remain. Existing removal
WebSocket messages keep clients compatible. The **Obstructions** archive tab in Settings
shows expired and resolved/inactive records; active obstructions stay on the map.
The history API still returns all obstruction records. Active obstruction lists omit expired
rows, matching the routing engine. No expired-row sweep or GPS-log purge was added.

## API additions

| Endpoint | Purpose |
| --- | --- |
| `GET /api/archive/{kind}` | Archived teams/trucks/personnel/stations/incidents, or all obstruction history |
| `POST /api/archive/{kind}/{id}/restore` | Restore a resource or incident; obstruction history is read-only |
| `GET /api/accounts` | Account identity and enabled/disabled state; no credentials |
| `PATCH /api/accounts/{user_id}/access` | `{ "enabled": true/false }` |

All additions require an administrator. Resource mutations invalidate shared browser
resource caches and refresh dashboard resource snapshots.

## Migration and local validation

The existing checkout already has revisions `0034` (response workflow) and `0035`
(model display names). New revision `0036` adds resource/account lifecycle fields;
`0037` adds incident archive and obstruction resolution fields. Both upgrades are
additive and were exercised from an empty disposable PostGIS database. Downgrades
refuse to discard lifecycle data.

Before running this source against an application database, apply the migrations
to that intended database from `backend/`, then restart the API:

```powershell
.\venv\Scripts\python.exe -m alembic upgrade head
```

Local tests use a separate loopback cluster under the workspace's
`artifacts/archive-test-cluster`, port 55439, database `firetrackr_archive_tests`.
The local runner supplies its own database URL, applies migrations there and
disables real SMS/storage. It never selects the application's configured database.

```powershell
# From the repository root; runner and backend tests remain local test tooling.
.\backend\venv\Scripts\python.exe ..\artifacts\archive_local_checks.py tests/test_resource_archiving.py tests/test_retention_lifecycle.py tests/test_team_delete.py tests/test_incident_delete.py tests/test_response_workflow.py tests/test_team_release_guards.py tests/test_return_arrival_readiness.py tests/test_list_query_performance.py tests/test_dispatch_availability.py tests/test_push.py tests/test_push_endpoints.py -q
cd frontend
npm test -- tests/ResourceArchive.test.jsx tests/ResourcePageFilters.test.jsx tests/ResourceExports.test.jsx tests/PersonnelAvailability.test.jsx tests/EditTeamModal.test.jsx tests/IncidentControl.test.jsx tests/IncidentDetailsReport.test.jsx tests/IncidentWorkflow.test.jsx tests/analysisRefresh.test.jsx tests/notificationNavigation.test.jsx
npm run build
```

The repository-wide lint command has existing failures outside this change. New
archive UI and its tests pass focused ESLint checks. Live deployment, native-phone
interaction and visual browser review were not part of this validation.

Final verification: 181 backend tests passed (the command above plus
`tests/test_inactive_station.py`), 200 frontend tests passed, and the production
dashboard build passed. An old inactive-station fixture was corrected to actually
assign its truck, matching the current dispatch eligibility rules. The local test
cluster was stopped after verification.

The subsequent Settings archive move passed 50 focused frontend tests, including
settings permissions, category switching, stale-request handling, restoration and
resource-page regressions. The dashboard build and focused archive ESLint checks
also passed. This UI move requires no additional database migration.

Account Access rows use muted initials avatars, a Personnel badge above the name
(the incident closed pill's `--chip-muted-bg` and `--text-secondary` colors),
and a separate email/status line with a dimmed separator. The search uses
the incident search layout and icon. Counts, edit buttons, sidebar item and section
titles use title case. These refinements passed 14 focused frontend tests and 31
backend lifecycle checks on disposable PostGIS, plus focused lint and a dashboard
build. No additional database migration is required.

Account Access displays 10 accounts per page, using the incident table's shared
pagination styles, numbered pages, previous/next controls and record range. Search
filters all loaded accounts and resets to the first page. Administrator accounts
remain excluded before filtering and pagination.
