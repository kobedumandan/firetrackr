# Merge and rollout requirements

The dashboard/backend branch is `feature/gnn-inference-mode`. Its companion mobile
branch is `feature/duty-tracking-and-personnel-response` in `firetrackr_mobile`.
Response Lab is a separate repository and uses the same personnel APIs.

## Validate the committed version

Use a clean checkout with its locked dependencies:

```powershell
cd frontend
npm ci
npm test
npm run build
```

The committed timing tests must cover recorded operational data by default,
explicit demo selection, and resetting pagination when the data source changes.
Additional tests and the disposable-database harness may exist locally; they are
not prerequisites for running the committed frontend suite.

## Upgrade an installation

1. Back up the intended PostgreSQL database and verify a restore in isolation.
   Record its current Alembic revision before deploying application changes.
2. Check for the historical conflicting feature revisions described in
   [the legacy migration guide](../backend/alembic/legacy_versions/README.md).
   A database using those old `0025`/`0026` schemas needs reconciliation. Do not
   stamp it as a later revision to bypass that check.
3. During the deployment window, stop the old backend. From `backend`, using the
   configured Python environment and the intended database, run:

   ```powershell
   python -m alembic current
   python -m alembic upgrade head
   python -m alembic current
   ```

   Current main's normal chain upgrades from `0028` through `0029`, `0030`, and
   `0031`. Verify revision `0031` before starting the updated backend. These
   migrations add constraint schedules, baseline overrides, attributed duty
   locations, team clearance, and independent operation completion. They do not
   infer missing personnel identities or past operational timestamps.
4. Deploy the backend and dashboard together, restart the backend, and refresh
   dashboard clients. Check `/health`, authenticated dashboard access, routing
   availability, and the Analysis pages against the intended installation.
5. Release the companion mobile branch. The personnel interface must consume
   `dispatch.personnel_status` and `dispatch.personnel_arrived_at`; the shared
   `dispatch_status` describes the truck response. Older mobile screens cannot
   accurately represent independent personnel arrivals. Include the updated
   location-permission wording in the native build.
6. Verify one leader-first and one truck-first arrival using demo accounts and
   an isolated/demo incident. Confirm that the other responder keeps travelling
   and that the leader cannot mark truck arrival. Verify clearance separately
   from report closure.

A source merge does not run migrations, deploy services, or install a new mobile
binary. An Expo production bundle export verifies JavaScript packaging; physical
phone checks are still required for permissions and background location timing.
Only restore or roll back a deployment using its reviewed backup/recovery plan;
automatically downgrading new schema can discard data recorded after deployment.
