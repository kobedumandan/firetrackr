# Supabase database connection and migration

The configured development API now uses Supabase for both its PostgreSQL/PostGIS
database and private report-photo Storage (2026-11-03). Existing accounts,
incidents, reports, photo object names and operational records were preserved.
FastAPI still owns authentication and authorization. The API and frontend still
run locally; this migration does not publish the application.

The following procedure documents the completed cutover and the checks required
for a future migration. Do not re-import into the active cloud database.

## 1. Save the target connection privately

1. Open the existing `firetrackr` Supabase project's **Connect** dialog.
2. Select **URI**, then **Session pooler**. Copy the exact host and username from
   the dialog; the cluster hostname cannot be inferred from the region alone.
3. Put the URI into the existing `SUPABASE_DATABASE_URL` entry in `backend/.env`.
   Replace the password placeholder with the project's **database password**,
   URL-encoding reserved characters in it. The Storage secret API key is not the
   database password.
4. Require SSL by adding `?sslmode=require` (or `&sslmode=require` if the URI
   already has query parameters).

```dotenv
# Example only; use the actual host, project reference and encoded password.
SUPABASE_DATABASE_URL=postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@POOLER_HOST:5432/postgres?sslmode=require
```

Leave the application's current `DATABASE_URL` unchanged at this stage. The
application does not automatically switch when `SUPABASE_DATABASE_URL` is set.
Do not paste the URI or password into chat or commit the environment file.

The session pooler preserves session-level advisory locks used by the watchdog
and token reaper. The transaction pooler on port 6543 does not preserve that
state and is unsuitable for this backend. A direct connection is also compatible
when its network endpoint is reachable.

## 2. Check before importing

- Read the target's version, extension schemas, search path, existing application
  objects, connection limits and privileges before making changes. Never reset,
  drop or overwrite an existing target database as a routine migration step.
- Enable PostGIS in a non-public extension schema before applying application
  migrations. Confirm unqualified geometry types and `ST_*` functions resolve for
  both the migration and runtime roles.
- Prevent application tables from being exposed through the Supabase Data API
  before importing their records. FastAPI's own authorization does not protect
  tables accessed directly through that separate API. Scope any permissions/RLS
  changes to application objects; preserve Supabase Storage and platform schemas.
- Check source and target schema compatibility. Build a fresh target application
  schema using Alembic rather than restoring local PostGIS extension internals.
  Migrations currently end at `0033`; migration `0005` seeds the shifts.
  Revision `0033` preserves three nullable legacy dispatch attribution fields
  that existed in the source database outside the earlier migration history.

## 3. Copy and verify

1. Keep a complete, verified local backup and a copy of the current private
   environment. Record counts and migration revisions from the same source snapshot.
2. Plan a quiet cutover window. A preparation backup can be taken while the app
   runs, but it does not include writes made after its snapshot.
3. Copy application data only, retaining relationships, IDs and sequence values.
   Resolve seeded rows and circular foreign-key ordering explicitly. Do not
   assume the managed target permits disabling triggers or changing
   `session_replication_role`; verify privileges first.
4. Compare counts, ID/sequence consistency, representative records and spatial
   data before switching the application. Preserve authentication revocations and
   historical location/dispatch evidence unless the user explicitly requests otherwise.
5. Switch only the intended application's `DATABASE_URL`, reload one API worker,
   and verify health, login, reads, private report photos and both advisory locks.
   Keep the local database available for rollback. Writes made after cutover must
   be reconciled before any rollback; changing the URL alone does not copy them back.

## Connection pool

`DB_POOL_SIZE`, `DB_MAX_OVERFLOW` and `DB_CONNECT_TIMEOUT` now configure the
SQLAlchemy pool and connection timeout. Unset pool settings retain the original
20/40 local defaults. The prepared environment uses 8 pooled connections with
4 overflow connections, initially at most 12 per API process. The two held
watchdog/reaper connections consume slots within that total. Check the actual
Supabase project's session-pool and database connection budgets before cutover.

The engine explicitly sets `extra_float_digits=3` on every physical connection.
The target pooler initially returned `0`, which rounded floating-point output
and prevented exact checksums. Passing this as a startup option did not change
the setting; the explicit session command did. Keep the connection hook so
coordinates and other floating-point values retain their stored precision.

Backend tests refuse non-loopback database targets and disable real Storage
credentials. Use the disposable PostGIS runner for database-writing verification.

## Completed cutover (2026-11-03)

- Source: PostgreSQL 18.3/PostGIS 3.6.2 at revision `0032`, about 38.65 MiB at
  inspection. The original database remains available and was not dropped or
  migrated during cutover. It already had the three legacy columns preserved
  by the new revision.
- Target: PostgreSQL 17.11/PostGIS 3.3.7, extension in `extensions`, fresh
  application schema migrated through `0033`. All 29 application/migration
  tables have RLS enabled and grants revoked from PUBLIC, `anon` and
  `authenticated`; public sequences are also restricted. Supabase platform and
  Storage schemas were preserved. FastAPI uses the configured backend role,
  which bypasses RLS, and must continue enforcing its own access checks.
- An isolated PostGIS rehearsal and a rolled-back cloud import verified the
  data-copy procedure. The import temporarily deferred foreign keys inside its
  transaction and restored their definitions after validation; managed-database
  trigger disabling was neither needed nor permitted.
- During the quiet final copy, all 28 application tables and 54,412 rows matched
  their source snapshot counts and complete canonical row checksums. All 25
  sequence states were set and verified, and 51 foreign keys were restored.
  Alembic's version row comes from the target migration, rather than the older
  source revision.
- Only the active `DATABASE_URL` changed at application cutover. Other private
  settings were preserved, including Supabase photo Storage. The same local
  API launch configuration was restarted with one API worker.
- Post-cutover checks pass: API/database health, authenticated account/station/
  incident reads, all 323 reports, and both watchdog/reaper advisory locks. All
  four signed report-photo downloads match their authenticated private objects;
  public-object access is denied. Anonymous account access and personnel access
  to administrator incident endpoints are denied. TLS, migration revision,
  table protection and full floating-point precision were confirmed again.
- The final source dump, explicit-column COPY exports, checksums, environment
  backups and verification manifests are in
  `local-backups/supabase-database-cutover-20261103-ee1150ab9d/` beside the repo.
  A separate preparation archive has a readable index. Application-data restore
  was rehearsed; a complete binary archive restore has not been run. These
  artifacts contain private data and credentials and must stay outside Git.
- Validation includes 59 isolated report/storage/migration checks plus a separate
  floating-point round-trip regression check. Test helpers reject a dummy remote
  target before connecting. Live authenticated read checks use temporary in-memory
  tokens for copied accounts; actual password login and physical-phone submission
  are separate acceptance checks.

If rollback becomes necessary, stop application writes and reconcile records
created or changed in Supabase since cutover before selecting the retained local
database. The old local snapshot does not receive subsequent cloud writes.

## References

- [Connection modes, session state and SSL](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [PostGIS setup and schemas](https://supabase.com/docs/guides/database/extensions/postgis)
- [Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api)
