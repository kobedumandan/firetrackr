"""Check hosted retraining credentials, trainer compatibility and private storage.

Run from backend/: python check_retraining.py. Calls the small CPU diagnostic
function only; never submits training, uploads artifacts or changes the database.
"""
import json

from config import MODEL_ARTIFACT_STORAGE, RETRAIN_RUNNER
from services.model_bundle_store import check_model_storage
from services.model_registry import retrain_runner
from services.retrain_contract import PROTOCOL_VERSION, source_hashes


def check():
    if RETRAIN_RUNNER != "modal":
        raise ValueError("Set RETRAIN_RUNNER=modal for hosted retraining")
    runner = retrain_runner()
    info = runner.modal.Function.from_name(runner.app_name, "runner_info",
                                           environment_name=runner.environment_name).remote()
    if info.get("protocol") != PROTOCOL_VERSION or info.get("source_hashes") != source_hashes(runner.repo_root):
        raise ValueError("Redeploy training.modal_app from the same source as the backend")
    if MODEL_ARTIFACT_STORAGE != "supabase":
        raise ValueError("Set MODEL_ARTIFACT_STORAGE=supabase before retraining on an ephemeral host")
    check_model_storage()
    return {"ready": True, "runner": "modal", "app": runner.app_name,
            "environment": runner.environment_name, "artifact_storage": "supabase",
            "training_started": False}


if __name__ == "__main__":
    try:
        result = check()
    except Exception as exc:
        # Provider errors can contain request details. Keep credentials out of
        # console output; these checks identify the failing configuration stage.
        result = {"ready": False, "error_type": type(exc).__name__,
                  "action": "Check Modal credentials, deploy the matching trainer, and verify private model storage.",
                  "training_started": False}
    print(json.dumps(result))
    raise SystemExit(0 if result["ready"] else 1)
