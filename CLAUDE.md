# FireTrackr — Claude Code guide

## Shared instructions

Follow [AGENTS.md](AGENTS.md) for repository conventions, access boundaries, Git
policy, skills and component-specific change rules. Use [KNOWLEDGE.md](KNOWLEDGE.md)
for verified features, endpoint inventory and limitations. This file is a concise
navigation and execution reference, not a second set of competing instructions.

## Context and navigation

The separate personnel movement simulator lives beside this checkout. Start it
from the master workspace with `& .\firetrackr_personnel_simulator\start.ps1`, then
open `http://localhost:5180` and sign in using mobile personnel credentials. See
the [simulator guide](../firetrackr_personnel_simulator/README.md). It submits real
mobile location/action requests to the configured backend; it needs no native app.

Route selection remains available offline. Switching after departure uses fresh
driver GPS when available; otherwise it selects the saved route. First/returning
manning-driver GPS automatically refreshes planning from driver to incident even
without deviation. Explicit forced planning can use the station while offline.
Route replacements are broadcast to clients. `POST /api/dispatch/{id}/navigation-refresh`
is personnel-only for the assigned manning driver; Response Lab uses it to connect
a revised route to its current position without teleporting. Restart the API and
simulator server after this update. Moving-route integration checks use
`tools/simulation/run.py --skip-unit --acceptance-script tools/simulation/moving_routes.mjs`.

Non-manning personnel have a separate approach via
`POST /api/dispatch/{id}/personnel-navigation`. It uses the authenticated member's
fresh accepted location and preserves the truck's selected routes. Branch state
is attributed per personnel in the existing connector JSON, and the dashboard
draws branch updates from WebSocket events or the location poll. Mobile status
includes the caller's last accepted `location` and optional `personnel_route_wkt`;
Response Lab resumes an active dispatch at its accepted fix when available.

Arrival now separates personnel from vehicle arrival. The existing `/arrived`
action records the caller's `personnel_status`/`personnel_arrived_at`; only a
confirmed manning driver also marks its truck on scene. Other members keep
moving and keep their own tracking cadence until they arrive. Restart the API
and reload Response Lab/native screens to load this behavior. Isolated arrival
checks use `tools/simulation/run.py --skip-unit --acceptance-script tools/simulation/personnel_arrival.mjs`.

Unattended local acceptance run from this repository:

```powershell
& .\backend\venv\Scripts\python.exe tools/simulation/run.py
```

See [unattended simulation](documentation/unattended-simulation.md). This creates
and removes its own local PostGIS database; native phone UI remains outside its
coverage. Reports are saved under the ignored `.simulation-results/` directory.

The React/Vite dashboard coordinates BFP Panabo incident response through FastAPI
and PostgreSQL/PostGIS. A separate personnel mobile app consumes backend APIs.
Routing loads a digitized road graph and precomputed constraints; ALT performs
path search. FastAPI owns authentication; this is not a Supabase Auth application.

Start with [main.py](backend/main.py), [App.jsx](frontend/src/App.jsx),
[api.js](frontend/src/api.js) and the router for the feature being changed.
Contracts live in [schemas.py](backend/schemas.py) and
[serializers.py](backend/serializers.py); persistence lives in
[models.py](backend/models.py) and [migrations](backend/alembic/versions/).
Operational response measurements live in
[operational_times.py](backend/services/operational_times.py), behind the
[administrator API](backend/routers/operational_times.py); its view is
[ResponsePerformanceView.jsx](frontend/src/components/ResponsePerformanceView.jsx),
with incident lifecycle cohorts in `backend/services/response_operations.py` and
shared timing quality rules in `backend/services/timing_metrics.py`. Apply migrations
through `0031` before starting this revision. The Analysis sidebar page groups
Response & Operations, Coverage Planning and Operational Reports under shared tabs;
Metrics contains the overview only. See `frontend/src/pages/AnalysisPage.jsx`;
Response Performance's service is `backend/services/response_performance.py`. Mobile acknowledgement
and departure use `PATCH /api/dispatch/{id}/acknowledge` and `/depart`.
See KNOWLEDGE.md for timestamp semantics,
feature-branch schema reconciliation, GPS eligibility and separate-mobile-client limitations.
Use [routing_setup.py](backend/routing_setup.py) for engine construction,
[services/routing.py](backend/services/routing.py) for reroutes,
[auto_dispatch.py](backend/auto_dispatch.py) for team selection, and
[coverage_engine.py](backend/coverage_engine.py) for planning math.

Read Claude's [commit-writer skill](.claude/skills/commit-writer/SKILL.md) before
commit work and [security-audit skill](.claude/skills/security-audit/SKILL.md) for
requested audits. Keep all three root documents on `feature/withAIskills` for this
documentation change; do not merge to `main` without an instruction.

## Local development commands

Commands below use PowerShell and assume execution from the project root unless
the block changes directory. Run backend commands from `backend/` because existing
imports use that directory as their module root.

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
# Only for GNN_INFERENCE_MODE=local:
# python -m pip install -r requirements-ml.txt
Copy-Item .env.example .env
# Edit .env before starting; include DATABASE_URL and a strong JWT_SECRET.
```

This is the recorded dependency workflow, not a verified complete install.
`jose` is imported but `python-jose` is missing from the manifest. Default exported
inference with `USE_RL=false` skips optional ML/RL imports. Local inference requires
`requirements-ml.txt`; experimental RL additionally needs Gymnasium and
Stable-Baselines3. These modes do not implement the planned Lightning workflow.

Provision a development PostgreSQL database and enable PostGIS before migrations.
The following SQL is run against that intended database, not in PowerShell:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

Then, in `backend/` with the environment configured:

```powershell
alembic current
alembic heads
alembic upgrade head
python run.py
# Alternative development server:
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

`run.py` defaults to `127.0.0.1:8000` and one worker. Keep `WEB_CONCURRENCY=1`
for current real-time behavior. FastAPI supplies `/docs` and `/openapi.json`;
`/health` checks API/database connectivity, while `/api/routing/status` describes
the loaded routing engine. A healthy database does not prove routing is ready.

Seeds are optional and mutate the target database. Inspect the scripts and CLI
arguments first. Unlike the README's bare invocation, admin seeding requires:

```powershell
python seed_admin.py --firstname Dev --lastname Admin --contact 09170000000 --email dev@example.com --password '<replace-with-a-local-password>'
python seed_barangays.py
python seed_personnel.py
python seed_incidents.py
```

Do not use the placeholder password or synthetic personnel/incidents in production.
Avoid typing real credentials into commands that will be recorded in shared logs.

In another terminal, from the project root:

```powershell
cd frontend
npm ci
Copy-Item .env.example .env
# Replace placeholder values, especially VITE_API_BASE_URL.
npm run dev
```

Set `VITE_API_BASE_URL=http://localhost:8000` for a local API. Vite normally serves
at `http://localhost:5173`, the only origin explicitly allowed by current CORS.
Production build/preview commands are `npm run build` and `npm run preview`.
Configuration and default values are catalogued in [KNOWLEDGE.md](KNOWLEDGE.md).

## Database and migration work

The current chain ends at `0030_baseline_constraint_overrides.py`. Original constraint/model
revisions `0025`/`0026` are retained; new `0027` adds operational timing. Do not use
the earlier response-only review database, whose numeric revision IDs represent
different migrations. Add a new migration for
schema changes and review generated output; do not rewrite deployed history.
The earlier feature branch reused IDs `0025`/`0026` for operational timing.
Its files are preserved outside the active graph in
[legacy_versions](backend/alembic/legacy_versions/README.md). Existing databases
on that feature history require reviewed schema reconciliation, not a blind
upgrade or stamp; Alembic rejects the ambiguous legacy state before migrating.
From `backend/`, the standard Alembic generation command is:

```powershell
alembic revision --autogenerate -m "describe the schema change"
```

Keep models, migration and affected API/client contracts aligned. Check PostGIS
SRID/types and both route/dispatch foreign-key paths. Use a disposable database for
upgrade/downgrade testing. The connection URL comes from `.env` through
[alembic/env.py](backend/alembic/env.py), not a committed credential in `alembic.ini`.
Supabase migration remains a [plan](plans-todo/supabase-migration.md); proposed pool
environment variables are not implemented. Advisory locks need session affinity.

## Validation and security reminders

Use `npm run lint` and `npm run build` for frontend edits and targeted backend
checks described in [AGENTS.md](AGENTS.md). `npm test` invokes Vitest, but test cases
are intentionally untracked; there is no reproducible committed backend suite.
Never run local DB-writing tests before confirming their database target.

Reuse Python snake_case and React component/hook conventions, preserve existing
JSON keys/status values, and use timezone-aware timestamps and explicit map
coordinate conversions. Keep authentication and ownership checks server-side.
Do not expose secrets in `VITE_*`, loosen dashboard admin checks, or treat the
WebSocket's current token validation as equivalent to HTTP revocation/role checks.
Report validation limits instead of claiming unrun checks passed.

Offline constraint retraining uses an isolated `.venv-training`, not the web
backend's environment. See [training/README.md](training/README.md) for pinned
dependencies, champion reconstruction, Parquet label snapshots, local GAT training
and audit commands. Admin registry APIs initialize verified v1, submit local
retrains, list versions, return status/reports and reject candidates. Migration
`0026` adds durable history and unique training/champion guards. Immediate
promotion/rollback and the admin Settings Model tab are implemented; Lightning
and scheduling remain pending. The tab includes live job state, audit/uncertainty,
map preview, rejection, confirmations, rollback and version history.
Modal is an optional online runner with the same registry/review/promotion gates.
Install `backend/requirements-modal.txt` in the backend environment, authenticate
with `python -m modal setup`, then run
`python -m modal deploy -m training.modal_app --env main` from the repository root.
Set `RETRAIN_RUNNER=modal` in the backend environment and restart. Defaults are
the `firetrackr-training` app, `firetrackr-training-jobs` volume and `main` Modal
environment. T4 training uses a pinned image and has a one-hour limit; no schedule
or training starts at boot/deploy. See [training setup](training/README.md#modal-online-training)
for profile access, optional CPU deployment, job recovery and verification limits.
The CPU port matches original notebook CPU weights exactly. User-reported T4
CUDA schema-2 confirmation passes: historical F1 and class/map decisions match
exactly, and numerical differences are within absolute 1e-6. This is user-provided
Colab evidence with matching local source hashes; see
`backend/data/retraining/cuda_parity_confirmation_v2/`. Explicit admin promotion
uses `POST /api/models/{version}/promote` with `expected_champion`; it verifies
artifacts and warms the main/pool engines before changing registry history.
Archived versions use the same endpoint for rollback. Other workers poll champion
changes every 10 seconds. Startup resolves the registered champion; an absent or
empty registry falls back to the original configured export.
Snapshot writes require `pyarrow` from the updated backend requirements. Migrations
`0025` and `0026` were applied to the configured local database on 2026-10-19. See the training README for endpoint
order and runner configuration; use an intended test DB for deployment checks.

Constraints view: use GAT constraints ? Edit constraints to enter the left-side
layer editor. Incident View and map actions hide until Done. Main sidebar links and
the section divider remain visible; page navigation exits constraint editing.
The list supports search, barangay/source filters, geographic/name sorting, focus
and local visibility. Choose Narrow road or Traffic, then click QGIS road edges
between connected junctions (zoom 16+). Narrow edges use neon orange and traffic
edges use neon yellow. Click a selected edge again to deselect it.
Confirm and save the current type before choosing another type, or cancel the
selection. Recently saved edges sorts newest first; clicking a row reveals and
focuses its location. Freehand drawing is removed from the editor. Baseline/model
layers can be edited through saved overrides; saved constraints can be edited or removed. Failed saves retain
the selection. The admin APIs are GET `/api/constraints/road-edges` and POST
`/api/constraints/edge-selection`; the server validates IDs and saves each batch
atomically using canonical road geometry, with retry deduplication.

The save dialog chooses Slight/Severe for new narrow annotations. Traffic saves
use the existing name field as an optional label, plus Every day/selected weekdays
and All day/up to eight non-overlapping time ranges. Overnight windows belong to
their starting weekday. Exact windows are evaluated in Asia/Manila, start included
and end excluded, on new route requests. Outside the schedule the admin traffic
penalty is absent; the edge stays visible in the editor. Different constraints on
the same saved edge return 409; select the existing annotation and choose Edit
constraint to update it. The edit dialog prefills its name, type, severity and
schedule and calls PATCH `/api/constraints/{id}`. It retains the saved edge's ID
and geometry, keeps the row selected after save, and preserves form values on
failure. The popup Edit Constraint action opens this form for saved annotations.
Baseline/model popup actions open an editable form as well. POST
`/api/constraints/baseline-override` saves canonical model-segment corrections;
0030 adds a nullable target ID and the unique active-override guard. The form also
supports construction, No constraint and preserved traffic subtypes. Restore
original removes the saved edit and reveals the current model layer. Training
replaces old flags for changed baseline conditions; name/timing edits preserve
the original labels. Original model files stay immutable.
Revision 0029 adds nullable `narrow_severity` and `traffic_schedule`. Legacy NULL
values retain prior behavior. On the configured legacy database, the fields were
applied additively with a backup and original-value verification; the legacy
Alembic stamp remains unchanged. Do not blindly stamp/upgrade that database.
