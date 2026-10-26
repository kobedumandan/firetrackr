# Unattended dispatch simulation

The runner and its test cases are local validation tooling, kept outside commits
under the repository's commit-writer policy. The commands below require that
tooling to be present in the master workspace; a fresh clone does not include it.

From the master workspace in PowerShell:

```powershell
& .\firetrackr\backend\venv\Scripts\python.exe .\firetrackr\tools\simulation\run.py
```

The runner starts its own API, Vite server and headless Chrome/Edge. It creates
a new local `firetrackr_sim_*` database, enables PostGIS, applies the real Alembic
migrations, and inserts synthetic accounts, three stations, three trucks and nine
responders on the current shift. No existing account password is needed. The
normal application's `.env` files and database records are left unchanged.

Prerequisites are the existing backend virtual environment, installed frontend
dependencies, Node 24, local PostgreSQL/PostGIS with permission to create/drop
databases, and Chrome or Edge. Connection settings come from `DATABASE_URL`, or
the backend `.env` if the environment does not provide it. Remote database hosts
are refused. Some restricted agent environments require a one-time grant to
control the headless browser.

Each run writes `.simulation-results/<UTC timestamp>/report.md`, `report.json`,
per-scenario results, browser screenshots and stage logs. Exit status is zero only
when all selected stages pass. The API and test servers stop afterward and the
new database is removed, even when checks fail. `--keep-db` preserves that run's
database for diagnosis; it never reuses an existing database. `--skip-unit` runs
only the acceptance simulation. Reports and browser profiles are gitignored.

## Checks

- Real administrator and personnel logins, rejected roles, invalid credentials,
  logout revocation and live WebSocket events.
- Incident intake and automatic assignment using the real Panabo routing graph.
  Saved routes are required; a routing failure cannot silently pass as a success.
- Actual browser login and navigation through Command, Metrics, Analysis,
  Incidents, Personnel, Teams, Stations and Trucks.
- Actual browser confirmation of second- and third-alarm escalation, adding
  distinct teams and preserving each dispatch's routes.
- Resource exhaustion, duplicate/competing dispatch requests and simultaneous
  attempts to reserve the same crew.
- The original mobile client's API functions over real HTTP: acknowledgment,
  departure, truck manning, arrival, clearance, containment, reporting and fleet
  lookup. GPS samples use the real location endpoint and verify retry deduplication.
- Every team's clearance before overall operation completion, release of every
  dispatched crew/truck on report closure, standby cadence afterward, and exclusion
  of synthetic `record_kind=test` evidence from operational analysis.
- Dispatch notification payloads captured locally instead of delivered externally.
- Existing web Vitest suite, production build and mobile policy/API unit tests.

## Coverage limits

This is repeatable acceptance coverage of the dispatch lifecycle plus dashboard
navigation and existing unit tests. It is not proof that every app feature works.
Page navigation checks are smoke checks; they do not establish complete CRUD,
map drawing, model training, export, upload or settings coverage.
External map tile availability and complete map rendering are not asserted by
the navigation smoke checks; a provider error tile can still appear in screenshots.

The mobile API module runs directly in Node. It does **not** launch the React Native
interface or emulate an Android/iOS phone. Native permission dialogs, camera,
screen-off/background tracking, battery restrictions and physical push delivery
remain untested. No Android emulator or connected device was found when this
runner was introduced. Add device automation before treating those capabilities
as accepted.

SMS is disabled and its transport refuses delivery. Expo push is replaced inside
the isolated server process with a local capture function. Authentication,
dispatch, routing, persistence and WebSocket code use the actual application.
This verifies payload generation, not external carrier or Expo reliability.

The simulation compresses operational actions into seconds. Coordinates and GPS
samples are synthetic, and response times must not be interpreted as field
measurements or an ETA accuracy evaluation. The historical
[analysis seeder](analysis-seeder.md) serves a different purpose: populating
analysis examples in the main local database.
