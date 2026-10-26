# FireTrackr — AI agent instructions

## Scope and source of truth

FireTrackr supports BFP Panabo City fire incident intake, dispatch, resource management,
road routing, and response planning. This repository contains a FastAPI backend and
React web dashboard. The React Native/Expo personnel client is a separate project,
not a directory in this checkout.

Read [KNOWLEDGE.md](KNOWLEDGE.md) for implemented behavior and limitations and
[CLAUDE.md](CLAUDE.md) for the command reference. Verify behavior in source before
changing it: [README.md](README.md), module docstrings, and planning documents can
describe intended behavior or older file locations. Do not turn a plan into a claim
of implementation. Keep these documents current when contracts or workflows change.

## Repository map and architecture

| Location | Responsibility |
| --- | --- |
| [backend/main.py](backend/main.py) | FastAPI object, lifespan, CORS, uploads mount, router registration |
| [backend/routers/](backend/routers/) | HTTP/WebSocket endpoints and access checks; routes carry their full paths |
| [backend/services/](backend/services/) | Shared dispatch, routing, coverage, SMS/push, event history, watchdog and token cleanup logic |
| [backend/models.py](backend/models.py), [schemas.py](backend/schemas.py), [serializers.py](backend/serializers.py) | ORM relationships, request/response validation, client JSON contracts |
| [backend/database.py](backend/database.py), [alembic/](backend/alembic/) | SQLAlchemy sessions and ordered database migrations |
| [backend/config.py](backend/config.py), [state.py](backend/state.py) | Environment/tuning settings and mutable process state |
| [backend/ai/](backend/ai/) | Road graph loaders, GNN definitions, ALT search, experimental RL/SUMO components |
| [backend/routing_setup.py](backend/routing_setup.py), [routing_pool.py](backend/routing_pool.py) | Common engine construction and independent routing worker processes |
| [backend/auto_dispatch.py](backend/auto_dispatch.py), [coverage_engine.py](backend/coverage_engine.py) | Team ranking and station reachability math |
| [backend/data/](backend/data/), [ai/models/](backend/ai/models/) | GIS inputs, constraint exports/style/weights, model checkpoints |
| [backend/uploads/](backend/uploads/) | Local report photo bytes; database stores photo metadata |
| [frontend/src/App.jsx](frontend/src/App.jsx), [api.js](frontend/src/api.js) | Dashboard orchestration, session WebSocket, REST client and request caches |
| [frontend/src/pages/](frontend/src/pages/), [components/](frontend/src/components/) | Screens, maps, forms, modals and notifications |
| [frontend/src/hooks/](frontend/src/hooks/), [utils/](frontend/src/utils/) | Browser preferences, sessions, notifications and document exports |
| [frontend/src/styles/](frontend/src/styles/), [index.css](frontend/src/index.css), [data/](frontend/src/data/) | Existing styling, theme tokens, region/map configuration |
| [documentation/](documentation/), [plans-todo/](plans-todo/) | Algorithm notes and implementation plans; check status against source |
| [.agents/skills/](.agents/skills/), [.claude/skills/](.claude/skills/) | Repository-specific agent skills |

The backend uses synchronous SQLAlchemy sessions even where handlers are async.
FastAPI routers delegate reusable behavior to services. Startup builds a main routing
engine and optionally a process pool. PostgreSQL advisory locks elect one watchdog
and one blacklist reaper. WebSocket connections, reporter sessions and derived caches
remain process-local: retain one Uvicorn worker for coherent real-time behavior.

## Actual stack

- Python/FastAPI, Starlette, Uvicorn, Pydantic 2; PostgreSQL/PostGIS through
  SQLAlchemy 2, GeoAlchemy2, psycopg2 and Alembic.
- PyTorch 2.5.1, PyTorch Geometric, NetworkX, GeoPandas, Shapely, NumPy, SciPy,
  pyproj and OSMnx. Panabo roads come from QGIS; OSM is a development-region input.
- React 19, Vite 8, JavaScript ES modules and JSX, plain CSS, Leaflet/react-leaflet
  and leaflet.heat. PDF/Word exports use jsPDF, pdfjs-dist and docx.
- JWT via `jose`, PBKDF2 password hashing, WebSocket events, PhilSMS and Expo push.
  See the dependency gaps in [KNOWLEDGE.md](KNOWLEDGE.md) before claiming a clean setup.
- Supabase is a database-hosting plan; Supabase Auth/Storage/client SDK are not
  implemented here. RL/SUMO code exists but is disabled by default.

## Coding standards

Follow nearby code instead of imposing a new framework or formatting overhaul.

- Python: four-space indentation, `snake_case` modules/functions/variables,
  `PascalCase` classes, uppercase constants, type hints where neighboring code uses
  them, and short responsibility-focused docstrings. Preserve ORM column names such
  as `per_id`, `fire_id` and `truck_platenum`; they are existing contracts.
- JavaScript: functional React components and hooks; `PascalCase` component files,
  `camelCase` helpers, and `use*` hook names. Match local quote/semicolon style
  (it varies). This is JavaScript, not a TypeScript project.
- Reuse existing form helpers, modals, CSS tokens and API wrappers. Avoid duplicating
  serializers or adding direct fetch calls when `api.js` already owns that operation.
- Keep REST paths, payload keys, WebSocket event shapes and mobile-facing status
  strings compatible. Trace both writers and readers before changing a contract.
- Store timestamps with timezone awareness; operational shifts use Asia/Manila.
  GeoJSON/WKT coordinates are longitude then latitude; Leaflet arrays are latitude
  then longitude. Preserve explicit conversions and SRID 4326.
- Read rebound values as `state.routing_engine`/`state.coverage_cache`, not copies
  imported with `from state import ...`. See [state.py](backend/state.py).

## Git workflow and skills

Check `git status`, the current branch, and actual diffs before editing. Preserve
unrelated user changes. This documentation task belongs to `feature/withAIskills`;
do not merge it into or commit it on `main` without a separate instruction. Git
commits belong to branches; uncommitted files can follow a branch checkout.

There is no committed CI configuration or enforceable PR policy in this checkout.
Do not invent one. Use focused branches and reviewable changes; follow the user's
requested destination and commit/push scope.

### Commit writer

Read [.agents/skills/commit-writer/SKILL.md](.agents/skills/commit-writer/SKILL.md)
when committing, drafting commit messages, or splitting changes. Claude's copy is
[.claude/skills/commit-writer/SKILL.md](.claude/skills/commit-writer/SKILL.md).

- Commit only when requested; push only when requested. Stage explicit paths.
- Use `type(scope): imperative lowercase summary`, maximum 72 characters, no
  trailing period. Reuse existing scopes; explain significant behavior, API,
  permissions, dependencies, migrations and configuration in brief body bullets.
- Do not add AI attribution. Do not amend, bypass hooks, or force-push without
  an explicit instruction.
- Keep tests and test tooling unstaged under the current skill policy. Do not
  remove already tracked tooling merely because that policy now exists.
- Never commit secrets, real connection strings, tokens or private credentials.

### Security audit

For a requested security review or release/demo preparation, read
[.agents/skills/security-audit/SKILL.md](.agents/skills/security-audit/SKILL.md)
or Claude's [.claude/skills/security-audit/SKILL.md](.claude/skills/security-audit/SKILL.md).
Supported scopes are full, diff, or a path. Audit source and trace exploitability;
report confirmed findings by severity with locations and fixes. The audit is
read-only by default. Include the separate mobile project only if available.
The skill's mention of Supabase/mobile is scope guidance, not proof that either
deployment or client exists in this repository. Do not install audit tools or
send code/secrets to external services without authorization.

## Component change guidelines

### Backend and API

Add handlers to the appropriate router, shared behavior to services, request
validation to schemas, and shared JSON shapes to serializers. Preserve route
registration and static-versus-parameter path ordering. Use `Depends(get_db)`;
background jobs should open and close their own session, not retain a request
session. Commit database changes before broadcasting their resulting state.
CPU-heavy graph rebuilds should follow the existing background/process-pool path.

### Frontend

Keep App's shared session WebSocket and reconnection lifecycle coherent. Update
API caches and event consumers along with backend mutations. Preferences are
browser-local, not database settings. Verify error, empty, loading and logged-out
states and notification behavior, not just the success screenshot. Preserve
WKT parsing and map coordinate order. Update export serializers together so PDF,
DOCX and CSV agree on the incident register.

### Database

Change ORM models and add a reviewed Alembic migration together; do not edit applied
historical migrations or replace them with `create_all()`. The checked-in chain
is `0001` through `0031`. Revisions `0025`/`0026` preserve the original constraint
and model registry history; `0027`/`0028` add operational timing and response
performance; `0029` adds optional narrow severity and traffic schedules; `0030`
adds nullable baseline override targets and their active uniqueness guard.
Revision `0031` adds attributed duty location logs, dispatch clearance and the
independent operation-completion timestamp; legacy attribution stays unknown.
Review generated diffs, spatial types, indexes, foreign
keys, cascades and circular route/dispatch relationships. Enable PostGIS before
migrating; no migration provisions it. Use a disposable database to validate
schema/data changes. Seeds and `--clear` utilities write/delete data: review inputs
and target database before running them. Do not run them against a live deployment
as a routine check. Advisory locks require session-preserving connections.

### AI, GIS and routing

Panabo is the production dataset. Never silently replace its digitized QGIS roads
with OSM. `REGION` and `VITE_REGION` must agree; New Corella is a local test aid and
shares the database, not a tenant boundary. Reuse `build_routing_engine()` in main
and pool workers. Changes to weights/data need corresponding worker reload and
cache/landmark invalidation reasoning.

Distinguish the shipped precomputed GAT export from generic live GNN classes and
experimental RL/SUMO. Drawn constraints affect exported route costs through the
shared reload path. Snapshot/local training utilities are offline; promotion and
model-management APIs are not implemented.
Preserve directed roads, forbidden turns, nonnegative cost/heuristic assumptions,
obstruction handling, dispatch route ownership and selected-route links. ETA sums
base travel times; it is not the penalized optimization cost. Validate no-path,
off-network, blockage, alternate-route, deviation and station-fallback behavior.
Do not claim model accuracy, live traffic sensing, or field ETA calibration without
measurements and reproducible evidence.

## Security requirements

- Dashboard operations require `require_admin`; authentication alone is insufficient.
  Personnel operations must derive identity from the JWT and verify team/dispatch
  membership and truck authority server-side.
- Never expose password hashes or secrets in serializers, frontend variables,
  logs or docs. All `VITE_*` values are public browser configuration.
- Preserve signature/expiry/revocation checks and PBKDF2 handling. Set a strong
  `JWT_SECRET`; the current `change-me` fallback is unsafe for deployment.
- Treat public reporter pages, uploads, login and WebSocket connections as trust
  boundaries. Existing WS authorization and reporter token lifecycle are incomplete;
  see [KNOWLEDGE.md](KNOWLEDGE.md), rather than assuming they use HTTP auth checks.
- Bind SQL parameters, escape HTML/inline JavaScript, constrain file paths, and
  validate coordinates and uploaded content. MIME/size checks alone do not prove
  image content is safe. Preserve export formula escaping where present.
- Do not enable paid SMS, publish a tunnel, change live infrastructure, rotate
  secrets or run destructive migrations as incidental validation.

## Testing and validation

Use the actual scripts in [frontend/package.json](frontend/package.json):

```powershell
cd frontend
npm run lint
npm run build
# Only when local test cases are available:
npm test
```

Vitest is configured as a package script/dependency, and existing test files under
`frontend/tests/` are tracked. Keep new tests and changes to those tests unstaged
under the commit-writer policy. [.gitignore](.gitignore) excludes `backend/tests/`,
backend development requirements and frontend source `*.test.js` files. There is
no tracked backend test runner setup.
Do not promise that `npm test` or a pytest command passes on a fresh clone.
If local tests exist, inspect their configuration and ensure they target an isolated
database before running them; keep them local per commit-writer policy.

For backend-only edits, a syntax check from `backend/` is available:

```powershell
python -m compileall -q .
```

It does not check imports, migrations, behavior or connectivity. With a configured
disposable PostGIS database and dependencies, verify startup, `/health`, routing
status, affected authenticated endpoints, and relevant dashboard/mobile contracts.
Exercise rejected-role/ownership cases for access changes. Use `alembic current`
and `alembic heads` to inspect schema state; run migrations only on the intended
database. Report exactly what ran and distinguish static review from live checks.

For documentation-only changes, check relative links, endpoint/command names,
Markdown formatting, branch scope and that application files remain unchanged.
The three root documents are not ignored by `.gitignore`; do not add ignore rules
that hide them. Keep real `.env` files and generated artifacts out of commits.
