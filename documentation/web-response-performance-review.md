# Run response performance in the original web checkout

The feature is installed in the original `firetrackr` folder alongside the existing
model-management and constraint-editor changes. The current branch remains
`feature/gnn-inference-mode`; no commit, push or merge into the Git `main` branch
was performed. The other worktrees remain available as review snapshots.

## Start locally

Stop previous backend/frontend terminals with Ctrl+C to free ports 8000 and 5173.
Start the original backend:

```powershell
cd "C:\Software Projects\firetrackr_local_master-folder\firetrackr\backend"
& ".\venv\Scripts\python.exe" run.py
```

In another terminal:

```powershell
cd "C:\Software Projects\firetrackr_local_master-folder\firetrackr\frontend"
npm.cmd run dev -- --port 5173 --strictPort
```

Open <http://localhost:5173> and sign in with your usual original-app administrator
account. The original backend/frontend `.env` files and existing accounts are
preserved; use your regular login rather than the separate review credentials.

## What to review

1. Open **Analysis > Response Performance**. Existing incidents have no explicit
   record kind, so select **Record kind: unknown** to inspect them, with an
   appropriate date range, and click **Refresh**.
2. Review the cards, monthly team trends and dispatch table. Team selection changes
   dispatch statistics while overall first arrival keeps all teams in its cohort.
3. Open a dispatch to inspect timestamps, context and retained route revisions.
   Pre-migration routes have explicit unverified legacy provenance. Historical
   arrival/departure/receipt values are not reconstructed from predictions.
4. Export CSV and compare its count with the filtered dispatch table. Existing
   records lacking receipt times cannot produce measured call-to-arrival results;
   dispatch-to-arrival can still be available when both timestamps exist.
5. Confirm the Metrics overview, Analysis > Operational Times, Analysis > Coverage Planning, the GAT constraint editor
   and Settings > Model remain accessible.
6. For new incident intake, record the actual receipt time and choose the correct
   record kind. Classify practice records as test or drill.

No synthetic fixtures were added to the original database and no existing incident
was automatically classified operational. For populated charts in this same
original checkout, use the [Analysis test-data guide](analysis-test-data.md).
Its dedicated launcher selects an isolated copy with 24 synthetic test incidents
without editing `.env`. Mobile physical review remains deferred.

## Migration and validation

The original local `bfp_capstone` database was backed up, then upgraded from 0026
to 0028. Original 0025 (constraint segment IDs) and 0026 (model registry) migration
files are unchanged. New 0027 adds operational timing and 0028 adds response
performance. Existing row counts were preserved, including all 214 incidents.

The custom-format database backup, changed source backups and installation manifest
are outside the repository at
`../.web-integration-review/original-install-20261020-204237/`.
Keep these local; they contain private application data. The main backup is
`bfp_capstone-before-response-performance.dump`.

Validation in this checkout: 121 frontend tests and production build pass; Python
compilation and read-only authenticated analytics, dispatch rows, CSV, model
summary, constraints and operational analysis checks pass against the original
database. Analytics reject unauthenticated requests. The same feature code had
already passed 25 backend/API tests and migration upgrade/rollback/re-upgrade tests
on disposable PostGIS. Existing lint findings and the bundle-size warning remain.

Do not run the database-writing regression tests against `bfp_capstone`, and do not
reuse the earlier response-only worktree's database URL: its migration IDs represent
a different schema.
