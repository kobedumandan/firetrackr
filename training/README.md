# Constraint retraining implementation

Committed sources provide the training pipeline, artifact reconstruction and model
review services. Regression tests, the parity investigation script, Colab helper
cells, parity packaging script and CUDA verification notebook remain local under
the repository's commit policy. Commands below referencing those diagnostics need
the corresponding local files; they are not required to run the application.
Generated model bundles and validation reports also remain outside Git.

Latest CUDA confirmation **passed** (schema 2, user-provided Google Colab
Tesla T4 output). Historical and port F1 are both `0.7381443298969073`, with zero
difference. Inputs, graph, model and initial weights match exactly; class decisions
at 0.45 and map-confidence decisions at 0.65 also match exactly.

Final parameters, probabilities and regression agree within absolute `1e-6`
(zero relative tolerance). Maximum differences are respectively `1.20e-7`,
`2.99e-7` and `4.44e-7`. Bitwise final-weight equality remains informational.
The historical F1 tolerance, split, seed, thresholds and hyperparameters are unchanged.
Historical package versions remain unavailable, so this does not establish the
cause of the earlier CPU/CUDA difference.

The supplied report and provenance are saved under the ignored local directory
`backend/data/retraining/cuda_parity_confirmation_v2/`. Its notebook, champion
manifest and five training-source hashes match the local files. CUDA execution
was performed in Colab; the full Colab artifact ZIP has not been imported locally.
Activation requires explicit admin promotion of a registered, eligible model. Older CPU
findings and schema-1 results below are retained as investigation history.

`training/colab_confirm_parity_cell.py` can repeat confirmation in an existing Colab
session using the installed GPU environment and the updated local `training/parity.py`.
It checks the diagnostic source hash before execution and saves both final weights.

Admin model registry APIs are implemented with migration `0026` (applied to the configured local database on 2026-10-19).
They track local training, review, immediate promotion and archived rollback.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| POST | `/api/models/initialize` | Register verified v1 after checking it matches the active export; idempotent |
| GET | `/api/models?limit=50&offset=0` | Paginated history; no initialization or writes |
| GET | `/api/models/summary` | Current champion/job, current label counts and unchanged-label guard |
| GET | `/api/models/{version}/preview` | Only changed-class road geometry and safe display properties |
| POST | `/api/models/retrain` | Return 202 with job/version; refuse unchanged labels or an active job |
| GET | `/api/models/{version}` | Persisted job/version status |
| GET | `/api/models/{version}/report` | Audit, current activation readiness and expected champion |
| POST | `/api/models/{version}/reject` | Reject a candidate and record the admin/time |
| POST | `/api/models/{version}/promote` | Explicitly promote a candidate or roll back to an archived version |

Every endpoint requires an admin JWT. Run reviewed migrations on the intended
PostgreSQL database, generate the verified v1 bundle, then initialize before
retraining. No migration or registry write has been performed against a live DB.
The API uses the original v1 feature baseline plus current annotations, retaining
tombstones. It fixes the notebook's training parameters; clients supply no paths,
labels or hyperparameters.

`RETRAIN_RUNNER=local` is the only supported runner. `RETRAIN_PYTHON` defaults to
the repository's `.venv-training` interpreter; `RETRAIN_TIMEOUT_MIN` defaults to
60. The web environment also needs `pyarrow` for snapshots. Jobs and snapshots
live under ignored `backend/data/retraining/registry/`. All web workers must share
this artifact/job filesystem. Each worker polls every 10 seconds; a PostgreSQL
transaction advisory lock serializes registry writes and result imports. Partial
unique indexes enforce one training reservation and one champion. The runner's
filesystem lock independently excludes concurrent local processes.

Job IDs commit before process launch. A later web worker can fetch a terminal
result after restart; an unsubmitted reservation fails after two minutes.
Candidate installation verifies hashes, label/split/champion provenance and version
identity, and rejects synthetic-validation artifacts. Candidate-ready/failed
events broadcast after commit; the status endpoint is the durable source of truth.
Interrupted operating-system jobs that never write a terminal status require
inspection and are not automatically relaunched. Polling never starts training
or activates a model.

Validation covers disposable SQLite service/API tests with PostgreSQL advisory
locks mocked explicitly, offline PostgreSQL migration SQL, and a full synthetic
local retrain. Live PostgreSQL locking and deployment flows still require an
intended test database. Registry checks can be run from the repository root:

```powershell
.\backend\venv\Scripts\python.exe -m unittest backend.tests.test_model_registry -q
```

Immediate activation uses `POST /api/models/v2/promote` with JSON
`{"expected_champion": "v1"}`. Read the report first; the expected champion guards
against acting from stale review state. Candidates audited against another
champion are refused. Archived versions use the same endpoint for immediate
rollback, retaining their original audit history. Audit recommendations remain
advisory: the admin decides after reviewing the metrics and warnings.

`services/model_promoter.py` verifies the registered manifest digest, audit and
training lineage, fixed full training settings, original architecture/split, road
identities/geometry and finite routing multipliers >= 1. It requires Panabo
exported inference with RL/SUMO disabled. Synthetic/partial-training bundles are
refused. The v1 rollback uses its original configured style file; subsequent
candidates carry a style artifact in their hashed bundle.

A registry transaction lock covers preparation and commit. Main and all pool
workers load explicit model paths and current annotation overlays; each worker
PID must report the selected version before the champion changes. Failed builds
or commits discard prepared objects. Successful commit archives the old champion,
records the promoting admin/time, then installs ready main/pool objects on the
event loop and invalidates map/style/coverage caches. Already submitted routing
work finishes on its original pool. Cancellation waits for preparation to finish
and installs any committed result. A process crash after commit is recovered by
startup/polling; other web processes converge on their next 10-second poll.
There is no instantaneous cross-process swap.

Startup resolves the champion registry row. A missing pre-0026 table or empty
registry permits the original configured export fallback. An unavailable DB,
corrupt registered artifacts or history without a champion prevents replacement;
an already loaded engine remains available. Map and segment snapping use the
loaded source, and generation checks prevent old requests from restoring stale
caches. `/api/routing/status` exposes the locally loaded `model_version`.
`model_promoted` is broadcast after commit/install. Scheduling is not implemented;
immediate changes also reset any reserved `scheduled` statuses to candidates.

Promotion was tested on disposable SQLite with PostgreSQL locks mocked, including
commit/build failures, stale review state, bad exports and request cancellation.
A separate offline Panabo check built actual graphs and two spawned workers using
a selected export, then restored the baseline with a fresh pool. No live registry
promotion or DB migration was performed. From `backend/`:

```powershell
.\venv\Scripts\python.exe -m unittest tests.test_model_promotion -q
.\venv\Scripts\python.exe tests/check_model_source_pool.py
```

The admin **Settings ? Model** tab now connects these APIs. It shows the current
model, threshold and recorded metrics/counts, unchanged-label state, active job,
candidate audit with uncertainty, class-change preview, rejection, explicit
promotion/rollback confirmations, and paginated version history. V1's creation
stamp is labelled Registered; missing historical metrics are shown as unavailable.
Scheduling controls are deferred until the scheduling backend is implemented.

The summary endpoint reads current annotations and calculates the effective label
hash without writing a snapshot or starting training. Preview sends only audited
class-flip geometries, segment names/identities and before/after classes. The map
is a read-only view, loaded on demand; previewing never activates a model. All new
endpoints require admin authorization. The UI polls every ten seconds while open,
uses the shared App WebSocket for updates, aborts stale requests and prevents
concurrent actions. Confirmation preserves the reviewed champion ID; server
readiness remains authoritative. A Model updates notification preference controls
candidate-ready, training-failed and promoted notifications. Promotion invalidates
browser constraint/coverage caches and refreshes the mounted constraint layer.

Frontend checks cover admin visibility, unavailable/empty states, unchanged-label
and active-job guards, double clicks, failed submissions/promotions, confirmation,
stale report responses and event refresh. All current frontend tests and the
production build pass. Full-repository ESLint still reports existing errors in
other dashboard components; targeted lint for the new Model components, Settings,
API helpers and notification preferences passes. Database/migration and real
browser/deployment validation remain separate; no live job or promotion was run.


Constraint editing now has an explicit mode in the GAT constraints panel. Entering
it opens a left-side layers panel, hides Incident View and map actions, and hides
the Incidents navigation item. Other map views and 3D style are unavailable until
editing ends. Drawing starts only inside this mode. Existing admin drawings can
be selected, edited or deleted; baseline/model layers remain read-only and can be
used as the reference for a correction drawing.

The layers list combines non-normal exported constraints and saved drawings,
without duplicating custom features from the merged export. It supports search,
barangay and source filters, and sorting by barangay/name or geographic north/west.
Drawing locations use their line midpoint and loaded barangay boundaries; unknown
locations remain selectable. Filters change the list only. Layer visibility and
highlighting apply to this editing view and do not alter saved routing costs.
Selecting a row focuses the map. Large lists reveal 100 rows at a time.

Done restores the incident and action panels; an unsaved drawing requires discard
confirmation. Save errors retain the dialog and draft, duplicate saves are blocked,
and successful saves distinguish pending routing refresh and unmatched drawings.
Entering mode cancels incident picking. Login/logout reset the transient mode.

Validation: 105 current frontend tests and the production build pass, including
mode entry/exit with real map controls mocked, layer selection/visibility, location
filters and failed-save retry. Live database writes and visual browser validation
were not performed. Migrations `0025` and `0026` were subsequently applied to the configured local database on 2026-10-19; both constraint read handlers returned successfully (3,639 GAT features).

Champion reconstruction is **verified**. The existing GAT checkpoint, a pipeline
refitted only on its original 2,420 training rows, and the notebook's line graph
reproduce all 3,639 saved outputs. Maximum probability error is `3.61e-7`, maximum
regression error is `3.74e-7`, and classification mismatches are zero at both 0.45
and the map-confidence threshold of 0.65. The reconstructed matrix is bit-for-bit
equal to notebook Cell 13's matrix on the saved raw features. This establishes
reconstruction parity, not a new accuracy measurement or field calibration.

The offline bundle is `backend/ai/models/versions/v1/`: checkpoint, portable fitted
JSON pipeline, original export, frozen split, scores, validation report and a
checksum manifest. Generated bundles and the isolated environment are ignored by
Git. This bundle has not been registered in the database or promoted into routing.
The active routing export and `.env` are unchanged.

Reproduce from the repository root using an isolated environment:

```powershell
uv venv .venv-training --python .\backend\venv\Scripts\python.exe
uv pip install --python .\.venv-training\Scripts\python.exe torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .\.venv-training\Scripts\python.exe -r training/requirements-lock.txt
.\.venv-training\Scripts\python.exe -m training.reconstruct_champion --export backend/data/best_model_predicted_constraints.geojson --checkpoint backend/ai/models/best_gat_manual_threshold_model.pt --split training/split_blocks.json --out backend/ai/models/versions/v1
```

The reconstruction command refuses an existing output directory and creates no
bundle if parity fails. `requirements.txt` pins direct dependencies;
`requirements-lock.txt` records all packages in the verified CPU environment.
`features.py` keeps fitted parameters and ordered categories in JSON and ignores
unknown categories without refitting. `model.py` preserves `SegmentGAT` verbatim
from notebook Cell 16; `graph.py` ports Cell 14's endpoint adjacency and edge order.

`bundle.py` verifies checksums and scores with each bundle's own saved pipeline:

```powershell
.\.venv-training\Scripts\python.exe -m training.bundle --bundle backend/ai/models/versions/v1 --features backend/data/best_model_predicted_constraints.geojson --out backend/data/retraining/recovered_master_v1/champion_replayed_scores.json
```

Replayed scores exactly match the initial reconstruction scores. Auditing those
against each other gives F1 difference and interval `[0, 0]`, with verdict
`no_clear_difference`. Input features currently come from the original export;
rebuilding barangay/proximity/geometry features from a changed road layer remains
part of the training port. The verified pipeline must not be refitted when scoring
new labels or comparing a future challenger.

The backend now stores snapped segment identities and retains deleted annotations.
Active drawings override the corresponding segment costs in exported inference mode.
Saving a drawing rebuilds the main engine and a warmed pool in background threads,
then swaps both references. Other web processes poll committed annotations every
10 seconds. Existing submitted pool work finishes on its original graph. A failed
replacement leaves the previous engine and pool loaded and the poller retries.
Create/update responses include `segment_uids` and `routing_applied` (refresh success).
An empty segment list means the drawing did not meet the coverage rule and affects
no road cost. Experimental local GNN inference continues to skip exported overlays.

Apply migration `0025` to the intended database before starting the updated backend:

```powershell
cd backend
.\venv\Scripts\python.exe -m alembic upgrade head
```

No migration has been run as part of implementation validation. The existing
`is_active` column is reused for deletion; `0025` adds only nullable JSON
`segment_uids`. Legacy NULL identities are snapped in memory; editing the row
persists them. The 8 m buffer and 60% coverage are calculated in EPSG:32651.
Legacy segment identity is `geom-v1-` plus a hash of rounded WGS84 coordinates,
independent of line direction. Geometry changes alter this fallback identity.
When canonical `segment_uid` values arrive, reconcile existing annotations before
replacing the export. Positional `road_id` values are never annotation identities.

`split_blocks.json` preserves all 602 blocks from the shipped constraint export:
2,420 train, 617 validation and 602 test segments. It includes the source hash and
assigns future blocks by SHA-256 (70/15/15). The generation command refuses to
overwrite an existing manifest. These are recovered export assignments; the
champion pipeline reconstructed from those training rows reproduces the original
checkpoint's saved predictions. Future models must retain this same frozen split.

`audit.py` accepts scores already produced by each bundle with its own fitted
pipeline. Each JSON input is a list of rows with `segment_uid`, `spatial_block`,
binary `label`, `probability` in [0,1], and optional `annotation_source`.
Both inputs must cover identical segments with identical snapshot labels and blocks.
Thresholds must come from validation, never this audit's test set.

Run from the repository root:

```powershell
.\backend\venv\Scripts\python.exe -m training.audit --champion champion_scores.json --challenger challenger_scores.json --split training/split_blocks.json --champion-threshold 0.45 --challenger-threshold 0.50 --out report.json
```

The report contains precision, recall, F1, balanced accuracy, trapezoidal PR-AUC,
2,000 paired block-bootstrap draws, F1 difference and interval, probability of
improvement, identical test segment lists, and class-flip churn by annotation source.
A recall decrease over two percentage points always rejects the recommendation.
Otherwise probability >=0.90 recommends; an interval containing zero reports no
clear difference. Low positive counts or fewer than two blocks flag low confidence.
This audit does not itself approve or install any model.

Label snapshots and CPU retraining are now implemented for the verified fixed
Panabo road/feature baseline. `backend/services/label_snapshot.py` combines the
baseline manual flags with active drawings by `segment_uid`, re-runs Cell 8.1,
and writes `labels_<sha256>.parquet`, raw-feature GeoJSON, annotation history and
a manifest with source/file hashes, counts and actor/time. Deactivated drawings
remain in history and restore baseline labels; they do not override an original
manual annotation with an invented negative label. Unknown active segment IDs
are rejected. Unmatched drawings are counted but do not create labels.

Overlapping active types combine their flags; the strongest Cell 8.1 type wins.
A narrow-road drawing without inspected severity uses the 0.55 profile and
preserves stronger baseline severity. Traffic-area drawings add `traffic_general`
(0.70). System probabilities and display classes are excluded. Equivalent label
content has the same hash regardless of annotation order, timestamps or row IDs.
The snapshot loader checks both file hashes and Parquet/GeoJSON label agreement.

The offline CLI consumes a JSON list of annotation objects with `id`,
`constraint_type`, `is_active`, and `segment_uids` (or legacy coordinates).
The backend's `snapshot_from_database()` adapter reads active and deleted rows
without DB writes; the registry uses the same snapshot builder. Migration `0025` is still required
before querying those columns in the running application. Example commands from
the repository root, using an actual annotation export:

```powershell
.\.venv-training\Scripts\python.exe -m training.snapshot --baseline backend/ai/models/versions/v1/predicted_constraints.geojson --annotations backend/data/retraining/admin_annotations.json --out backend/data/retraining/snapshots/s1
.\.venv-training\Scripts\python.exe -m training.train_constraints --snapshot backend/data/retraining/snapshots/s1 --champion backend/ai/models/versions/v1 --style backend/data/constraint_style_config.json --out backend/ai/models/versions/local_candidate
```

Normal retraining refuses a label hash identical to the champion's before fitting
or creating a candidate. Changed labels train only `SegmentGAT`, with notebook
settings (700 maximum epochs, learning rate 0.002, patience 80, hidden 64, four
heads, dropout 0.35, seed 42). Train-only graph edges, AdamW, losses, scheduler,
gradient clipping and early stopping are ported from Cell 17. The vectorized
threshold search matches its validation objective; no test labels choose the
threshold. Each model uses its own fitted feature pipeline and is scored against
the same snapshot labels and frozen test blocks. The output contains an audited
candidate, original split, label provenance, threshold and training parameters,
head-to-head report, checksums and conservative hybrid GeoJSON. Model-only
predictions continue to have routing type `normal`.

`backend/services/retrain_runner.py` supplies `LocalRunner.submit/status/fetch`.
It starts hidden subprocesses, persists status/logs, limits one job per local work
root with an exclusive file marker, enforces a timeout, and fetches only complete
successful bundles into fresh directories. It passes OS/runtime settings to the
training process, excluding backend database and service credentials. This local
file lock complements the registry's PostgreSQL transaction lock and durable
single-training index.

Validation includes a full local job with one **synthetic** annotation: 94 epochs
to early stopping, identical test sets, failure/timeout handling, concurrent-job
refusal and successful fetch. Synthetic snapshots and bundles are marked
validation-only and ineligible for promotion. No live DB annotations were read or
written, no model was promoted, and no active export was replaced.

Full CPU training matches the original notebook functions **exactly, tensor for
tensor**, including the final weights. The original CPU historical comparison was
outside the planned tolerance: CPU F1 at the notebook's 0.45 threshold is
0.7143 versus the saved CUDA result's 0.7381 (difference -0.0239; target +/-0.02).
The subsequent user-provided Colab CUDA confirmation passes as recorded above.
Offline reports retain `promotion_eligible=false`: they cannot activate a model.
The admin report API derives current readiness from the registry and artifacts.
Synthetic-validation bundles remain ineligible.

The parity investigation now reproduces the notebook's original split, feature
matrix, graph, model and training functions independently in `training/parity.py`.
The full CPU diagnostic passes all 13 exact comparisons, including 2,260 training
edges, 4,024 full-graph edges, all labels/masks, and initial/final parameters.
It retains both training logs, source hashes, environment versions, trained weights,
scores and a paired block audit. The historical F1 tolerance still fails and causes
a nonzero CLI exit. A short smoke run can never clear the full-training gate.

This computer exposes AMD Radeon graphics and cannot reproduce an NVIDIA CUDA
run locally. The notebook records CUDA on a T4 but omits exact historical library
versions. Runtime differences remain a hypothesis, not an established cause.
PyTorch 2.5.1 explicitly does not guarantee identical results across CPU/GPU or
releases even with identical seeds ([official reproducibility notes](https://raw.githubusercontent.com/pytorch/pytorch/v2.5.1/docs/source/notes/randomness.rst)).
The acceptance tolerance, threshold, seed, split and hyperparameters were retained;
no test-set tuning or relaxed gate was used.

Reproduce a fresh CPU investigation (output directory must not exist):

```powershell
.\.venv-training\Scripts\python.exe -m training.parity --champion backend/ai/models/versions/v1 --notebook backend/data/final_najud_gnn_gattt.ipynb --out backend/data/retraining/parity_investigation_v1 --device cpu
```

`training/verify_cuda_parity.ipynb` prepares the remaining check in an NVIDIA GPU
Google Colab runtime, preferably T4. It bootstraps uv 0.13.0 in a private directory
and creates a separate Python 3.12 environment, allowing a newer Colab kernel
to keep its own interpreter. Every training install, CUDA probe and diagnostic
uses the isolated interpreter; no kernel restart is required. It verifies archive
hashes and paths, installs pinned CUDA PyTorch and training dependencies, runs
both implementations on that device, records the runtime and downloads diagnostics.
The notebook cells were syntax checked and their interpreter routing was tested
with a mocked Python 3.14 host. User-provided Colab T4 output confirms schema-2
parity as described above.
Setup requests the Python 3.12 minor series so it can use a patch release
available in uv's download catalog; the exact installed patch is recorded in
the diagnostic runtime report. ML dependency pins are unchanged. It explicitly
downloads the managed interpreter before creating the venv,
keeps uv/Python storage under the extracted work directory, and prints captured
stdout/stderr with the failing stage. A bare `CalledProcessError` does not identify
the root cause; retain the emitted `error:` lines when diagnosing remote setup.
`training/colab_setup_cell.py` contains the same setup block for replacing just
that cell in an already uploaded notebook. Its `work_dir` comes from the preceding
package-upload cell. The existing parity ZIP does not need regeneration.
The historical dependency versions are unknown, so a new CUDA run cannot establish
exact historical runtime equivalence by itself.

Create its explicit input package locally:

```powershell
.\.venv-training\Scripts\python.exe -m training.prepare_parity_package --out backend/data/retraining/parity_upload.zip
```

The allowlist contains 20 files: diagnostic modules, required segment identity
helper, original notebook and original champion artifacts. It excludes `.env`,
database rows, new admin annotations, installed environments and local logs.
Packaging never uploads anything. The CUDA notebook asks the user to select that
package. `--device cuda` explicitly refuses a CPU fallback when CUDA is unavailable.
CPU training remains the default local runner path; the optimizer follows the data
tensor's device so the diagnostic can also test CUDA without changing its loss or
training policy. CUDA parity is confirmed; activation requires the explicit admin
promotion endpoint and a registered eligible bundle.

The notebook is now available at `backend/data/final_najud_gnn_gattt.ipynb`.
Its Cell 8.1 label rules are ported in `labels.py`. The original master-label
GeoPackage is absent, but the map export retains all its manual flags. A geometry
comparison matches all 3,639 base roads, and the notebook rules reproduce every
exported type, binary label and score without mismatches. `recover_labels.py`
therefore reconstructs a baseline from manual fields only, omitting probabilities
and display classes. Its 1,208 constrained segments are historical manual labels;
the other 2,431 zeros are background, including 525 model-only review candidates.
Those candidates are never treated as positive training labels.

Generate a new recovery directory from the repository root:

```powershell
.\backend\venv\Scripts\python.exe -m training.recover_labels --export backend/data/best_model_predicted_constraints.geojson --roads backend/data/roads_panabo.gpkg --out backend/data/retraining/recovered_master_v1
```

The output contains `roads_panabo_master_constraints.gpkg` and `manifest.json`
with source hashes, counts and recovery provenance. It is a recovered baseline,
not the original QGIS file or evidence that every background zero was verified.
Generated directories are ignored by Git; the recovery command refuses overwrites.
The notebook's SHA-1/6-decimal segment IDs differ from the runtime geometry fallback;
recovery currently preserves the runtime IDs for existing annotation compatibility.

Remaining work: rebuild raw GIS features if the road/feature baseline changes,
Lightning integration and scheduled promotion. The backend's generic GAT
remains incompatible with `SegmentGAT`.

Local validation uses synthetic roads/scores and mocks for DB-writing endpoints.
It does not connect to a database. A separate offline integration check builds
Panabo's actual graph and a spawned pool worker and verifies their overlay costs.
Local test files remain ignored under the repository policy:

```powershell
cd backend
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_retraining_prerequisites.py -v
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_inference_mode.py -v
.\venv\Scripts\python.exe tests/check_retraining_pool.py
```

From the repository root, in the isolated training environment (after generating
the champion bundle and replayed scores):

```powershell
.\.venv-training\Scripts\python.exe -m unittest discover -s backend/tests -p test_champion_reconstruction.py -v
.\.venv-training\Scripts\python.exe -m unittest discover -s backend/tests -p test_local_retraining.py -v
.\.venv-training\Scripts\python.exe -m unittest discover -s backend/tests -p test_parity_diagnostics.py -v
.\.venv-training\Scripts\python.exe backend/tests/check_local_retraining.py
.\.venv-training\Scripts\python.exe backend/tests/check_training_parity.py
```
