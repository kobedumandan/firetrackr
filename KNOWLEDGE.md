# FireTrackr — technical knowledge base

## Basis and maintenance

This document describes source inspected on 2026-10-12, based on commit `deb09e1`
before the documentation addition. It records code capabilities, not proof of a
live deployment, trained-model quality or successful field trials. Recheck source
when updating it. Shared development rules are in [AGENTS.md](AGENTS.md), with
commands in [CLAUDE.md](CLAUDE.md).

Evidence includes [README.md](README.md), backend routers/services/models/config,
AI and GIS code, migrations `0001`–`0023`, frontend API/App/pages/hooks/export helpers,
dependency manifests, environment examples, [.gitignore](.gitignore), custom skills,
the [coverage audit](documentation/response-coverage-algorithm-audit.md) and
[plans](plans-todo/). No manuscript is present in the tracked repository inspected.
Plans and docstrings are cross-checked against handlers and callers.

## Purpose and system overview

### BFP historical import and metrics (2026-10-20)

- `backend/import_bfp_history.py` validates source Excel rows against the cleaned
  location review, prepares deterministic demonstration timings, and imports one
  incident per source record. It performs no schema DDL. A caller must back up the
  database and supply an explicit, reviewed list of dummy IDs before replacement.
  The task-local import artifacts and backup are outside the Git repository under
  the parent workspace's `outputs/bfp_history_import/` directory.
- The imported workbook contains 78 incidents dated 2023–2024. Actual times, alarm
  levels, crew assignments, severity and casualties were not provided. Source and
  normalized cause/category values, geocode review flags, and synthesized timings
  are preserved in one `incident_events` row of type `bfp_import` per incident.
  A unique content-derived `idempotency_key` prevents repeat imports. Synthetic
  operational timestamps stay in `event_metadata.synthetic_timeline`; they do not
  populate the actual incident/dispatch/truck timestamp columns. No fake team,
  truck, dispatch, route or personnel report is created for imported history.
- Alarm levels use the earlier reviewed showcase assumptions (58 first alarm,
  20 second alarm), not official BFP alarm observations. Source incident dates stay
  on their original dates, stored at midnight PHT with date-only precision noted
  in metadata. Unknown severity remains null and displays as Not recorded.
- `services/historical_incidents.py` batch-loads provenance. Operational analytics
  defaults to recorded data; `source=demo` explicitly selects synthesized import
  timelines. Real operational timestamps/dispatches take precedence. The current
  dashboard initially opens the labeled demo view and the All period. It
  provides a selector for recorded data. Demo timelines never enter recorded KPIs.
- `services/reporting_periods.py` supplies an All window from the earliest incident
  through now for Metrics and Operational Time Analysis; the old fixed historical
  API period remains supported. All has no previous-period comparison.
  Operational pagination returns `page_size=5`,
  `page`, `total`, and `total_pages`, with invalid high pages clamped to the last
  page. Compact numbered navigation with previous/next arrows sits at bottom right.
  The frontend cache includes the recorded/demo source. The details modal
  displays demo intervals without suggesting a real truck or historical route.
- Metrics retains the severity API for compatibility and adds `alarm_levels`,
  `top_causes`, source-quality counts, and the historical period. Causes count each
  incident once; imported source causes take precedence, otherwise the latest
  non-empty personnel report cause is used. Barangay counts prefer the known FK;
  legacy spatial fallback selects one polygon to avoid double-counting overlaps.
  Unresolved imported barangays are not inferred from approximate coordinates.
- The Metrics donut displays alarm levels. The barangay map/ranking and top-ten
  cause bars sit side by side on wide screens and stack on smaller screens. The
  map refits to boundaries on resize. Unknown severity and response duration are
  shown as unavailable rather than synthesized into the recorded KPI cards.
- All 78 imports now have explicitly estimated heatmap pins: 52 address candidates
  inside the matched barangay, 25 reproducible points inside the barangay polygon,
  and one Panabo reference point for the unresolved Brgy Lemonsito address.
  `services/historical_pins.py` records the coordinate basis and limitations in
  `event_metadata.pin_specification`. These are not verified fire-site coordinates.
  Heatmap detail cards show the specification, date-only precision, and assumed
  alarm basis. Shared representative pins can create apparent area hotspots;
  they must not be interpreted as exact property-level clusters. The unresolved
  barangay remains null and is not inferred from its display pin. The local
  `incident_pin_specifications.csv` records the coordinates used, and
  `before_representative_pins.dump` preserves the database before this update.

FireTrackr supports BFP Panabo City dispatchers in recording fires, choosing response
resources, viewing routes and responder locations, and assessing station reachability.
It connects incident information and personnel/fleet status rather than requiring
dispatchers to reconcile those records manually.

```text
React dashboard ── REST + authenticated session WebSocket ── FastAPI
Separate mobile client ── personnel REST/location updates ──────┤
Reporter phone ── public /report/{token} GPS page ───────────────┤
                                                              ├─ PostgreSQL + PostGIS
                                                              ├─ local report-photo files
                                                              ├─ main routing graph + process pool
                                                              └─ PhilSMS / Expo push services
```

[main.py](backend/main.py) registers routers, localhost CORS and `/uploads`, then
loads routing, starts a worker pool and schedules background maintenance.
[state.py](backend/state.py) holds process-local connections, sessions and caches.
Request handlers use synchronous SQLAlchemy sessions; reusable behavior is in
[services](backend/services/). PostgreSQL advisory locks prevent duplicate watchdog
and token-reaper loops across server workers. They do not share WebSocket events.

The frontend uses React state for screen selection, not React Router. Pages and
modals call [api.js](frontend/src/api.js), while [App.jsx](frontend/src/App.jsx)
owns a persistent session WebSocket, event reconciliation and location polling.
The personnel client is not included here; its backend support can be verified,
but its installed behavior cannot.

## Implemented capabilities

| Area | Source-backed capability | Qualification |
| --- | --- | --- |
| Authentication | Separate admin/personnel logins, JWTs, profile editing, password changes, logout blacklist, successful login history | Local FastAPI auth; no Supabase Auth |
| Incident management | Paginated/filterable register, active list, creation/update/delete, alarm/severity/status history, details and reports | Event history records new changes; older incidents need not have complete history |
| Dispatch | Manual dispatch, auto-selection after intake, ranked escalation recommendations, selected routes, arrival and truck manning | Recommendations are read-only until dispatch; no explicit acknowledgement/en-route transition workflow |
| Resource management | Stations and substations, commander, personnel, shifts, teams/members and trucks | Some cross-resource consistency is by application convention rather than DB enforcement |
| Mapping | Incident/station/personnel markers, heatmap, region boundaries, constraint layers, routes and obstructions | Panabo is production; New Corella is a reduced local-development dataset |
| Location/rerouting | Personnel location history/current position, membership checks, truck synchronization, deviations, connectors/rebuilds and stale-driver fallback | Mobile updates plus WS events; dashboard also polls every 10 seconds |
| Reporter location | Admin sends PhilSMS link or receives a dry-run link; public page posts GPS; map receives broadcast/poll result | Sessions live only in memory; token expiry/registration enforcement is absent |
| After-action reports | Assigned team leader submits narrative/details and scene photos after containment; incident closes and resources are released | Photos stored on local disk and served publicly |
| Notifications | Dashboard toasts, bell/history panel, configurable event alerts and WebAudio chime; backend Expo dispatch push with SMS fallback | Browser preferences persist; history is session memory, not a DB notification log |
| Metrics | Period totals/deltas, severity/containment counts, monthly/per-barangay data, first-arrival response averages | Missing measurements produce null/empty results rather than calibrated predictions |
| Coverage planning | 3/5/8-minute service areas, barangay coverage-gap tables, refresh and CSV export | Descriptive reachability, not station placement optimization |
| Incident exports | CSV, PDF and DOCX generated from a common register model with preview | Export fetch is capped at 5,000 rows |
| Settings | Account/security data and browser theme, map, session and notification preferences | Browser preferences are not shared server-side settings |

## Technology and dependencies

Exact backend pins are in [requirements.txt](backend/requirements.txt); frontend
ranges and resolved dependencies are in [package.json](frontend/package.json) and
[package-lock.json](frontend/package-lock.json).

| Layer | Declared or imported components |
| --- | --- |
| API | FastAPI 0.136.1, Starlette 1.0.0, Uvicorn 0.46.0, Pydantic 2.13.4, python-multipart, python-dotenv |
| Persistence | SQLAlchemy 2.0.49, Alembic 1.18.4, GeoAlchemy2 0.19.0, psycopg2-binary 2.9.12; PostgreSQL/PostGIS |
| GIS/graph | NetworkX 3.6.1, GeoPandas 1.1.3, Shapely 2.1.2, OSMnx 2.1.0, pyproj, pyogrio, pandas, NumPy, SciPy |
| Models | PyTorch 2.5.1, torchvision 0.20.1, torch-geometric 2.7.0; GCN/GAT/GraphSAGE/PMGCN classes |
| Dashboard | React/react-dom ^19.2.5, Vite ^8.0.10, Leaflet ^1.9.4, react-leaflet ^5.0.0, leaflet.heat |
| Exports/tooling | docx, jsPDF, jspdf-autotable, pdfjs-dist, ESLint 10, React hooks/refresh lint plugins, Vitest |
| External services | PhilSMS over HTTP; Expo push API; map tile providers configured in mapConfig.js |

Dependency completeness is an existing limitation: `security.py` imports `jose`
but `python-jose` is not declared. Default `GNN_INFERENCE_MODE=exported` with
`USE_RL=false` skips PyTorch/PyG and optional RL imports. Local GNN dependencies
live in `backend/requirements-ml.txt`; experimental RL still needs Gymnasium and
Stable-Baselines3 installed separately. SUMO/TraCI integration has optional runtime guards; enabling it also
requires external software and scenario files. README prerequisites are guidance,
not a verified version matrix for every current dependency.

Incident intake from the map and register records a dispatch type: Fire Safety
Enforcement, Firefighting Operations, Emergency Medical Services (EMS), Special
Operations, Fire/Arson Investigation, or Disaster Management. New incidents default
to Firefighting Operations; older incidents remain unspecified. The API accepts
`fire_dispatch_type` on create/update and returns `dispatch_type` in incident JSON.
The category is editable, appears in incident details, and is available in all
register export formats. It classifies the incident; crew selection is unchanged.
Apply migration `0024` before running the updated backend.

## Backend/frontend integration

- API base URL is `VITE_API_BASE_URL` (default `http://localhost:8000`). WS URL is
  derived by converting HTTP to WS and appending `/ws`.
- Requests use bearer `bfp_token` from localStorage and the ngrok skip-warning
  header. A non-login 401 clears local credentials and reloads the page.
- Several resource, metric and GIS requests use a two-minute browser-memory cache.
  Mutations invalidate relevant entries; coverage has explicit refresh support.
- WebSocket event consumers reconcile incidents, dispatch/routes, resources,
  location, constraints and reporter pins. A 10-second personnel-location poll
  provides refresh/fallback behavior. WS authentication uses a query token.
- Common serializers define client shapes. Route results expose WKT strings that
  the dashboard converts from `lon lat` into Leaflet `[lat, lon]` arrays.
- Reports store public-base photo URLs; the dashboard rewrites their path onto its
  own API base to avoid tunnel interstitials on image requests.
- Notification preferences/theme/map/session settings use localStorage. Notification
  history is capped at 50 in-memory entries and resets with the mounted session.

Sources: [api.js](frontend/src/api.js), [App.jsx](frontend/src/App.jsx),
[useNotifications.js](frontend/src/hooks/useNotifications.js),
[serializers.py](backend/serializers.py).

## Database structure and relationships

[models.py](backend/models.py) defines the schema; [Alembic versions](backend/alembic/versions/)
define migration history. The current linear chain ends at `0024` (incident dispatch type).
PostGIS must already be enabled; migration files do not create the extension.

| Tables | Relationships and role |
| --- | --- |
| `users`, `admin`, `personnel` | Users hold credentials/role; admin/personnel profiles reference users. ORM treats profiles as singular; that alone is not a DB uniqueness guarantee. |
| `shifts`, `stations` | Personnel and teams reference shifts/stations. Substations reference a parent station; commanders reference personnel. |
| `response_teams`, `response_team_members` | Teams own membership rows linking personnel with role/status. Teams have a station, shift and optional assigned truck. |
| `truck`, `truck_logs` | Station fleet and truck location history; a truck can be assigned to different-shift teams. |
| `devices`, `location_logs`, `current_locations` | Devices reference personnel; historical logs can have a null device for mobile updates. Current location is keyed by personnel ID and includes source/time/battery. |
| `fire_incidents`, `barangay_boundaries`, `heatmap_data` | Incident coordinates/status/details link to confirming user and optional barangay; boundaries are PostGIS `POLYGON`, SRID 4326. Heatmap rows link to incidents. |
| `dispatch_records`, `dispatch_trucks`, `routes` | Dispatch links incident/team/selected route. Truck assignments record manning personnel. Routes reference incident and owning dispatch, with path, ranking, ETA and origin. |
| `incident_reports`, `report_photos` | Reports link incident, optional dispatch and personnel author; photo metadata cascades with a report, bytes live on disk. |
| `incident_events` | Status/alarm/severity transitions link incident/user and retain actor display text. |
| `road_obstructions`, `gnn_constraints` | Obstruction point/type/expiry and custom constraint polylines; both record creator/activity. |
| `push_tokens` | Expo token is the primary key, assigned to personnel with platform/sound settings; reassigned when a different user registers the same phone token. |
| `login_history`, `token_blacklist` | Successful login metadata and revoked JWT `jti` values with expiry; reaper removes expired blacklist rows. |

Two different route/dispatch foreign keys matter: `dispatch_records.route_id`
selects a route; `routes.dispatch_id` identifies its owner. ORM relationships
explicitly disambiguate them. Do not delete/rebuild routes without respecting both.

Incident-to-barangay assignment uses a spatial point-in-polygon query. Coverage
uses the configured barangay GeoJSON asset, while API geodata uses database boundary
rows; keep seeded data and file assets consistent. Current DB pool limits are fixed
at 20 connections plus 40 overflow per engine/process, with pre-ping/recycle.
Neither configurable Supabase pool sizing nor a dedicated test DB setting is
implemented in `database.py`.

The fire-history heatmap reads closed incidents linked to `heatmap_data`.
`GET /api/heatmap` preserves `lat`, `lng`, and `weight`, adds `fire_id` and
`occurred_at`, and derives severity weights (Minor 0.4, Moderate 0.7, Critical 1.0;
unknown 0.5) from the current incident, including legacy seeded rows. Reopened
incidents are excluded. No existing heatmap rows are rewritten. The dashboard
filters points to its region boundary and inclusive Philippine occurrence dates.
Heatmap coordinates use the incident's location, rather than seeded jittered
coordinates. The API also supplies an `incident` display summary (ID, place,
address, severity, status, alarm, structure and casualties). Transparent hit areas
at incident locations show that summary on hover or keyboard focus in 2D and 3D;
clicking opens details. Only the heatmap shading is drawn. Records with identical
coordinates share a hit area and list their incidents together.
MapLibre, Leaflet fallback, and photorealistic Google 3D share Gaussian density
contours sampled every 100 m with a 500 m influence limit. Colors are relative to
the selected dataset's peak, rather than calibrated risk or absolute counts.
The panel supports date presets, custom dates, counts, and refresh/error/empty
states. Heatmap opacity stays at its overview strength through Leaflet-equivalent
zoom 14, then fades at closer zooms to reveal roads in all renderers. Only paint
changes during zoom; the density contours are retained. Visible heatmaps reload on incident events, WebSocket reconnection,
browser visibility, manual refresh, and a two-minute visible-tab interval.

The dashboard's `Alt+C` shortcut opens Command using the sidebar navigation
path, including from Settings and while the Alerts panel is open. Its hint appears
at the right of the Command button (in the tooltip when navigation is compact).
The shortcut is inactive on login, while typing, and while a modal dialog is open.
Light and Dark MapLibre basemaps start at 40 degrees of tilt when selected;
Satellite starts at zero. Returning to the same renderer preserves manual tilt.
The Map style selector starts collapsed. Incident markers use the original
severity-colored pins with their pulse and selection rings across renderers.
Constraint road details appear on hover in tilted MapLibre and Google 3D views,
including the road label, location, avoidance multiplier and available confidence.
Hover cards hide during drawing, camera motion, and when the layer is hidden.

## AI and road routing

### Inputs and runtime path

[ai/config.py](backend/ai/config.py) resolves region paths at import time.
[routing_setup.py](backend/routing_setup.py) loads `roads_panabo.gpkg` for Panabo
through the QGIS loader. A nodes/edges GeoJSON pair is a fallback when present.
Missing QGIS data is a deployment error; it does not silently download OSM.
New Corella uses its OSM GeoPackage, with live OSM download permitted only for an
OSM-declared region. Both datasets build a NetworkX directed road graph.

Panabo uses [best_model_predicted_constraints.geojson](backend/data/best_model_predicted_constraints.geojson)
with [constraint_style_config.json](backend/data/constraint_style_config.json).
The startup path applies predicted constraint properties/multipliers and traffic
schedules; [edge_weights.json](backend/data/edge_weights.json) is a fallback.
The trained `best_gat_manual_threshold_model.pt` is an artifact, not the live model
that generates road classifications on each request.

`GNN_INFERENCE_MODE=exported` (default) skips local model initialization and uses
constraint GeoJSON, then exported edge weights. Missing exports log a warning and
fall back to base travel times, including in routing pool workers. There is no
implicit local GNN fallback. `GNN_INFERENCE_MODE=local` explicitly constructs the
generic GraphSAGE/GAT/PMGCN node model and skips exported constraint costs. Local
mode defaults to GraphSAGE with eight node features and the shipped GraphSAGE
checkpoint; it is not the notebook's SegmentGAT. Install the optional ML
requirements before enabling local mode. Routing status includes `inference_mode`;
`gnn_type` is `exported` when no local model is constructed.

### Search and route products

[routing_engine.py](backend/ai/routing_engine.py) implements ALT (A* with Landmarks
and Triangle inequality), with 16 landmarks and directed-graph distance tables.
Search state includes the previous node so forbidden turns can be honored.
Constraint-aware cost can include base travel time, road multipliers and scheduled
congestion. Congestion is derived from exported time buckets/school schedules, not
live measured road traffic; its bucket selection uses the backend's local clock.

`compute_routes_multi_alpha()` retains its historical name but produces up to
three useful routes: `recommended` (constraint costs), `fastest` (base times with
obstructions), and penalty-based `alternative`. Duplicates/similar paths are dropped;
alternatives may be at most 35% slower than the primary and must differ enough in
shared driving time. Fewer than three routes is valid. Failure may yield no routes.

Obstructions are snapped to roads: blockades/floods become infinite cost, repairs
multiply cost by 5, accidents by 8. Active/expiry checks load operational obstructions
for dispatch computations. Returned ETA sums **base** edge travel times rather than
optimization penalties or observed turnout. The displayed confidence derives from
node scores; it is not a verified probability of timely arrival.

Custom `gnn_constraints` CRUD updates cached map features and broadcasts changes.
Those drawn polylines are not applied to the engine's route costs. The
[Lightning retraining plan](plans-todo/gnn-retraining-lightning.md) explicitly calls
for closing that gap; no retrain/job/promote API exists.

### Location and route correction

Personnel submit authenticated positions tied to an active dispatch and team
membership. The backend records history, resolves source/time races, updates current
location and synchronizes truck position for the person manning it. PostGIS distance
checks detect deviations using the configured 280 m threshold and 50 m rejoin
threshold. Graph-heavy correction is normally deferred to a background task and
[routing_pool.py](backend/routing_pool.py), with in-process fallback.

Routes can be rebuilt from driver location or connectors can be computed for a
deviating responder. The watchdog scans every 15 seconds and reverts driver-origin
routes to station origin after the 15-minute stale window plus 2-minute grace.
This behavior depends on correctly assigned manning personnel and fresh timestamps.

### Experimental components

GCN/GAT/GraphSAGE/PMGCN definitions, Gymnasium dispatch environment, DQN/PPO/DDPG/A3C
agents and SUMO interface are present. `USE_RL` and `USE_SUMO` default to false.
Their presence does not establish an operational trained RL policy or live SUMO
traffic feed. Only the SUMO route XML is tracked; the configured Panabo network XML
and RL checkpoint directory are not supplied by this checkout.

## Important workflows and algorithms

### Incident intake and dispatch

1. Admin logs a fire; validated coordinates/details are persisted and spatial
   barangay assignment is attempted. WebSocket `incident_created` updates clients.
2. Auto-dispatch evaluates eligible teams: operational station with coordinates,
   not already active, current shift when resolvable, an available station truck,
   nonempty crew and standby-compatible membership state.
3. Haversine prefilter narrows candidates to five teams; routed ETA (or distance
   fallback) is scored with a 30-second penalty per dispatch in the previous 12 hours.
   Lowest score wins. This is deterministic ranking, not an RL dispatcher.
4. Dispatch persists incident/team/truck/route changes, broadcasts updates and
   schedules Expo notifications; SMS fallback remains gated by `SEND_SMS`.
5. Arrival, containment and report submission progress the incident. Report
   submission closes the fire and releases dispatched resources. Event rows record
   status/alarm/severity changes; dispatch timing is kept on dispatch records.

See [auto_dispatch.py](backend/auto_dispatch.py),
[services/dispatch.py](backend/services/dispatch.py),
[routers/incidents.py](backend/routers/incidents.py) and
[routers/dispatch.py](backend/routers/dispatch.py).

Shifts alternate daily A/B with an 08:00 Asia/Manila cutover and Shift A anchor
2026-01-01. A missing matching shift row removes the shift restriction in candidate
filtering. Team ranking checks an available station truck; it is not equivalent
to validating every team/truck/personnel assignment convention.

### Coverage and metrics

[coverage_engine.py](backend/coverage_engine.py) performs multi-source Dijkstra
from operational station nodes snapped within 2 km, truncated at eight minutes.
Reachable segments are bucketed into 3/5/8-minute bands, merged, buffered by 0.0004
degrees (approximately 40 m) and unioned. Barangay polygon intersections produce
area percentages: covered at least 80%, partial at least 40%, otherwise gap.
This is road-corridor coverage, not population-weighted or measured response coverage.

[services/coverage.py](backend/services/coverage.py) caches results per process and
uses `_compute_edge_costs()`. It does not explicitly apply the operational obstruction
list or time-bucket congestion like dispatch searches do. Avoid repeating the old
audit's claim that all current closures are reflected without checking this wiring.
Station changes invalidate coverage; refresh recomputes it. Without source stations
coverage returns 404; without a routing engine it returns 503.

[metrics.py](backend/routers/metrics.py) aggregates real DB records. Average response
is first arrival minus incident time, excluding nonpositive or over-six-hour samples.
[eta_validation.py](backend/eta_validation.py) is an inert measurement harness;
no endpoint exposes it. Its dispatch-to-arrival comparison includes turnout, so it
cannot independently calibrate road travel time without additional timestamps.

## API inventory

Paths below come from registered [routers](backend/routers/). `Admin` means
`require_admin`; `User` means `get_current_user`, with additional membership/role
checks where noted. Public means no bearer dependency. Consult schemas/handler
bodies for exact query parameters and response shapes.

| Method and path | Responsibility | Access |
| --- | --- | --- |
| `GET /`, `GET /health` | Liveness message; database/PostGIS check | Public |
| `WS /ws?token=...` | Events and ping/pong | JWT signature/expiry at connect; limitations below |
| `POST /api/auth/login` | Dashboard admin sign-in | Public credentials |
| `POST /login_user` | Personnel client sign-in | Public credentials |
| `GET/PATCH /api/auth/me` | Read/edit own profile; email change can return replacement JWT | User |
| `POST /api/auth/change-password`, `POST /api/auth/logout` | Change credentials/revoke current token | User |
| `GET /api/auth/login-history` | Own recent successful logins | User |
| `GET /api/routing/status` | Engine readiness, region/source/constraints | Public |
| `POST /api/routing/compute` | Route between supplied graph node IDs | Admin |
| `GET /api/routing/graph/summary`, `GET /api/routing/gnn-constraints` | Graph summary; predicted/custom map features | Admin |
| `GET /api/routing/nearest-station`, `GET /api/routing/snap` | Station/node proximity; road snapping | Admin |
| `GET /api/coverage/isochrones`, `GET /api/coverage/gaps` | Service areas and barangay gap rows | Admin |
| `GET/POST /api/personnel`, `PATCH/DELETE /api/personnel/{per_id}` | Roster/accounts | Admin |
| `GET /api/personnel/locations` | Live positions with age/staleness | Admin |
| `GET/POST /api/stations`, `PATCH/DELETE /api/stations/{station_id}` | Station management | Admin |
| `GET /api/shifts` | Shift lookup | Admin |
| `GET/POST /api/teams`, `PATCH/DELETE /api/teams/{team_id}` | Team management | Admin |
| `POST /api/teams/{team_id}/members`, `PATCH/DELETE /api/teams/{team_id}/members/{per_id}` | Crew membership | Admin |
| `GET/POST /api/trucks`, `PATCH/DELETE /api/trucks/{truck_id}` | Fleet management | Admin |
| `GET /api/barangays`, `GET /api/heatmap` | Boundary/incident map data | Admin |
| `GET/POST /api/obstructions`, `DELETE /api/obstructions/{obstruction_id}` | Road disruptions | Admin |
| `GET/POST /api/constraints`, `PATCH/DELETE /api/constraints/{constraint_id}` | Custom map polylines | Admin |
| `GET/POST /api/incidents`, `PATCH/DELETE /api/incidents/{fire_id}` | Incident register and mutations | Admin |
| `GET /api/incidents/active` | Current incident list | Admin |
| `GET /api/incidents/{fire_id}/report`, `GET /api/incidents/{fire_id}/events` | After-action report and change history | Admin |
| `GET /api/metrics/summary` | Dashboard aggregates | Admin |
| `GET/POST /api/dispatch` | List/create dispatches | Admin |
| `GET /api/incidents/{fire_id}/dispatch-recommendations`, `GET /api/incidents/{fire_id}/routes` | Ranked candidates; saved routes | Admin |
| `PATCH /api/dispatch/{dispatch_id}/select-route`, `POST /api/dispatch/{dispatch_id}/full-reroute` | Change/rebuild dispatch route | Admin |
| `PATCH /api/dispatch/{dispatch_id}/arrived`, `PATCH /api/dispatch/{dispatch_id}/truck-manning` | Arrival and truck custody | User; assigned personnel; only team driver can claim truck manning |
| `PATCH /api/dispatch/{dispatch_id}/contain`, `POST /api/dispatch/{dispatch_id}/report` | Containment; multipart report/photo submission | User; assigned personnel team leader |
| `GET /api/mobile/me/station`, `GET /api/mobile/me/status` | Own home station; team/active dispatch status | User; personnel role/profile checks |
| `PUT /api/mobile/push-token`, `POST /api/mobile/push-token/unregister`, `POST /api/mobile/push-token/test` | Register/remove/test own phone token | User; personnel checks |
| `POST /api/location/update` | Own active-dispatch position | User; personnel/team checks |
| `GET /api/report-sessions`, `GET /api/report-sessions/{token}`, `POST /api/report-sessions/{token}/send-sms` | Dispatcher reporter sessions and SMS | Admin |
| `POST /api/report-sessions/{token}/location` | Reporter GPS submission | Public |
| `GET /report/{token}`, `GET /report-assets/axiforma-{weight}.otf` | Reporter HTML and whitelisted font assets | Public |
| `GET /uploads/...` | Static report photos | Public mount |

FastAPI's default `/docs`, `/redoc` and `/openapi.json` are not disabled.
There is no separate retraining, dispatch acknowledgement or ETA-validation endpoint.

## Environment configuration

Templates: [backend/.env.example](backend/.env.example),
[frontend/.env.example](frontend/.env.example). Do not copy their placeholders into
a deployment unchanged. Backend settings load `.env` at import time; restart after
changes. Vite variables are built into browser assets and need rebuild/restart.

| Setting | Source/default and purpose |
| --- | --- |
| `DATABASE_URL` | Required by database/Alembic; PostgreSQL connection URL |
| `JWT_SECRET`, `JWT_EXPIRE_HOURS` | `change-me`, `8`; HS256 token signing/lifetime; override secret |
| `PUBLIC_BASE_URL` | `http://localhost:8000`; external reporter/photo link base |
| `PHILSMS_API_TOKEN`, `PHILSMS_SENDER_ID`, `SEND_SMS` | Empty token, `PhilSMS`, `false`; outbound SMS |
| `EXPO_ACCESS_TOKEN`, `DISPATCH_SMS_FALLBACK` | Empty, `true`; push enhanced security token and fallback preference |
| `ROUTING_POOL_SIZE`, `ROUTING_POOL_TIMEOUT` | `2`, `30` seconds; pool sizing/timeout; size 0 disables pool |
| `LOCATION_REROUTE_INLINE` | `false`; diagnostic inline versus deferred rerouting |
| `BLACKLIST_REAPER_INTERVAL` | `3600` seconds; token cleanup schedule |
| `HOST`, `PORT`, `WEB_CONCURRENCY` | Launcher defaults `127.0.0.1`, `8000`, `1` |
| `REGION` | `panabo`; `new_corella` only for local testing; unknown values rejected |
| `GNN_TYPE`, `TORCH_DEVICE` | `graphsage`, `cpu`; generic node model/device |
| `USE_RL`, `USE_SUMO`, `SUMO_PORT`, `SUMO_HOME` | `false`, `false`, `8813`, external install path; experimental integrations |
| `VITE_API_BASE_URL` | `http://localhost:8000`; REST/derived WS base |
| `VITE_REGION` | `panabo`; must match backend region |
| `VITE_CARTO_MAP_API_KEY` | Browser map-tile configuration; never use a private server secret |
| `VITE_PUBLIC_BASE_URL` | Optional reporter-link fallback in LocationRequestModal |

The backend example includes obsolete Semaphore names, but no active Semaphore SMS
service reads them. It omits JWT settings. The frontend example contains explanatory
placeholder strings rather than usable API/key values. `DB_POOL_SIZE`,
`DB_MAX_OVERFLOW` and `TEST_DATABASE_URL` appear in plans, not implemented settings.

## Security and operational limitations

These are static source observations, not a full security audit or a dependency
vulnerability assessment. Follow the [security-audit skill](.agents/skills/security-audit/SKILL.md)
for a requested verified audit.

- HTTP authentication checks signature, expiry, blacklist and current DB user;
  dashboard handlers check admin role. WS connect checks signature/expiry and numeric
  subject only: it does not check blacklist, current DB user or admin role and shares
  one broadcast set. Do not assume HTTP authorization protects broadcast payloads.
- JWT signing has a weak default; password comparison currently uses string equality
  rather than constant-time comparison. Password/email changes revoke the supplied
  token, not all outstanding sessions. No login rate-limit middleware is configured.
- Reporter GPS accepts arbitrary path tokens into in-memory sessions with no enforced
  registration/expiry lifecycle; dashboard tokens are timestamp-derived rather than
  cryptographically random. Browser geolocation generally needs HTTPS outside
  localhost; phone reachability depends on the configured public backend URL.
- Uploaded report photos have count/size and client MIME restrictions and randomized
  stored filenames, but are public static files; MIME validation is not content
  verification. Storage is neither Supabase Storage nor a durable remote object store.
- WebSocket sessions, reporter state and caches are not shared between workers or
  durable across restarts. Single-worker real-time operation is the current safe
  architectural assumption; routing pool subprocesses are separate from Uvicorn workers.
- CORS is hardcoded to `http://localhost:5173`. Deployment origins and reverse-proxy/
  TLS configuration must be confirmed externally. API docs are enabled by default.
- New Corella lacks predicted constraints and barangay polygons; no reachable operational
  station yields no coverage. Region switches share the same database and do not
  isolate old Panabo records.
- Coverage uses buffered road area and degree-based geometry, not measured travel,
  population weighting, turnout or optimization. Its costs do not include the full
  dispatch obstruction/congestion pipeline. Cached results can age until refresh.
- Route ETA is modeled travel time. Actual field accuracy, provider delivery and
  operational suitability have not been established by this documentation review.
- Tests are intentionally excluded by [.gitignore](.gitignore); Vitest has a tracked
  script but no tracked cases. No committed backend suite or CI workflow was found.
  A fresh clone cannot reproduce local tests, and current dependency gaps can prevent
  startup. No source/dependency/database execution was required for this documentation.

## Planned or incomplete work

| Item | Current evidence |
| --- | --- |
| Supabase database migration | [Plan](plans-todo/supabase-migration.md); SQLAlchemy URL can target PostgreSQL hosting, but deployed host/settings cannot be established from source. Proposed pool sizing/timeouts/test safeguards are absent. |
| Lightning retraining/challenger promotion | [Plan](plans-todo/gnn-retraining-lightning.md); no job service, API, artifact promotion or UI integration. Training notebooks/preprocessing pipeline are outside tracked source. |
| Applying drawn constraints to routing | Custom map CRUD is implemented; engine-cost integration is outstanding. |
| Shared real-time state across API workers | Warning in [run.py](backend/run.py); no shared pub/sub/session store implemented. |
| Dispatch acknowledgement/status transitions | Operational departure/arrival measurements are separate from dispatch status. Recording a measurement does not silently change the dispatch workflow. |
| ETA validation exposure/calibration | [eta_validation.py](backend/eta_validation.py) exists but is not wired into routes. |
| RL/SUMO operations | Experimental classes exist, default flags are off, required deployment artifacts are incomplete. |
| Notification feature | [Plan](plans-todo/notifications-tab.md) has stale historical context; App, hook, toast/panel and settings show the feature is implemented. Live verification remains separate. |

## Operational Time Analysis

The administrator sidebar now opens a separate **Operational Time Analysis** page
between Metrics and Planning. It uses the existing React state-based navigation,
KpiCard, form fields, modal shell, theme tokens and Leaflet maps. Metrics calculations,
Planning coverage and the routing/ETA algorithms retain their existing behavior.

Implementation entry points:

- Frontend: `pages/OperationalTimePage.jsx`, `components/OperationalTrendChart.jsx`,
  `components/ResponseAnalysisModal.jsx`, `components/ReportReceiptFields.jsx`,
  `utils/operationalTimes.js` and `styles/OperationalTimePage.css`.
- Integration: App/TopBar navigation, api.js cache and invalidation, the two incident
  intake forms, and optional focus management in AppModal. Data refreshes after
  relevant WebSocket messages, local writes and a visible-page minute timer.
- Backend: `routers/operational_times.py`, `services/operational_times.py`, schema
  and ORM extensions, plus small hooks in incident creation, dispatch creation,
  route selection/replacement, crew arrival and mobile location updates.

The administrator-only API is `GET /api/operational-times?period=1y&page=1`,
`GET /api/operational-times/{fire_id}`, and
`POST /api/operational-times/{fire_id}/milestones`. All use existing JWT role checks.
Confirmation requires `kind`, a timezone-aware `occurred_at`, and an
`idempotency_key`; unit events also require the incident's `dispatch_truck_id`.
`response_kind` can explicitly verify fire, medical, rescue or other. Sources,
actor identity, occurrence time and server receipt time are audited separately.
First recorded milestones are not overwritten by retries or later GPS packets.

Migration `0025` adds nullable incident receipt/suppression timestamps and response
classification, per-dispatch-truck departure/arrival, event audit metadata and
dispatch-associated truck telemetry. It adds no tables and backfills no history.
Main's authoritative `0024_add_incident_dispatch_type.py` adds the optional incident
dispatch category. An earlier feature revision temporarily reused `0024` while that
source was unavailable. Migration `0026` safely adds the category only when an
existing feature database reached `0025` without it; fresh and main-derived databases
already contain it. The supplied October 19 backup was inspected, not restored.

Measurement rules:

- Receipt is explicitly confirmed in an intake form or the response modal. Incident
  occurrence, record creation, reporter GPS and SMS delivery are not call receipt.
- Processing is dispatch minus receipt; preparation is unit departure minus dispatch;
  travel is unit arrival minus departure; suppression is verified fire out minus
  verified suppression start. Non-fire suppression is N/A; unknown data remains null.
- A legacy dispatch arrival is reused only for a single assigned truck with valid
  ordering, and labeled as such. It is not copied to new columns. Ambiguous
  multi-truck dispatch arrivals are not attributed to individual trucks.
- CTA is first qualifying unit arrival minus receipt, once per incident. Summary
  processing uses first dispatch per incident; preparation/travel include eligible
  units. The breakdown uses one common complete fire-incident cohort and the first
  arriving unit. Suppression is excluded from CTA, and the breakdown is explicitly
  not a continuous timeline (arrival-to-suppression delay is not included).
- Windows are rolling 1/7/30/182/365 days with equal preceding comparison windows.
  Charts bucket in Asia/Manila. All period averages require a known receipt time;
  legacy records are listed by occurrence date with a receipt-unknown label.

Existing route generation is reused. Route generation/selection writes an audit
snapshot into incident_events. Departure freezes the latest selection known at that
event time, including alternatives, geometry, original ETA, distance and origin.
Rerouting can replace live route rows without changing that frozen comparison.
Delayed confirmations cannot borrow a selection recorded after departure. Missing
historical selection means comparison unavailable, even if a current route exists.
ETA difference is actual minus predicted; percentage is computed only for ETA > 0.

Mobile `POST /api/location/update` accepts optional `accuracy_m` and `sample_id`.
Existing payloads remain accepted. Automatic vehicle milestones require exactly one
explicitly manned assignment, accuracy at most 35 m, a station fix within 100 m,
then two fixes confidently beyond 150 m at least 5 seconds apart. Arrival requires
two fixes confidently within 100 m of the incident after departure. Gaps over
120 seconds reset detection. Device-time samples are sorted; duplicate sample keys
are ignored. The modal only draws associated vehicle history within the response
interval, breaking paths across gaps instead of joining missing travel.

Limitations: the separate mobile application is not in this checkout and must send
accuracy/sample IDs for GPS automation. Offline GPS is supported within a continuing
manning session; after release/completion, explicit administrator confirmation is
required rather than guessing historical vehicle occupancy. Suppression always needs
human confirmation. No operational history was fabricated for the showcase database.
The existing status/alarm/severity timeline continues to filter its own event types.

The Command map also falls back to its existing Leaflet renderer after 15 seconds
if a failed worker never emits a MapLibre load/error event. Tilt/rotation still
require a working enhanced renderer; standard tiles remain available.

Deployment: back up the target database, stop the backend, review `alembic current`,
then run `venv\Scripts\python.exe -m alembic upgrade head` from `backend/` before
restarting it. Build the frontend with `npm.cmd run build`. Downgrade below `0025`
removes the new operational fields/history metadata, so preserve a backup first.

Local validation includes the migration chain through `0026`, downgrade/upgrade,
multi-unit and missing-data calculations, ordering/idempotence, route snapshot
survival, GPS gating/offline order, role/ownership checks, existing dispatch/mobile
contracts, UI empty/error/modal/period behavior and the existing map test suite.
Tests and local verification helpers remain unstaged according to repository policy.

## Important decisions and facts to confirm

Keep Panabo's digitized graph separate from OSM test data; preserve common graph
construction across routing processes; separate penalized route selection from
base-time ETA; reuse serializers and export document models; keep PostGIS for
spatial containment/deviation; maintain the current one-worker event architecture
until shared state is implemented. These choices explain behavior and constrain changes.

Confirm externally before operational claims: actual DB host/version/PostGIS setup,
production origins/TLS/tunnel, dependency versions that currently run successfully,
available local tests and their database safety, mobile-project revision, push/SMS
credentials and device delivery, training preprocessing/provenance/evaluation data,
and observed field dispatch/arrival measurements. Do not record secret values here.
