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

- **Python 3.11+** and **Node.js 18+**
- **PostgreSQL 14+** with the **PostGIS** extension enabled
- (Optional) An **ngrok** / dev-tunnel URL if you need the mobile app or SMS reporter
  links to reach your local backend
- (Optional) A **PhilSMS** API token to actually send SMS

---

## Running the backend

```bash
cd backend

# 1. Create and activate a virtual environment
python -m venv venv
venv\Scripts\activate            # Windows (PowerShell/CMD)
# source venv/bin/activate       # macOS/Linux

# 2. Install backend dependencies (default exported predictions mode)
pip install -r requirements.txt
# Optional local node-GNN inference only:
# pip install -r requirements-ml.txt

# 3. Configure environment
copy .env.example .env           # then edit values (DATABASE_URL, tokens, PUBLIC_BASE_URL)

# 4. Create the database + PostGIS, then run migrations
#    (in psql:  CREATE DATABASE bfp_capstone;  \c bfp_capstone  CREATE EXTENSION postgis;)
alembic upgrade head

# 5. Seed baseline data (optional but recommended for a fresh DB)
python seed_admin.py
python seed_barangays.py
python seed_personnel.py
python seed_incidents.py

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

```bash
WEB_CONCURRENCY=4 python run.py
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
npm install

# Point the client at your backend
#   edit frontend/.env → VITE_API_BASE_URL=http://127.0.0.1:8000  (or your tunnel URL)

npm run dev        # start Vite dev server (default http://localhost:5173)
npm run build      # production build into dist/
npm run preview    # preview the production build
npm run lint       # ESLint
```

Log in with the admin account created by `seed_admin.py`.
