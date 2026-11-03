# Plan: moving the database from local Postgres to Supabase

> Historical design notes. Follow the current
> [database setup guide](../documentation/supabase-database-setup.md) for execution.
> The configured development API switched to Supabase on 2026-11-03 after a
> snapshot-consistent backup, isolated rehearsal, target protection and full-table
> checksum verification. The cloud schema is at `0033`; the retained local source
> remains at `0032` with its existing legacy columns. Public API/frontend hosting
> remains a separate step.
> The older command examples below require rechecking against actual target
> privileges, extension schemas and seeded rows; do not execute them verbatim.

**Scope:** this plan covers the database migration. Login stays in FastAPI (JWT + blacklist).
Report photos now separately support a private Supabase Storage bucket; follow
[storage setup](../documentation/supabase-storage-setup.md) for that step. Local disk
remains the default until storage is configured. Backend hosting is a separate step.

## What this migration touches

| Item | Where | Why it matters |
|---|---|---|
| Connection string | `DATABASE_URL` in `backend/.env`, read by [database.py](../backend/database.py) and [alembic/env.py](../backend/alembic/env.py) | This is the only switch. No code has the host hardcoded. |
| Configurable connection pool | [database.py](../backend/database.py) (`create_engine`) | Unset defaults remain 20 + 40 overflow; the prepared 8 + 4 pool must fit the actual project's connection budget. Held advisory-lock leases count within this total. |
| Advisory locks on connections held open | [services/watchdog.py](../backend/services/watchdog.py), [services/token_cleanup.py](../backend/services/token_cleanup.py) | These need session mode. They break on the transaction pooler (port 6543). |
| PostGIS | `brgy_polygon` Geometry in [models.py](../backend/models.py), plus `ST_DWithin`/`::geography` in [services/routing.py](../backend/services/routing.py) | The extension has to be on before migration 0015 runs. No migration creates it. |
| Tests | [tests/conftest.py](../backend/tests/conftest.py) | Once `.env` points at Supabase, pytest would write test data into the production database. |

## Phase 0: Prepare (about 15 min)

1. Install the PostgreSQL client tools (`pg_dump`, `psql`) at a version equal to or newer than the local server. Check the server with `SELECT version();`. They are not on PATH yet.
2. Back up the local database: `pg_dump -Fc bfp_capstone > bfp_local_YYYYMMDD.dump`. This is also the way back.
3. Write down the local row counts for every table, so they can be compared after the copy.

## Phase 1: Set up the Supabase project

1. Create the project in the **Southeast Asia (Singapore)** region. It's the closest to Panabo, and every query pays that round trip.
2. Turn on PostGIS: Dashboard → Database → Extensions → `postgis`. Supabase puts it in the `extensions` schema. That's fine, because the default `search_path` includes it.
3. Stop Supabase publishing the tables over its public web API. Every table in `public` is readable through that API with the public (anon) key unless it's blocked. Since the app doesn't use that API, remove `public` from Settings → API → Exposed schemas, or turn the Data API off. **This is the most important security step.**
4. Get the **Session pooler** connection string (port 5432, user `postgres.<project-ref>`):

   ```
   postgresql://postgres.<ref>:<pw>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require
   ```

   - The Direct connection (`db.<ref>.supabase.co`) only works over IPv6 unless you pay for an IPv4 add-on. Most Philippine home ISPs are IPv4-only.
   - The Transaction pooler (6543) breaks the advisory locks.
   - URL-encode any special characters in the password.

## Phase 2: Code changes (small)

1. Make the pool size configurable in [database.py](../backend/database.py):

   ```python
   pool_size=int(os.getenv("DB_POOL_SIZE", "20")),
   max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "40")),
   ```

   For Supabase, set `DB_POOL_SIZE=8` and `DB_MAX_OVERFLOW=4`. With the 2 lock connections, that stays under the Nano/Free session-pool limit (about 15; check it under Database → Settings → Connection pooling). Local development keeps the current defaults.
2. Add a connect timeout so a stalled network fails fast instead of hanging requests: `connect_args={"connect_timeout": 10}`.
3. Protect the tests: make [conftest.py](../backend/tests/conftest.py) refuse to run when `DATABASE_URL` contains `supabase`, or have it use a separate `TEST_DATABASE_URL`. This change stays local (test files aren't committed).
4. Update `backend/.env.example` and [README.md](../README.md): Supabase connection string format, the new pool settings, and "enable PostGIS in the dashboard".

## Phase 3: Schema, then data

Build the schema with Alembic instead of restoring the whole local dump. A full restore would carry over `public.geometry` references and PostGIS internals (`spatial_ref_sys`), which conflict with Supabase's `extensions` schema.

1. Point a temporary `DATABASE_URL` at Supabase and run `alembic upgrade head`. This runs migrations 0001–0023 on the empty database and seeds the shifts.
2. Copy data only:

   ```
   pg_dump --data-only --no-owner --no-privileges \
     --exclude-table=alembic_version --exclude-table=spatial_ref_sys \
     --exclude-table-data=shifts \
     -f data.sql bfp_capstone

   psql "<supabase url>" --single-transaction \
     -c "SET session_replication_role = replica;" -f data.sql
   ```

   - `session_replication_role = replica` skips foreign-key triggers, so the order tables load in doesn't matter. `--single-transaction` means nothing is left half-copied if it fails.
   - Skip the `shifts` data because migration 0005 already inserted those rows. First check that their IDs match locally (1 = A, 2 = B). If they don't, delete the seeded rows and copy the local ones.
   - The data-only dump includes the `setval` calls, so the ID counters come across too. Check them anyway (step 3).
   - Optional: truncate `token_blacklist` and old `location_logs` first to keep the dump small.
3. Check:
   - Row counts match Phase 0.
   - `SELECT PostGIS_Version();` works.
   - `SELECT max(id)` against each sequence's `last_value` on a few tables.
   - `SELECT ST_IsValid(brgy_polygon) ...` on the barangay boundaries table returns true.

## Phase 4: Switch over

1. Stop the local backend, then run Phase 3 step 2 again. This picks up anything written during testing, or simply do Phase 3 during a quiet period.
2. Put the Supabase `DATABASE_URL` and pool settings in `backend/.env`, then start `python run.py`.
3. Smoke test:
   - `check_connection()` logs OK.
   - Admin login and mobile `/login_user` work.
   - The dashboard loads incidents, stations and the barangay boundaries layer.
   - Create an incident, dispatch it, send a location update from the phone (deviation check hits PostGIS), then mark it arrived.
   - Logs show that exactly one watchdog and one token-reaper lock were acquired.
4. Keep the local database untouched for about 2 weeks. Rolling back means switching `DATABASE_URL` back.

## Risks to plan for

- **Latency:** each query now makes a round trip to Singapore (about 40–80 ms) instead of staying local. `/api/location/update` runs several queries, so expect higher response times and a lower throughput limit than the ~120 req/s load-test figure. Re-run a short load test afterwards. Going from 3 s to 5 s location updates during `dispatched` is an option if needed.
- **Free tier pauses after about 7 days without activity.** Before any defense or demo, open the project or upgrade.
- **Connection limit:** raising `ROUTING_POOL_SIZE` doesn't matter here because the routing workers don't touch the database. Raising `WEB_CONCURRENCY` multiplies the pool per worker, so recalculate before changing it.
- **Development workflow:** keep a local `.env` for development and use Supabase only for the deployed instance. Otherwise seed scripts and tests change production data.

## Open decisions

1. **Supabase plan:** Free (pauses, about 15 pooled connections) or Pro. Free is enough for the capstone if it's kept active.
2. **Location history:** copy all of `location_logs` or start empty.
