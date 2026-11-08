"""Run one immutable cloud job; durable status outlives Modal call results."""
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys

from backend.services.retrain_contract import MAX_TRAINING_SECONDS, PROTOCOL_VERSION, source_hashes, validate_job_id


def prepare_cloud_snapshot(directory):
    """Build and verify the complete training snapshot inside the Modal worker."""
    from backend.services.retrain_contract import cloud_snapshot_files
    from backend.services.label_snapshot import build_snapshot, write_snapshot
    from backend.services.model_artifacts import read_json, verify_artifacts

    directory = Path(directory)
    inputs = directory / 'snapshot-inputs'
    cloud_snapshot_files(inputs)
    manifest = read_json(inputs / 'cloud_snapshot.json')
    champion, _, _ = verify_artifacts(directory / 'champion')
    expected_baseline = champion.get('baseline_sha256') or champion['files']['predicted_constraints.geojson']
    if manifest['files']['baseline.geojson'] != expected_baseline:
        raise ValueError('Cloud snapshot changes the champion road baseline')
    collection, history, snapshot = build_snapshot(inputs / 'baseline.geojson',
                                                   read_json(inputs / 'annotations.json'), manifest.get('created_by'))
    if snapshot['label_hash'] != manifest['label_hash']:
        raise ValueError('Cloud snapshot effective labels disagree with the reserved job')
    return write_snapshot(directory / 'snapshot', collection, history, snapshot)


def run_job(job_id, volume, root="/jobs", source_root="/opt/firetrackr", device="cuda"):
    from modal import current_function_call_id

    validate_job_id(job_id)
    volume.reload()
    directory = Path(root) / job_id
    call_id = current_function_call_id()

    def publish(state, error=None):
        payload = {"job_id": job_id, "call_id": call_id, "state": state,
                   "updated_at": datetime.now(timezone.utc).isoformat()}
        if error:
            payload["error"] = error
        if state == "failed" and (directory / "job.log").exists():
            with (directory / "job.log").open("rb") as log:
                log.seek(max(0, log.seek(0, 2) - 8000))
                payload["log_tail"] = log.read().decode("utf-8", errors="replace")
        pending = directory / "status.pending.json"
        pending.write_text(json.dumps(payload), encoding="utf-8")
        os.replace(pending, directory / "status.json")
        volume.commit()
        return payload

    # A platform redelivery must not train twice or overwrite a completed bundle.
    if (directory / "status.json").exists():
        return json.loads((directory / "status.json").read_text(encoding="utf-8"))
    directory.mkdir(exist_ok=True)
    try:
        config = json.loads((directory / "request.json").read_text(encoding="utf-8"))
        if (datetime.now(timezone.utc) - datetime.fromisoformat(config["created_at"])).total_seconds() > 86400:
            raise ValueError("Cloud job expired in the queue; request a new retrain")
        if config["protocol"] != PROTOCOL_VERSION or config["source_hashes"] != source_hashes(source_root):
            raise ValueError("Deployed trainer differs from the submitting backend; redeploy the Modal app")
        timeout = config["timeout_seconds"]
        if not isinstance(timeout, (float, int)) or not math.isfinite(timeout) or not 0 < timeout <= MAX_TRAINING_SECONDS:
            raise ValueError("Cloud training timeout must be at most one hour")
        version = config["version"]
        if not re.fullmatch(r"v[1-9][0-9]*", version):
            raise ValueError("Invalid candidate version")
        if config.get("parameters"):
            raise ValueError("Cloud jobs use the fixed registry training parameters")
        publish("running")
        if config.get('snapshot_mode') == 'cloud':
            prepare_cloud_snapshot(directory)
            volume.commit()
        command = [sys.executable, "-u", "-m", "training.train_constraints",
                   "--snapshot", str(directory / "snapshot"), "--champion", str(directory / "champion"),
                   "--out", str(directory / "bundle"), "--style", str(directory / "style_config.json"),
                   "--version", version, "--device", device]
        with (directory / "job.log").open("w", encoding="utf-8") as log:
            subprocess.run(command, cwd=source_root, stdout=log, stderr=subprocess.STDOUT,
                           timeout=timeout, check=True)
        return publish("succeeded")
    except subprocess.TimeoutExpired:
        return publish("failed", "Cloud retrain timed out; champion unchanged")
    except Exception as exc:
        return publish("failed", str(exc)[:2000])
