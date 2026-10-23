# GNN constraint-model retraining on Lightning AI

> Status: **partially implemented (2026-10-19).** See the implementation notes below.
> Paths below are relative to the repository root (`firetrackr/`).

Latest evidence: user-provided Colab CUDA/Tesla T4 schema-2 confirmation passes.
Historical and port F1 are both 0.7381443298969073; all input/initialization checks
and class/map decisions match exactly. Parameters, probabilities and regression
agree within absolute 1e-6 (zero relative tolerance). Bitwise final weights remain
informational. Notebook, champion manifest and training-source hashes match local
files. Report/provenance are preserved in
`backend/data/retraining/cuda_parity_confirmation_v2/`; CUDA was run in Colab.
Historical package versions remain unavailable. No model has been promoted;
registry, local admin retrain/review and immediate promotion/rollback APIs are
implemented. The admin Settings Model tab is wired to these APIs, including audit
and map preview. Scheduling and Lightning remain to be implemented.

Implemented prerequisites: metric segment snapping (8 m buffer, 60% coverage),
`segment_uids` persistence (migration `0025`), soft deletion, map deduplication,
and routing reloads after committed annotation changes. Main and pool engines
receive the same segment overlays; other web processes poll every 10 seconds.
Replacement engines and workers build before the active references change.
These overlays apply in **exported inference mode**, preserving the separate
experimental local GNN mode. Existing legacy annotations snap in memory until edited.

The current export has no `segment_uid`. A `geom-v1-<sha256>` fallback hashes the
direction-independent geometry rather than using `road_id`. Canonical master-layer
IDs must be reconciled with these stored IDs when the master/export is upgraded.
The original 602 block assignments were recovered from the saved GeoJSON and frozen
in `training/split_blocks.json`; no split was regenerated from current label density.
`training/audit.py` compares pre-scored outputs with paired spatial bootstrap and
churn reporting. It does **not** reconstruct features or load checkpoints.

The notebook is now available at `backend/data/final_najud_gnn_gattt.ipynb`.
Its Cell 8.1 rules are ported in `training/labels.py`. The shipped export retains
all manual flags and matches all 3,639 base road geometries. Its simplified labels
match the notebook rules exactly. `training/recover_labels.py` reconstructs a
baseline master GeoPackage with source-hash provenance, excluding model predictions.
This recovers 1,208 manual positives and 2,431 background zeros, not a new round of
field verification. Generated data lives under ignored `backend/data/retraining/`.

Champion reconstruction is now verified: notebook Cell 13 yields the same 73-column
matrix; the original checkpoint reproduces all 3,639 saved probabilities and
regression scores within `1e-5`, with zero classification changes. The largest
probability error is `3.61e-7`. The offline `versions/v1/` bundle includes its fitted
pipeline, source hashes, original export, frozen split and validation report.
Reloading that bundle reproduces its scores exactly; a paired self-audit yields
F1 difference and interval `[0, 0]`. `training/model.py` copies `SegmentGAT` verbatim,
and `training/graph.py` ports the notebook's endpoint line graph. `training/bundle.py`
checks integrity and scores saved raw features with a bundle's own pipeline.

Label snapshots and the CPU training/audit path are implemented for the original
Panabo road/feature baseline. Snapshots combine manual flags with active drawings,
retain deletion history, write hashed Parquet labels and refuse unknown identities.
Training refuses unchanged labels, ports Cell 17's optimizer/loss/early stopping,
selects thresholds on validation, exports a conservative candidate and scores both
bundles on identical current-label test sets. `LocalRunner` implements subprocess
submit/status/fetch with durable logs, a local exclusive lock, timeouts and backend
credential exclusion. It is now connected to admin retrain/review APIs and a
durable model registry (migration `0026`, applied to the configured local database on 2026-10-19).

A synthetic-label integration run trained for 94 epochs, audited and fetched a
validation-only candidate, and verified unchanged-label refusal, timeout handling,
concurrent-job rejection and an untouched champion. Full CPU training produces
exactly the same final weights as the original notebook functions on CPU. However,
the initial CPU historical metric tolerance was **not met**: baseline CPU F1 0.7143 versus
0.7381 at threshold 0.45, a -0.0239 difference against a +/-0.02 target. Candidate
synthetic reports remain promotion-ineligible. Current admin report readiness is
derived separately; subsequent Colab CUDA confirmation passes as recorded above.

Further investigation re-derived the original split with zero mismatches and
matched all 13 preparation/model/weight checks against independently executed
notebook cells and training functions on CPU. `training/parity.py` persists this
evidence, including the failed historical comparison on CPU. Local hardware is AMD Radeon;
CUDA is unavailable. The notebook identifies a T4 CUDA run but records no exact
package versions, so environment causality is unproven. A local-only allowlisted
package builder and `training/verify_cuda_parity.ipynb` prepare the next NVIDIA
runtime check. The user subsequently ran and confirmed it on Colab T4; no agent
upload or local CUDA execution occurred.

The registry and admin APIs initialize verified v1, retrain, list/status/report
and reject candidates. Transaction advisory locks and partial unique indexes guard
concurrent jobs. A background poll verifies immutable artifacts before marking
candidates ready. Job IDs commit before launch; version names carry through
training. Immediate promotion and archived rollback share `promote_version()`.
It verifies the expected champion, immutable artifacts, audit lineage, full training
settings and unchanged road/split/architecture baseline. Replacement main/pool
engines build and every worker confirms its version before the registry commits.
Failed builds/commits retain previous routing. Loaded paths drive map/snapping and
style caches; other workers poll champion changes every 10 seconds, and startup
resolves the registered champion. Only an absent/empty registry permits the fixed
export fallback. Raw GIS feature regeneration for changed roads, Lightning runner
and scheduling remain unfinished. Settings now has an admin Model tab with current
model/job state, unchanged-label guard, comparison/uncertainty, changed-class map
preview, explicit promotion/rollback confirmation, rejection and version history.
Model-update notifications use the shared WebSocket; scheduling controls wait for
the scheduling backend. Read-only summary/preview endpoints support the UI.
No live annotations were used for training, no model was promoted, and no database
migration was applied.
See [offline utilities](../training/README.md) for commands and validation scope.
The investigation and numbered steps below describe the original plan; the status
notes above record completed work and resolved blockers.

## Original design context

The constraint model is the `SegmentGAT` in
[final_najud_gnn_gattt.ipynb](../backend/data/final_najud_gnn_gattt.ipynb). At the time of this original design it existed only in
that Colab notebook, which reads from a Google Drive folder, and it has been trained by
hand, once. The app never runs it. It reads the precomputed
[best_model_predicted_constraints.geojson](../backend/data/best_model_predicted_constraints.geojson),
in two places:

- **the map**: `GET /api/routing/gnn-constraints`
  ([routing.py:68](../backend/routers/routing.py#L68)), cached in `state.gnn_constraints_cache`
- **routing**: `build_routing_engine()` calls `apply_predicted_constraints()` once at
  startup ([routing_setup.py:99-109](../backend/routing_setup.py#L99)), in the web process
  **and** in every `routing_pool` worker

The "changes" to send for retraining already have a home: the `gnn_constraints` table
([models.py:499](../backend/models.py#L499)), where admins draw `narrow_road` /
`traffic_area` polylines via [constraints.py](../backend/routers/constraints.py).

The requested pipeline is: send new labels to Lightning, retrain there, check whether
the new model beats the old one, and tell the user whether to switch. **That order is
right.** Four things found while checking the code change how it has to be built:

1. **User-drawn constraints do not affect routing today.** They are merged only into the
   map payload ([routing.py:136-160](../backend/routers/routing.py#L136)). The routing engine
   only sees the geojson. The payload even attaches a `routing_multiplier`, which
   suggests routing uses it, but it does not. As things stand, retraining would be the
   **only** way a drawn constraint could ever affect a route, and that path is slow and
   indirect. This should be fixed directly, separately from retraining (§0b).
2. **The model's output barely matters operationally.** The export is a hybrid.
   `manual_verified` segments drive routing, while GAT-only predictions become
   `gat_review_candidate` with `routing_constraint_type = "normal"`, because
   `APPLY_GAT_ONLY_TO_ROUTING = False`. A better model mostly means a better *review
   queue* of roads that might be constrained. That is worth having, but the promote
   decision is low-stakes, and the UI should say so rather than present it as a
   safety-critical switch.
3. **"Better than the last" can't be judged from the saved metrics.** Each retrain has
   new labels, and Cell 12 **re-derives the spatial split from label density**, so the
   test blocks move whenever labels change. Comparing the new model's test F1 with the F1
   stored in the old checkpoint compares different exams. The old model may even have
   *trained* on blocks that are now test blocks. Both models have to be scored on the
   same frozen test blocks against the current labels.
4. **The current champion can't be re-scored yet.** Scoring needs its fitted scaler and
   encoder. Cell 37 was fixed to save `feature_pipeline.{joblib,json}`, but the checkpoint
   in [backend/ai/models/](../backend/ai/models/) (dated Jun 2) predates that fix, and no
   `feature_pipeline*` file exists anywhere in the repo. Until the champion is
   re-exported, the first audit has nothing to compare against.

Outcome: an admin clicks **Retrain**. A Lightning job trains a challenger on a snapshot
of the current labels and scores it head-to-head against the champion on a frozen test
set. The app then shows a report card with a **Recommend / Don't recommend** verdict and
a **Promote** button. By default, promotion is **scheduled for the next quiet window**
(03:00 Asia/Manila). **Promote now** and **Roll back** are immediate. Nothing swaps
without an admin's approval.

## Decisions taken

- **Human approves every promotion.** The audit recommends and the admin decides. Labels
  are few and noisy, so an automatic swap on a metric difference within the noise is the
  wrong default.
- **Promotion is scheduled by default, not immediate.** Swapping models rebuilds the
  routing engine and restarts the routing workers, and the map changes under the
  dispatcher's eyes. Doing that mid-shift or mid-dispatch is avoidable disruption. The
  approval happens whenever the admin reviews it; the switch happens at 03:00 Manila
  time, mid night-shift, well clear of the 08:00 cutover
  ([shift_utils.py](../backend/shift_utils.py)). **Promote now** remains for when it's
  wanted. **Roll back is always immediate**, because rolling back is an emergency.
- **The backend pushes a label snapshot to Lightning. Lightning never touches the DB.**
  Supabase credentials never leave the backend. The snapshot is also a reproducible
  artifact: its hash is stored with the model version it trained.
- **Labels are keyed on `segment_uid`, never `road_id`.** `road_id` is positional and
  shifts on any re-export.
- **The test split is frozen, once.** A persisted `split_blocks.json` maps each 500 m
  grid block to train/val/test. A block that appears later is assigned by a hash of its
  id, never by re-stratifying.
- **GAT only.** The GCN and GraphSAGE runs in Cell 18 were for the thesis comparison and
  are dropped from the retrain script.
- **The threshold comes from the validation search** (`threshold_search_conservative`),
  and the chosen value is stored in the bundle. Cell 37 hardcodes 0.45 on every run.
- **The audit runs inside the Lightning job.** One environment trains and scores, so
  there is no sklearn or torch version skew between them. The backend only reads the
  resulting `report.json`.
- **Lightning goes behind an adapter** (`services/retrain_runner.py`), so Colab or a local
  CPU run can replace it. The graph is one city's road line graph and 700 epochs of a
  2-layer GAT run in minutes on CPU, so Lightning is a convenience (keeping heavy
  training off the web host), not a requirement. A local runner is also the test double.

## Architecture

```
admin: [Retrain]
   │
   ▼
backend  ── 1. snapshot labels ─▶ labels_<hash>.parquet + manifest.json
   │        (master layer ⊕ active gnn_constraints, snapped to segment_uid)
   │── 2. upload snapshot + champion bundle + split_blocks.json ─▶ Lightning Studio
   │── 3. start Job: python train_constraints.py && python audit.py
   │── 4. poll status (background task, advisory lock = one job at a time)
   ▼
Lightning job ─▶ challenger bundle/ (checkpoint, feature_pipeline.json, threshold,
   │               predicted_constraints.geojson) + report.json
   ▼
backend  ── 5. download to ai/models/versions/<v>/, model_versions row → "candidate"
   │── 6. WS broadcast "model_candidate_ready" → notification
   ▼
admin: report card → [Schedule promotion (03:00)] / [Promote now] / [Reject]
   │
   ▼
model_versions row → "scheduled", scheduled_promote_at = next 03:00 Manila
   │
   ▼  (promoter loop, one worker, advisory lock, every 60 s)
at due time: guards pass? ── no ─▶ defer 15 min / skip to next night / cancel + notify
   │ yes
   ▼
backend  ── 7. flip active version, invalidate caches, rebuild routing engine,
                recycle routing_pool, broadcast "model_promoted"
```

## Implementation

### 0. Prerequisites (do first, independent of Lightning)

**a. Re-export the champion with its feature pipeline.** Re-run notebook Cells 13→37 on
the existing weights. The sklearn refit is deterministic, so no retraining is needed.
Commit `feature_pipeline.json` beside the checkpoint as `ai/models/versions/v1/`. Also
run from Cell 4 once, so `segment_uid` reaches the export.

**b. Make drawn constraints reach routing directly.** In `build_routing_engine()`, after
`apply_predicted_constraints()`, load the active `gnn_constraints` rows and apply their
multipliers to the segments they cover. On create, update or delete in
`constraints.py`, rebuild the engine through the same path promotion uses (§7). With
this fix, a drawn constraint takes effect in routing **immediately**. Retraining then
only improves predictions on the roads nobody has drawn. That is its real job.

**c. Carry `segment_uid` and `annotation_source` through `_CONSTRAINT_PROP_KEYS`.** Both
are currently dropped. The dedupe in §1 needs `segment_uid`, and the report card's
new-vs-verified counts need `annotation_source`.

### 1. Snap drawn constraints to segments

- Migration: `gnn_constraints.segment_uids` (JSON array). On create and update, snap the
  polyline to the road segments it covers (buffer ≈ 8 m, keep segments with ≥ 60 % of
  their length inside) and store their `segment_uid`s.
- Also add `is_active` soft delete to the DELETE route (it currently hard-deletes). A
  constraint an admin deliberately removed is evidence too: it should *not* be a
  positive label. The snapshot must not silently forget that it ever existed.
- **Dedupe:** in the map endpoint, skip geojson features whose `segment_uid` is covered by
  an active drawn constraint. After a retrain, those segments would otherwise show twice,
  once as the drawn overlay and once as a manual_verified or predicted feature.

### 2. Label snapshot (`backend/services/label_snapshot.py`)

Build one row per segment:

| column | source |
|---|---|
| `segment_uid` | road layer |
| `is_narrow`, `narrow_severity`, `traffic_*`, `is_construction` | master layer (QGIS ground truth, as today) |
| overlay | active drawn rows: `narrow_road` → `is_narrow=1` (severity unknown → score 0.55); `traffic_area` → `traffic_general=1` (0.70) |

Then apply the Cell 8.1 rules (`simplify_constraint_for_gnn`) to get `is_constrained` and
`constraint_score`. Write `labels_<sha256>.parquet` plus `manifest.json` (hash, counts per
type, number of drawn rows folded in, created_at, created_by). **Retrain is refused
unless the label hash differs from the champion's.** Training twice on the same labels
proves nothing.

Open point to settle with the user: the master layer lives in Google Drive
(`bfp_capstone_newrc/roads_panabo_master_constraints.gpkg`). It needs a copy in
`backend/data/` so the snapshot is built from something the backend owns.

### 3. Port the notebook to a script (`training/`)

This is the largest single piece. The notebook depends on Colab (`drive.mount`,
`/content/drive` paths, globals shared between cells).

- `training/features.py`: Cells 9–11 and 13 (barangay join, proximity, geometry and
  topology features, scaling fitted on train only). Pure functions.
- `training/graph.py`: Cell 14 (line graph).
- `training/model.py`: `SegmentGAT` copied **verbatim** from Cell 16. Do not reuse
  `backend/ai/gnn_models.py`: its `GAT` is a different, incompatible architecture.
- `training/split.py`: loads `split_blocks.json` and assigns unseen blocks by hash. It
  replaces Cell 12's re-stratification.
- `training/train_constraints.py`: CLI `--labels --split --out`. Trains the GAT with the
  Cell 17/18 settings (`epochs=700, lr=0.002, patience=80, hid=64, heads=4,
  dropout=0.35`, seed fixed), runs the validation threshold search, and exports the bundle
  (checkpoint, `feature_pipeline.json`, `threshold`, the Cell 21 hybrid geojson).
- **Parity check before trusting it:** with the frozen split set to the notebook's split,
  the script must reproduce the notebook's GAT metrics within noise. If it can't, the
  port is wrong.

### 4. Frozen split (`training/split_blocks.json`)

Generate it once from the current Cell 12 output and commit it. Keep it fixed. Changing
it resets the comparison history, so a re-split is a deliberate, versioned event
(`split_version` is recorded in every report).

### 5. Audit (`training/audit.py`)

Rebuild features for **both** bundles, each with *its own* `feature_pipeline.json`, and
score both on the frozen test blocks against the **snapshot's** labels.

- Metrics: precision, recall, F1, balanced accuracy, and PR-AUC (threshold-free, so a
  threshold change cannot mask a weaker model).
- **Paired bootstrap over test blocks** (resample blocks, not segments, because segments
  in a block are correlated), 2 000 draws, giving `P(challenger F1 > champion F1)` and a
  95 % CI on the F1 difference.
- **Decision rule** → `recommendation`:
  - `recommend` if P ≥ 0.90 **and** recall does not drop by more than 2 pts (a missed
    narrow road costs more than a false alarm)
  - `no_clear_difference` if the CI straddles 0. The text: "equivalent; promoting is
    harmless and folds in the new labels."
  - `do_not_recommend` otherwise
- Also report a **churn** list: segments whose predicted class flips between the models,
  split by `annotation_source`. That is the concrete "what would change on the map"
  answer, and a reviewer can scan it.
- Warn when the test set holds fewer than ~30 positives. The verdict is then marked
  low-confidence whatever P says.

Output: `report.json` (schema-versioned).

### 6. Lightning runner (`backend/services/retrain_runner.py`)

An interface with a `LightningRunner` and a `LocalRunner` behind it:
`submit(snapshot_dir, champion_dir) → job_id`, `status(job_id)`,
`fetch(job_id, dest_dir)`.

- Lightning side: one Studio in the team's Teamspace, with `training/` and a pinned env
  (`torch==2.5.1`, `torch-geometric==2.7.0`, the same as
  [requirements.txt](../backend/requirements.txt)). Upload inputs to the Studio, launch a
  Job with the `lightning_sdk` Python SDK on a CPU machine (T4 only if CPU runtime turns
  out to be a problem), and download the output dir when it finishes. **Check exact SDK
  calls against current `lightning_sdk` docs when building. Don't code from memory.**
- Env: `LIGHTNING_USER_ID`, `LIGHTNING_API_KEY`, `LIGHTNING_TEAMSPACE`, `LIGHTNING_STUDIO`,
  `RETRAIN_RUNNER=lightning|local`, `RETRAIN_TIMEOUT_MIN=60`.
- Poll from a background task. Take a **Postgres advisory lock** so only one retrain runs
  across web workers (Supabase is on session mode, which the existing lock already
  relies on).
- Timeout or job failure → the version row goes to `failed` with the job log tail
  attached. Nothing is left half-installed, because files land in a fresh
  `versions/<v>/` dir.

### 7. Model registry and promotion

- Table `model_versions`: `version`, `status` (`training | failed | candidate | scheduled
  | champion | rejected | archived`), `label_hash`, `split_version`, `threshold`, `metrics`
  (JSON), `report` (JSON), `job_id`, `created_by`, `created_at`, `promoted_by`,
  `promoted_at`, plus the scheduling columns from §7a.
  Seed `v1` = the re-exported current model, as `champion`.
- Files live in `backend/ai/models/versions/<v>/`. `Config.PREDICTED_CONSTRAINTS_PATH`
  resolves through the champion row instead of the fixed filename. At startup, fall back
  to the current file if the table is empty.
- `POST /api/models/{v}/promote` (admin): in one transaction, champion → archived and
  candidate → champion. Then clear `state.gnn_constraints_cache`, rebuild the web
  process's routing engine, and **recycle `routing_pool`** (each worker built its own
  engine at spawn). Broadcast `model_promoted`.
  - Multi-worker: other web workers don't see the in-process cache clear. Have each
    worker check the champion version against its loaded version (cheap query, reuse the
    10 s poll cadence) and rebuild on mismatch.
- **Roll back** = promote the archived version. Same endpoint, no special path, always
  immediate. A rollback also cancels any pending schedule, since it signals that
  something is wrong.
- `POST /api/models/retrain`, `GET /api/models`, `GET /api/models/{v}/report`,
  `POST /api/models/{v}/reject`.
- Put the swap itself in one function, `promote_version(db, v, actor)`. The endpoint and
  the scheduler (§7a) both call it, so the two paths cannot drift apart.

### 7a. Scheduled promotion (`backend/services/model_promoter.py`)

**Columns** on `model_versions`:

- `scheduled_promote_at` (timestamptz, stored in UTC)
- `scheduled_by`
- `scheduled_against_version`: the champion at the moment of scheduling
- `defer_count`
- `schedule_note`: the last defer or skip reason, shown in the UI

**Endpoints:**

- `POST /api/models/{v}/schedule-promotion`, body `{ "at": <iso> | null }`.
  - `null` → the next `MODEL_PROMOTION_HOUR` (default `3`) in `SHIFT_TZ`. If that is less
    than 30 min away, use the following night instead, so an admin approving at 02:50
    doesn't trigger a swap ten minutes later with no notice.
  - Allowed only from `candidate`. It sets status `scheduled`.
  - **Only one version can be scheduled at a time.** Scheduling another returns the
    previous one to `candidate`, and the response says so.
- `DELETE /api/models/{v}/schedule-promotion` → back to `candidate`.
- `POST /api/models/{v}/promote` stays as **Promote now**.

**Loop:** `_model_promoter()` wakes every 60 s. It is started in `main.lifespan` behind its
own advisory lock (`_MODEL_PROMOTER_LOCK_KEY`), the same pattern as
[watchdog.py](../backend/services/watchdog.py), so exactly one worker runs it. Each tick
selects the `scheduled` row whose `scheduled_promote_at <= now()` with `FOR UPDATE SKIP
LOCKED` and checks three guards in order:

1. **The champion has changed since scheduling.** Someone promoted or rolled back in the
   meantime, so the candidate's audit was against a model that is no longer live.
   **Cancel**: back to `candidate` with a note, and notify "re-run the audit or promote
   manually".
2. **A dispatch is active** (any `DispatchRecord` in `dispatched | en_route`). Swapping
   the engine mid-response could change a reroute while a crew is driving.
   **Defer 15 min** and increment `defer_count`. After 3 h of deferring (`defer_count ≥
   12`), **skip to the next night** and notify.
3. **The schedule is overdue by more than 1 h** (the server was down at the due time).
   Don't fire mid-morning on the next boot: **skip to the next night** and notify.

If all three pass, call `promote_version()`. Then broadcast `model_promoted` with
`scheduled: true`, so the notification reads "Model v4 went live at 03:00 as scheduled".

**Failure handling:** if `promote_version()` raises (bad files, engine rebuild fails),
roll back the transaction. The champion row is untouched, and the old engine stays loaded
because it is only replaced after the new one builds. The version goes to `candidate`
with the error in `schedule_note`, plus an alert notification. Never retry a failed swap
automatically.

**Config:** `MODEL_PROMOTION_HOUR=3`, `MODEL_PROMOTER_INTERVAL_SECONDS=60`,
`MODEL_PROMOTION_DEFER_MINUTES=15`, `MODEL_PROMOTION_MAX_DEFER_HOURS=3`.

The existing Constraints view also now has an explicit editing-mode toggle. It
opens a left-side layers list with barangay/source filters, search, location/name
sorting, selection and local visibility. Incident and action panels hide until
editing ends. Existing drawing edits/deletions remain distinct from read-only
baseline/model layers. Save failures retain drafts and routing feedback is shown.

### 8. UI

A **Model** tab in Settings (admin only):

- Champion card: version, trained-on date, label count, threshold, key metrics.
- **Retrain** button: disabled while a job runs, or when labels haven't changed since
  the champion ("No new labels since v3"). It shows how many drawn constraints will be
  folded in.
- Candidate report card: verdict badge, champion-vs-challenger metric table with the F1
  difference ± CI, and a one-paragraph plain-language explanation generated from
  `report.json`. Keep it honest: for `no_clear_difference`, say so. Include the churn
  count ("47 roads would change on the map, 3 of them already verified") with a
  **Preview on map** toggle that draws the challenger geojson over the champion's.
- **Schedule promotion** (primary button, "Goes live tonight at 3:00 AM"), with a
  time picker for another slot. **Promote now** is a secondary action behind a
  confirmation. **Reject**.
- Scheduled state: a banner on the champion card, "v4 scheduled to replace v3 at 3:00 AM
  (Tue)", with **Cancel**. When a defer or skip happened, show `schedule_note`, e.g.
  "Deferred: dispatch in progress (2×)".
- Version history with **Roll back** (immediate).
- Hook into the existing notification system under a new *Model updates* toggle:
  `model_candidate_ready`, `model_promotion_scheduled`, `model_promoted`, and
  `model_promotion_deferred`. The last one is sent for skip-to-next-night and cancel,
  **not** for every 15-min defer.

## Verification

1. `LocalRunner` end-to-end with **unchanged labels** → retrain is refused (hash match).
2. Draw one constraint → retrain → the challenger trains. The audit runs **both** models
   on identical test blocks: assert the test `segment_uid` sets match in `report.json`.
3. Parity: the script on the notebook's split reproduces the notebook GAT F1 within ±0.02.
4. Sanity audit: champion vs itself → F1 difference exactly 0, `no_clear_difference`.
5. Promote → map layer updates without restart. A route across a newly promoted
   constraint changes cost in the web process **and** in a pool worker (dispatch
   through `routing_pool`).
6. Roll back → the previous geojson is served and routes revert.
7. §0b: draw a constraint → a route through it gets costlier with **no** retrain.
8. Scheduling (set `scheduled_promote_at` to now + 2 min to test):
   - It fires within one tick, the map and routes switch, and `model_promoted` carries
     `scheduled: true`.
   - With an active dispatch it defers, and `defer_count` rises every 15 min. It stays
     silent until the 3 h cap, then skips to the next night and notifies once.
   - Promote a different version manually before the due time → the schedule is
     cancelled with a note.
   - Stop the server past the due time and restart more than 1 h late → it skips to the
     next night and does not fire.
   - Run 2 web workers → exactly one promoter loop, so exactly one promotion.
   - Force the engine rebuild to fail → the champion is unchanged and routing still
     works on the old engine.
   - Scheduling at 02:50 with the default time → resolves to the *next* night.
9. `LightningRunner` once for real. Force a failure (bad label path) → the row ends
   `failed` with the log tail, and the champion is untouched.

## Out of scope

- Promotion without approval. Scheduling only delays a promotion an admin already
  approved; the audit never promotes on its own.
- Scheduled retraining. Add a cron later if labels start arriving
  steadily; the retrain endpoint is already the hook.
- Changing `APPLY_GAT_ONLY_TO_ROUTING`. Letting model-only predictions affect routes is a
  policy decision, separate from which model is champion.
- Fitting the routing multipliers in `constraint_style_config.json`. That is a different
  problem (they are hand-picked), and the eta_validation work is where it belongs.
- Regions other than Panabo (no master layer, no model).
