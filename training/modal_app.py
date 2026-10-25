"""Deploy from the repository root: python -m modal deploy -m training.modal_app."""
import os
from pathlib import Path

import modal

from backend.services.retrain_contract import MAX_TRAINING_SECONDS, PROTOCOL_VERSION, SOURCE_FILES, source_hashes

APP_NAME = os.environ.get("RETRAIN_MODAL_APP", "firetrackr-training")
VOLUME_NAME = os.environ.get("RETRAIN_MODAL_VOLUME", "firetrackr-training-jobs")
DEVICE = os.environ.get("FIRETRACKR_MODAL_DEVICE", "cuda")
if DEVICE not in ("cuda", "cpu"):
    raise ValueError("FIRETRACKR_MODAL_DEVICE must be cuda or cpu")

app = modal.App(APP_NAME, include_source=False)
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)
repo_root = Path(__file__).resolve().parents[1]
image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "torch==2.5.1", index_url="https://download.pytorch.org/whl/" + ("cu121" if DEVICE == "cuda" else "cpu")
).pip_install_from_requirements(repo_root / "training/requirements.txt").env(
    {"PYTHONPATH": "/opt/firetrackr", "PYTHONUTF8": "1", "PYTHONHASHSEED": "42",
     "FIRETRACKR_MODAL_DEVICE": DEVICE, "RETRAIN_MODAL_APP": APP_NAME, "RETRAIN_MODAL_VOLUME": VOLUME_NAME}
)
# Never mount the repository, backend environment, credentials, uploads or DB config.
for name in SOURCE_FILES:
    image = image.add_local_file(repo_root / name, "/opt/firetrackr/" + name)


@app.function(image=image, cpu=0.25, timeout=60, min_containers=0, max_containers=1)
def runner_info():
    return {"protocol": PROTOCOL_VERSION, "source_hashes": source_hashes("/opt/firetrackr"), "device": DEVICE}


@app.function(image=image, gpu="T4" if DEVICE == "cuda" else None, cpu=4, memory=8192,
              volumes={"/jobs": volume}, timeout=MAX_TRAINING_SECONDS + 300,
              min_containers=0, max_containers=1, scaledown_window=2, retries=0)
def train(job_id):
    from training.modal_worker import run_job

    return run_job(job_id, volume, device=DEVICE)
