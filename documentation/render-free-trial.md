# Render Free trial

The root [render.yaml](../render.yaml) prepares one **free** Python API in Singapore.
It does not create a database, change the local `.env`, run migrations, seed data,
or enable paid messaging. Commit-triggered service deployments are disabled.
Blueprint auto-sync is a separate Render setting; set it to **No** on the
Blueprint's Settings page if you want to apply configuration changes manually.

This is a trial configuration, not evidence of a working hosted deployment.

## Local resource screen — November 4, 2026

The actual FastAPI lifespan and Panabo road graph were exercised on Windows with
a new loopback-only PostgreSQL/PostGIS cluster migrated through revision `0033`.
Only synthetic accounts and three synthetic stations were inserted. The temporary
database was stopped afterward; the existing application database was not changed.

| Check | Local result |
| --- | --- |
| Panabo graph | 28,260 nodes; 58,627 directed edges |
| API process memory after startup | 282.85 MiB resident |
| Highest sampled resident memory | 443.04 MiB |
| Highest sampled private committed memory | 438.68 MiB |
| Resident memory after routing, reload, coverage and GC | 378.02 MiB |
| Full application import, including fixture setup | 3.18 s |
| Application lifespan / routing startup | 1.60 s |
| Six HTTP single-route requests | 0.073–1.69 s |
| Six multi-route computations after single-route requests | 0.35–6.93 s |
| Coverage calculation | 4.06 s; 4.21 s after graph replacement |
| Health, graph status, seven dashboard reads, six route requests, three coverage reads | 18 HTTP requests returned 200 |
| Anonymous team read | Rejected |
| Authenticated WebSocket replay handshake, ping/pong and broadcast | Passed |
| Routing child processes / imported PyTorch | None / not imported |

The local benchmark is `backend/tests/profile_render_free.py` (gitignored test
tooling). Run it with the existing backend virtual environment:

```powershell
& .\backend\venv\Scripts\python.exe .\backend\tests\profile_render_free.py
```

It disables dotenv loading, redirects all database work to its new loopback
cluster, disables SMS and uses local photo mode without uploading photos. Reports
are saved under `.simulation-results/render-free-<UTC timestamp>/`.
The initial complete result is
`.simulation-results/render-free-20261104T063515Z/report.json`.

**Interpretation:** this supports trying Free; it does not prove the app fits a
512 MB Linux container. Windows memory accounting and package builds differ.
Memory includes the local test client; the database had a small synthetic dataset.
CPU was not throttled to Render's 0.1 CPU, so the timings are not Render predictions.
Supabase latency, private remote photo storage, dispatch load, concurrent routing,
model training and sustained load were not tested.

## Configuration choices

- One Uvicorn worker preserves process-local WebSocket and reporter state.
- `ROUTING_POOL_SIZE=0` avoids two extra graph copies. Routing work shares the
  main process, so concurrent expensive requests can take longer.
- Exported inference avoids installing the optional PyTorch requirements.
- Single-threaded OpenBLAS/OMP/MKL/NumExpr/GDAL avoids unnecessary native threads
  and reduces their memory cost on a small CPU allocation.
- The connection pool allows four base connections and two overflow connections.
  The watchdog and blacklist reaper hold two of those connections.
- `backend/.python-version` selects the latest Python 3.12 patch; the local test
  used 3.12.10. The Linux dependency installation still needs a Render build.
- Report photos use the existing private Supabase storage implementation.

## Before the hosted trial

1. Install/connect the Render integration or create the free service from the
   Blueprint in Render. The relevant local files must be present in the Git branch
   selected for deployment; local uncommitted changes are not uploaded by Render.
   No commit, push, or hosted service was created by the local resource screen.
2. Supply `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` through Render's
   secret environment settings. Never put their values in this Blueprint, browser
   variables, logs, or Git. Use a separate test database and private photo bucket
   for write tests. This Blueprint does not provision or migrate either.
3. Use a PostgreSQL/PostGIS schema matching the application (currently `0033`).
   Supabase's TLS **Session pooler** is required by the held session advisory locks;
   retain `sslmode=require`. Do not substitute transaction pooling.
4. Verify the active model's immutable bundle is available on the host. The
   default road and baseline constraint assets are tracked, but
   `backend/ai/models/versions/` is gitignored. A database champion record pointing
   at an absent bundle prevents routing initialization. The configured remote
   database could not be inspected during this trial because its connection timed
   out, so its current champion is unverified.
5. Set `PUBLIC_BASE_URL` to the assigned `https://...onrender.com` API URL before
   exercising reporter links. The local default is not a deployed reporter URL.
6. For the first dashboard test, keep Vite at `http://localhost:5173`, which the
   current CORS policy permits. Start it with `VITE_API_BASE_URL` set to the Render
   URL and `VITE_REGION=panabo` in that shell. No local `.env` edit is needed.
   A separately hosted dashboard needs its exact origin added to backend CORS.

Do not run model retraining/promotion as part of this Free trial: its local job
files and model versions do not survive service restarts, redeploys or idle sleep.
Keep training elsewhere and plan durable model artifact retrieval before testing
model lifecycle features. In-memory reporter sessions are also lost on restart.

## Hosted acceptance

1. Confirm `/health` reports both API and database `ok`, then confirm
   `/api/routing/status` reports `online`, `panabo` and exported inference.
   `/health` alone is not a routing-readiness check and always returns HTTP 200.
2. Log in and exercise dashboard reads, the constraint layer, coverage, routing
   and WebSocket reconnection while watching Render's memory and CPU metrics.
3. Run an incident/dispatch/rerouting lifecycle only against the test database.
   Test photo upload/read only against the test bucket; SMS remains disabled.
4. Stop client traffic for more than 15 minutes, then measure wake-up time and
   verify routing, login and WebSocket recovery again. Do not manufacture traffic
   to bypass idle sleep; the existing connected dashboard sends normal heartbeats.
5. If memory is exhausted, the $7 plan has the same 512 MB memory and will not
   fix that limit. If memory fits but routing is slow, the $7 plan's 0.5 CPU may
   help compared with Free's 0.1 CPU. Measure on the host before deciding.

Render documentation: [free limits](https://render.com/docs/free),
[compute plans](https://render.com/docs/compute-plans),
[Python versions](https://render.com/docs/python-version),
[Blueprint fields](https://render.com/docs/blueprint-spec).
