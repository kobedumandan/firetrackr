# FireTrackr 🔥🧑‍🚒

A fire-response dispatch and incident-management system built for the Bureau of Fire
Protection (BFP). FireTrackr gives dispatchers a real-time web command center and gives
field personnel a companion mobile app, tied together by a FastAPI backend that plans
optimal fire-truck routes using a Graph Neural Network (GNN) trained on local road data.

> This repository holds the **web dashboard** and **backend**. The personnel mobile app
> (React Native / Expo) lives in a separate `bfp_capstone_mobile/` project.

---

## What it does

- **Incident intake & mapping** — Log fire incidents, view them on a live Leaflet map
  with heatmaps, station coverage isochrones, and predicted road constraints.
- **AI routing** — A GNN-based routing engine plans fastest truck routes over the Panabo
  road network, accounting for narrow roads and traffic-crowded areas predicted by the model.
- **Dispatch & teams** — Auto-dispatch selects the best available response team/truck,
  then tracks the crew live as they head to the scene.
- **Live tracking & deviations** — Personnel positions stream in over WebSocket; the
  backend detects when a manned truck deviates from its route and computes a reconnecting
  path automatically.
- **Reporter location via SMS** — Sends a citizen reporter a one-tap link (PhilSMS) to
  share their exact location while filing a report.
- **Metrics & coverage** — Dashboards for response coverage per barangay and operational
  metrics.

---

## Tech stack

| Layer      | Stack                                                                      |
|------------|----------------------------------------------------------------------------|
| Backend    | Python, FastAPI, Uvicorn, SQLAlchemy + Alembic, GeoAlchemy2                 |
| Database   | PostgreSQL with the **PostGIS** extension                                   |
| AI/Routing | PyTorch + PyTorch Geometric (GNN), NetworkX, GeoPandas, Shapely            |
| Frontend   | React 19, Vite, Leaflet / react-leaflet, leaflet.heat                       |
| Messaging  | PhilSMS (reporter location links), WebSocket (real-time dashboard updates)  |

---

## Repository layout

```
bfp_capstone/
├── backend/                 # FastAPI application
│   ├── main.py              # App entry point (routes, WebSocket, lifespan)
│   ├── run.py               # Production Uvicorn launcher (WEB_CONCURRENCY workers)
│   ├── models.py            # SQLAlchemy ORM models
│   ├── database.py          # Engine / session / connection pool
│   ├── ai/                  # GNN routing engine, graph builder, RL/SUMO experiments
│   ├── coverage_engine.py   # Station reachability / barangay coverage
│   ├── auto_dispatch.py     # Best-team selection
│   ├── routing_pool.py      # Process-pool offload for CPU-bound route builds
│   ├── sms.py               # PhilSMS integration
│   ├── alembic/             # Database migrations
│   ├── seed_*.py            # Seed scripts (admin, barangays, personnel, incidents)
│   ├── data/                # Road-network & candidate geopackages (.gpkg)
│   └── requirements.txt
├── frontend/                # React + Vite web dashboard
│   ├── src/
│   │   ├── components/      # Pages + modals (Incidents, Teams, Trucks, Metrics, …)
│   │   ├── api.js           # API client
│   │   └── main.jsx
│   └── package.json
├── gnn-files-to-be-checked/ # Raw GNN input geopackages under review
└── gps-sms-test/            # Standalone GPS/SMS test harness (json-server)
```

---

## Prerequisites

- **Python 3.11 or 3.12** for the pinned Windows PyTorch packages. Python 3.13
  can remain installed; create this project's virtual environment with `py -3.11`.
- **Node.js 20.19+ or 22.12+** (required by Vite 8; Node 18 is too old)
- **PostgreSQL 14+** with the **PostGIS** extension enabled
- (Optional) An **ngrok** / dev-tunnel URL if you need the mobile app or SMS reporter
  links to reach your local backend
- (Optional) A **PhilSMS** API token to actually send SMS

---

## Running the backend

```powershell
cd backend

# 1. Create and activate a virtual environment
py -3.11 -m venv venv
.\venv\Scripts\Activate.ps1      # Windows PowerShell
# If activation is blocked: Set-ExecutionPolicy -Scope Process Bypass
# source venv/bin/activate       # macOS/Linux

# 2. Install backend dependencies (default exported predictions mode)
pip install -r requirements.txt
# Optional local node-GNN inference only:
# pip install -r requirements-ml.txt

# 3. Configure environment
Copy-Item .env.example .env      # first setup only; edit DATABASE_URL and JWT_SECRET

# 4. Create the database + PostGIS, then run migrations
#    (in psql:  CREATE DATABASE bfp_capstone;  \c bfp_capstone  CREATE EXTENSION postgis;)
alembic upgrade head

# 5. Seed baseline data (optional but recommended for a fresh DB)
python seed_admin.py --firstname Local --lastname Admin --contact 09171234567 --email admin@example.com --password "REPLACE_WITH_YOUR_LOCAL_PASSWORD"
python seed_barangays.py
# Optional sample data:
# python seed_incidents.py
# Personnel seeding needs arguments; see: python seed_personnel.py --help

# 6. Run the API
python run.py                    # http://127.0.0.1:8000  (interactive docs at /docs)
```

`GNN_INFERENCE_MODE=exported` is the default in `backend/.env.example`. The backend
uses precomputed constraint GeoJSON, then exported edge weights; if neither is
available it warns and uses base travel times. It does not import PyTorch/PyG
or run a local model with `USE_RL=false`. Restart the backend after changing modes.

For the generic local node GNN, install `backend/requirements-ml.txt` and set
`GNN_INFERENCE_MODE=local`. This mode skips exported constraint costs and uses
`GNN_TYPE` / `TORCH_DEVICE`. It is separate from the notebook's SegmentGAT;
it does not train a model or call Lightning. The Lightning retraining workflow
remains planned. Experimental `USE_RL=true` additionally needs Gymnasium and
Stable-Baselines3 installed separately.

To run with multiple workers for CPU-bound route rebuilds:

```powershell
$env:WEB_CONCURRENCY = "4"
python run.py
```

> ⚠️ Multi-worker mode does **not** share WebSocket connections or in-memory reporter
> sessions across processes yet — see the note at the top of `run.py` before enabling it
> in production.

### Backend environment variables

| Variable            | Purpose                                                        |
|---------------------|----------------------------------------------------------------|
| `DATABASE_URL`      | PostgreSQL/PostGIS connection string                           |
| `JWT_SECRET`        | Secret used to sign auth tokens (**change from the default**)  |
| `PUBLIC_BASE_URL`   | Public tunnel URL used to build reporter location links        |
| `PHILSMS_API_TOKEN` | PhilSMS token for sending reporter SMS                          |
| `PHILSMS_SENDER_ID` | Registered PhilSMS sender name                                 |
| `SEND_SMS`          | `true` to actually send SMS (defaults to `false` / dry run)    |
| `WEB_CONCURRENCY`   | Uvicorn worker count (default `1`)                             |
| `ROUTING_POOL_SIZE` | Worker processes for offloaded route computation (default `2`) |
| `REGION`            | GIS/routing dataset — always `panabo` in production; `new_corella` is a local dev aid |

See `backend/.env.example` for the full list.

### Creating the local database with pgAdmin 4

pgAdmin manages PostgreSQL; the application connects directly to PostgreSQL on
port 5432. Install the PostGIS bundle matching your PostgreSQL version (for
example through Stack Builder). In pgAdmin, right-click **Databases > Create >
Database**, create `bfp_capstone` owned by your local PostgreSQL user, then open
that database's Query Tool and run:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
SELECT PostGIS_Version();
```

Set `DATABASE_URL` in `backend/.env` to that database, using your local username
and password. URL-encode special characters in the password. With the virtual
environment active, run from `backend/`:

```powershell
python -m alembic upgrade head
python -m alembic current
```

The current migration head in this checkout is `0023`. Refresh **Schemas > public
> Tables** in pgAdmin to see the resulting tables. Migrations create/update the
schema; seed scripts insert initial data. They do not copy your groupmate's data.
For a database that already has data, take a backup before applying migrations;
do not use `alembic stamp head` to bypass a migration error.

After starting the API, `http://127.0.0.1:8000/health` should report both the API
and database as `ok`.

---

## Switching regions (development only)

> **Production is always Panabo City.** FireTrackr was built for and proposed to
> BFP Panabo City, and that is the only region it is ever deployed with. The
> region switch below exists purely so a developer can test the app — dispatch,
> routing, live tracking — without having to physically be in Panabo. It is a
> development convenience, not a multi-tenant or multi-city feature, and
> `REGION` should never be changed on a production deployment.

Panabo's road network is a **hand-digitised QGIS export** paired with the GAT
constraint predictions and hand-tuned routing multipliers. It is the real
dataset, it is never sourced from OSM, and nothing in the region switch touches
it.

New Corella is a throwaway stand-in pulled straight from OpenStreetMap, added
only so the developer isn't tied to one location while working:

```
GIS / Routing data
├── panabo       QGIS road network + GAT constraints   ← production (the real system)
└── new_corella  OSM road network, no constraints      ← developer testing only
```

In your **local** `.env` files, set **both** variables and restart. They must
name the same place, or the map shows one municipality while the router plans
over another. Leave both at `panabo` (or unset) everywhere else — that is the
shipped default, so a deployment that never sets `REGION` is always correct.

```bash
# backend/.env
REGION=new_corella
# frontend/.env
VITE_REGION=new_corella
```

`GET /api/routing/status` reports the live `region`, `road_source` and
`has_constraints` so you can confirm which dataset is loaded.

New Corella's data is already committed. To rebuild or add another OSM region
(declare it in `REGIONS` in `backend/ai/config.py` first):

```bash
cd backend
python fetch_osm_roads.py --region new_corella          # roads + boundary + barangays
python seed_barangays.py --clear                        # honours REGION
```

The script refuses any region whose `road_source` is not `osm`, so it cannot
overwrite Panabo's QGIS network.

**A dev region is deliberately a reduced environment.** It gets no GAT
constraint layer (the map's GNN-constraints panel 404s) and no routing
multipliers, so ALT plans on raw travel time; New Corella additionally has no
barangay polygons, because OSM has none mapped at `admin_level=10` there.
Incident logging still works — the by-barangay metrics and coverage-gap tables
just come back empty. You also need at least one **station with coordinates
inside the region**, or dispatch has no origin and `/api/coverage/*` returns
404. The database is shared across regions, so Panabo's stations and incidents
remain visible (far off-screen).

None of this is worth "fixing": the point is to exercise app behaviour away
from Panabo, not to stand up a second production system. Anything that depends
on the trained constraint model has to be validated against Panabo.

---

## Running the frontend

```bash
cd frontend
npm ci
copy .env.example .env

# Point the client at your backend
#   edit frontend/.env → VITE_API_BASE_URL=http://127.0.0.1:8000  (or your tunnel URL)

npm run dev        # start Vite dev server (default http://localhost:5173)
npm run build      # production build into dist/
npm run preview    # preview the production build
npm run lint       # ESLint
```

Log in with the admin account created by `seed_admin.py`.

Use `http://localhost:5173` for development; this is the origin allowed by the
backend's current CORS configuration. Vite preview normally uses port 4173, so
to test the built frontend with the API, stop the dev server first and run
`npm run preview -- --port 5173 --strictPort`. The backend must remain running.
Frontend environment variables are embedded at build time; rebuild after changing
them. The frontend build is written to `frontend/dist/`; the Python backend runs
directly and does not have a separate build step.

### Command map styles

Use **Map style** at the top left of the Command map to choose **Light**,
**Dark** (CARTO street tiles), or **Satellite** (Esri World Imagery).
Only the background tiles change: the Leaflet map stays mounted, preserving
its location, zoom, incident markers, crews, routes, overlays, and drawing tools.
The existing overlay controls still work independently of the map style.
Provider credits appear at the bottom left of the map.

Your choice is saved in this browser and survives reloads. Until you choose a
style, the map follows the application's light/dark theme. If browser storage
is blocked, switching still works for the current map session.

Satellite is **2D imagery**, not photorealistic 3D buildings, and has no tilt or
rotation. The separate Google 3D viewer has been removed. These styles do not
use `VITE_GOOGLE_MAPS_API_KEY`; an existing value in your local `.env` can remain
but is unused. Do not put a Google key in the CARTO setting. Other maps, such
as metrics and planning, retain their existing behavior.

## Working with a groupmate using branches

A branch keeps your commits separate from `main`. A commit is a local snapshot;
pushing uploads those commits to GitHub. A pull request asks your groupmate to
review and merge your branch into `main`.

For this setup work, use `chore/windows-local-setup`. For subsequent tasks, start
a new branch from an up-to-date `main`:

```powershell
git switch main
git pull --ff-only origin main
git switch -c feature/short-description
# Make changes, run the appropriate checks, and inspect the diff.
git diff
git add path/to/changed-file
git commit -m "Describe the change"
git push -u origin feature/short-description
```

On GitHub, select **Compare & pull request**, use `main` as the base and your
feature branch as the compare branch, then request your groupmate's review.
If you cannot push to the group repository, ask its owner for collaborator
access or push to your own fork and open a pull request from there.

Your groupmate can test a pushed setup branch before merging:

```powershell
git fetch origin
git switch --track origin/chore/windows-local-setup
```

After merging, both developers switch to `main` and run `git pull --ff-only`.
Each developer maintains their own `.env`, installed dependencies, and local
database. Commit migration scripts when changing the schema; other developers
then run `python -m alembic upgrade head`. Never commit local passwords, `.env`,
virtual environments, `node_modules`, or database backups.
