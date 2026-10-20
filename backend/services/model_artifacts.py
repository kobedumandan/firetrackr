"""Check immutable bundle metadata without importing the training runtime."""
import hashlib
import json
import math
from pathlib import Path
import re

BASE_FILES = {"checkpoint.pt", "predicted_constraints.geojson", "split_blocks.json",
              "feature_pipeline.json", "validation_report.json", "scores.json"}
CANDIDATE_FILES = BASE_FILES | {"report.json", "snapshot_manifest.json", "style_config.json"}


def read_json(path):
    def invalid(value):
        raise ValueError(f"Nonfinite JSON value: {value}")
    return json.loads(Path(path).read_text(encoding="utf-8"), parse_constant=invalid)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_artifacts(directory, expected_digest=None):
    directory = Path(directory).resolve()
    manifest_path = directory / "manifest.json"
    if manifest_path.is_symlink():
        raise ValueError("Bundle manifest must be a regular local file")
    digest = sha256(manifest_path)
    if expected_digest and digest != expected_digest:
        raise ValueError("Registered bundle manifest changed")
    manifest = read_json(manifest_path)
    candidate = manifest.get("status") == "audited_candidate_bundle"
    if manifest.get("schema_version") != 1 or manifest.get("status") not in (
            "audited_candidate_bundle", "verified_offline_bundle"):
        raise ValueError("Bundle was not verified or audited")
    files = manifest.get("files", {})
    if set(files) != (CANDIDATE_FILES if candidate else BASE_FILES):
        raise ValueError("Incomplete bundle artifact list")
    for name, expected in files.items():
        path = directory / name
        if path.is_symlink() or not re.fullmatch(r"[a-f0-9]{64}", str(expected)) or sha256(path) != expected:
            raise ValueError(f"Bundle integrity check failed: {name}")
    threshold = manifest.get("threshold")
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not math.isfinite(threshold) or not 0 < threshold < 1:
        raise ValueError("Invalid bundle threshold")
    validation = read_json(directory / "validation_report.json")
    if validation.get("status") != ("training_completed" if candidate else "verified"):
        raise ValueError("Bundle validation is incomplete")
    for key in ("architecture", "threshold", "split_version"):
        if manifest.get(key) != validation.get(key):
            raise ValueError(f"Bundle validation disagrees on {key}")
    if read_json(directory / "split_blocks.json")["split_version"] != manifest["split_version"]:
        raise ValueError("Frozen split differs from manifest")
    report = read_json(directory / ("report.json" if candidate else "validation_report.json"))
    if candidate:
        snapshot = read_json(directory / "snapshot_manifest.json")
        for record in (report, validation, snapshot):
            if record.get("label_hash") != manifest.get("label_hash"):
                raise ValueError("Candidate label provenance differs between artifacts")
        if report.get("split_version") != manifest["split_version"]:
            raise ValueError("Audit split differs from manifest")
        if report.get("champion_version") != manifest.get("champion_version"):
            raise ValueError("Audit champion differs from manifest")
        validation_only = snapshot.get("purpose") == "synthetic_validation"
        if snapshot.get("purpose") not in ("training", "synthetic_validation") or any(
                record.get("validation_only") is not validation_only for record in (report, validation, manifest)):
            raise ValueError("Candidate validation-only markers disagree")
    return manifest, report, digest
