# Supabase report photo setup

This is the first deployment step: move report image files to Supabase Storage.
The application database can stay local while storage is tested. FastAPI still
owns login, team-leader upload checks and administrator report access. The mobile
multipart upload and the report JSON `photos` array keep their existing shapes.

## 1. Create the project

1. Open the [Supabase dashboard](https://supabase.com/dashboard) and create a project.
2. Choose your organization, name it `firetrackr`, and select the Free plan for
   initial testing. Select Southeast Asia (Singapore) when available.
3. Generate a strong database password and save it privately. This password is
   for the later database migration, not the Storage API credential.
4. Wait for the project to finish provisioning.

## 2. Create a private bucket

1. In Storage, create a bucket named `report-photos`.
2. Keep **Public bucket disabled**. The backend checks this at startup and refuses
   a public bucket in Supabase mode.
3. Set a 10 MB per-file limit and allow `image/jpeg`, `image/jpg`, `image/png`,
   `image/webp`, `image/heic`, and `image/heif`, matching the current upload API.
4. Do not add public upload or download policies. The backend performs authorized
   operations with a server secret; browser/mobile clients do not need a Supabase key.

## 3. Configure the backend privately

Copy the project URL and a **secret API key** (`sb_secret_...`) from project
settings/API keys into `backend/.env`, or into the backend host's secret variables:

```dotenv
REPORT_PHOTO_STORAGE=local
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-backend-secret-key
SUPABASE_REPORT_PHOTO_BUCKET=report-photos
REPORT_PHOTO_URL_TTL_SECONDS=3600
```

Keep `REPORT_PHOTO_STORAGE=local` until existing files have been copied. A legacy
`service_role` JWT can also be supplied as `SUPABASE_SECRET_KEY`, or through the
fallback `SUPABASE_SERVICE_ROLE_KEY` variable. New secret keys use the `apikey`
header; legacy JWTs additionally use Bearer authentication.

Never paste secret values into chat, commit `.env`, or put the key in frontend
`VITE_*`, mobile `EXPO_PUBLIC_*`, or `google-services.json`. Leave `DATABASE_URL`
unchanged during this storage-only step. No SDK installation or database schema
migration is needed for photo storage.

## 4. Copy existing photos, then switch

1. Stop report submissions briefly so the copy cannot miss newly uploaded photos.
2. Back up `backend/uploads/report_photos/`.
3. Upload the files from that directory to the **root** of the private
   `report-photos` bucket, preserving every filename. Do not upload the containing
   directory, rename objects or overwrite different objects.
4. Compare names/counts and spot-check the uploaded files. Database `file_name`
   values are the object keys, so no database updates are required. All existing
   report photos must be copied before switching; there is no local/public fallback.
5. Set `REPORT_PHOTO_STORAGE=supabase` and restart FastAPI. Startup checks that
   the bucket exists and is private. This mode also removes the local `/uploads`
   static mount so retained disk copies are not publicly served by the API.

## 5. Verify before hosting the backend

- Sign in as an administrator and open an existing report. Photos should load
  from `/storage/v1/object/sign/report-photos/...` on the Supabase hostname.
- Submit a new report as the assigned team leader on an intended test incident.
  Verify that photos appear in the bucket, the report opens, the incident closes,
  and the responding teams are released normally.
- Verify a signed-out user cannot fetch report data, unassigned personnel cannot
  upload, and a Supabase public-object URL cannot read the private photo.
- Restart the backend and verify photos still load. Viewing links last one hour
  by default; reopening/refetching the report requests fresh links.

Completed uploads are removed if a later upload, link-signing operation, or database
commit fails. Incident deletion removes its objects after the database commit.
Cleanup errors are logged and do not turn a committed deletion into a failed
response. A process crash, ambiguous network timeout, or failed cleanup can still
leave an unreferenced object; review storage when those errors occur.

Retain the local backup until verification is complete. Switching back to local
mode only works after copying any photos uploaded since the switch back to the
local photo directory with their original names. Free-plan storage and egress
quotas still apply.

## Local verification (2026-11-02)

- 42 backend storage/report checks pass against a fresh disposable PostGIS
  database migrated through revision 0032; Supabase HTTP requests are mocked.
- 23 focused dashboard report checks and the production build pass. The changed
  API module passes ESLint; full-project lint reports 22 existing errors and
  2 warnings in other files. Python compilation and diff whitespace checks pass.
- The dependency audit reports 2 existing high-severity entries in the
  `image-size`/`pptxgenjs` chain. Report-photo reachability was not established;
  this change does not update those dependencies. Python `pip-audit` is not installed.
- Those implementation checks used mocked cloud requests. Live Storage results
  are recorded below; physical-phone report submission is still unverified.

## Live Storage activation (2026-11-02)

- The configured bucket was verified private, with a 10 MiB upload limit and
  the six MIME types listed above. Server credentials were used without logging
  their values or the signed links.
- The local database referenced two photos; both were uploaded without
  overwriting remote objects. Authenticated downloads and signed-link downloads
  matched their local SHA-256 hashes. Public-object access was denied.
- All six local image files and the pre-switch backend environment were backed
  up under the workspace's `local-backups/` directory. The four unreferenced
  local files were retained locally and were not uploaded.
- Only `REPORT_PHOTO_STORAGE` was switched to `supabase` in the private backend
  environment, then the existing Uvicorn development server was reloaded.
  `/health` reported both API and database `ok`; the old local photo URL returned
  404, and an unauthenticated report read returned 401. Both private photo links
  were verified again after the reload.
- The application database remains local and was queried only in read-only
  transactions during this migration. No report records were changed. Native
  mobile submission of a new report and dashboard visual acceptance remain to
  be checked separately; this step does not deploy the API or dashboard publicly.

## References

- [Storage buckets and private signed links](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Server API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase regions](https://supabase.com/docs/guides/platform/regions)
- [Current storage and bandwidth quotas](https://supabase.com/pricing)
