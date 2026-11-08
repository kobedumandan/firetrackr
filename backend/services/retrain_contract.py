"""Small, explicit transfer contract shared by the web adapter and cloud worker."""
import hashlib
import json
from pathlib import Path
import re

PROTOCOL_VERSION = 2
MAX_TRAINING_SECONDS = 3600
SOURCE_FILES = (
    "training/__init__.py", "training/audit.py", "training/bundle.py",
    "training/export.py", "training/features.py", "training/graph.py",
    "training/model.py", "training/optimization.py", "training/snapshot.py",
    "training/split.py", "training/threshold.py", "training/train_constraints.py",
    "backend/services/retrain_contract.py", "training/modal_worker.py", "training/modal_app.py",
    "training/requirements.txt", "backend/services/__init__.py",
    "backend/services/constraint_segments.py", "backend/services/label_snapshot.py",
    "backend/services/model_artifacts.py",
)


def validate_job_id(job_id):
    if not isinstance(job_id, str) or not re.fullmatch(r"[0-9a-f]{32}", job_id):
        raise ValueError("Invalid retraining job ID")
    return job_id


def source_hashes(root):
    root = Path(root)
    # Git commonly checks out CRLF on Windows and LF on hosted Linux. Those
    # equivalent source files must pass the same deployment compatibility gate.
    return {name: hashlib.sha256((root / name).read_bytes().replace(b"\r\n", b"\n")).hexdigest()
            for name in SOURCE_FILES}


def snapshot_files(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    digest = manifest.get("label_hash", "")
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("Invalid snapshot label hash")
    expected = {"features.geojson", "annotations.json", f"labels_{digest}.parquet"}
    if manifest.get("schema_version") != 1 or set(manifest.get("files", {})) != expected:
        raise ValueError("Unexpected snapshot artifacts")
    for name, digest in manifest["files"].items():
        path = directory / name
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError(f"Snapshot integrity check failed: {name}")
    if (directory / "manifest.json").is_symlink():
        raise ValueError("Snapshot manifest must be a regular file")
    return sorted(expected | {"manifest.json"})


def cloud_snapshot_files(directory):
    """Validate raw label inputs that Modal will turn into a full snapshot."""
    from .model_artifacts import read_json, sha256

    directory = Path(directory)
    marker = directory / 'cloud_snapshot.json'
    if marker.is_symlink():
        raise ValueError('Cloud snapshot manifest must be a regular file')
    manifest = read_json(marker)
    expected = {'baseline.geojson', 'annotations.json'}
    if (not isinstance(manifest, dict) or manifest.get('schema_version') != 1
            or not isinstance(manifest.get('files'), dict)
            or set(manifest.get('files', {})) != expected
            or not isinstance(manifest.get('label_hash'), str)
            or not re.fullmatch(r'[a-f0-9]{64}', manifest['label_hash'])):
        raise ValueError('Invalid cloud snapshot inputs')
    for name, digest in manifest['files'].items():
        path = directory / name
        if path.is_symlink() or sha256(path) != digest:
            raise ValueError(f'Cloud snapshot integrity check failed: {name}')
    return sorted(expected | {'cloud_snapshot.json'})
