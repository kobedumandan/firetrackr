# FireTrackr — Claude Code guide

## Shared instructions

Follow [AGENTS.md](AGENTS.md) for repository conventions, access boundaries, Git
policy, skills and component-specific change rules. Use [KNOWLEDGE.md](KNOWLEDGE.md)
for verified features, endpoint inventory and limitations. This file is a concise
navigation and execution reference, not a second set of competing instructions.

## Context and navigation

The React/Vite dashboard coordinates BFP Panabo incident response through FastAPI
and PostgreSQL/PostGIS. A separate personnel mobile app consumes backend APIs.
Routing loads a digitized road graph and precomputed constraints; ALT performs
path search. FastAPI owns authentication; this is not a Supabase Auth application.

Start with [main.py](backend/main.py), [App.jsx](frontend/src/App.jsx),
[api.js](frontend/src/api.js) and the router for the feature being changed.
Contracts live in [schemas.py](backend/schemas.py) and
[serializers.py](backend/serializers.py); persistence lives in
[models.py](backend/models.py) and [migrations](backend/alembic/versions/).
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

The current chain ends at `0023_add_incident_events.py`. Add a new migration for
schema changes and review generated output; do not rewrite deployed history.
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
