"""Admin-controlled retraining with durable, immutable model history.

The transaction advisory lock serializes registry mutations across web workers.
The partial unique index retains the single-training guard between transactions.
Activation is handled separately by model_promoter after explicit admin review.
"""
import asyncio
from datetime import datetime, timezone
import logging
from pathlib import Path
import re
import uuid

from sqlalchemy import text

from config import (MODEL_VERSIONS_ROOT, RETRAIN_WORK_ROOT, RETRAIN_PYTHON,
                    RETRAIN_TIMEOUT_MIN, RETRAIN_RUNNER, RETRAIN_POLL_SECONDS,
                    RETRAIN_MODAL_APP, RETRAIN_MODAL_VOLUME, RETRAIN_MODAL_ENVIRONMENT)
from models import ModelVersion
from services.label_snapshot import build_snapshot, read_database_snapshot, write_snapshot
from services.model_artifacts import verify_artifacts, sha256, read_json
from services.retrain_runner import LocalRunner, RunnerUnavailable

logger = logging.getLogger(__name__)
_REGISTRY_LOCK_KEY = 74120933


class RegistryError(Exception):
    def __init__(self, message, status_code=409):
        super().__init__(message)
        self.status_code = status_code


def registry_lock(db):
    if db.get_bind().dialect.name != "postgresql":
        raise RegistryError("The model registry requires PostgreSQL advisory locks", 503)
    if not db.execute(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": _REGISTRY_LOCK_KEY}).scalar():
        raise RegistryError("Another model operation is in progress; retry shortly")


def version_directory(version):
    if not re.fullmatch(r"v[1-9][0-9]*", version):
        raise RegistryError("Unknown model version", 404)
    root = Path(MODEL_VERSIONS_ROOT).resolve()
    directory = root / version
    if directory.resolve().parent != root or directory.is_symlink():
        raise RegistryError("Model directory is outside the artifact store", 503)
    return directory


def get_version(db, version):
    version_directory(version)
    row = db.get(ModelVersion, version)
    if row is None:
        raise RegistryError("Model version not found", 404)
    return row


def serialize_version(row):
    payload = {key: getattr(row, key) for key in (
        "version", "status", "label_hash", "split_version", "threshold", "metrics",
        "job_id", "champion_version", "error", "created_by", "created_at", "updated_at",
        "promoted_by", "promoted_at", "rejected_by", "rejected_at")}
    payload["cancel_requested"] = bool((row.report or {}).get("cancel_requested_at")) and row.status == "training"
    payload["job_status"] = (row.report or {}).get("job_status")
    return payload


def registry_summary(db):
    champion = db.query(ModelVersion).filter_by(status="champion").one_or_none()
    training = db.query(ModelVersion).filter_by(status="training").one_or_none()
    if champion is None:
        return {"champion": None, "training": serialize_version(training) if training else None,
                "can_initialize": db.query(ModelVersion).first() is None,
                "can_retrain": False, "labels_changed": None, "snapshot": None}
    baseline = get_version(db, "v1")
    baseline_dir = version_directory("v1")
    verify_artifacts(baseline_dir, baseline.bundle_manifest_sha256)
    _, _, snapshot = read_database_snapshot(db, baseline_dir / "predicted_constraints.geojson", None)
    changed = snapshot["label_hash"] != champion.label_hash
    trained_count = (champion.report or {}).get("segments")
    if champion.version != "v1":
        trained_count = read_json(version_directory(champion.version) / "snapshot_manifest.json")["segments"]
    return {"champion": {**serialize_version(champion), "label_count": trained_count},
            "training": serialize_version(training) if training else None,
            "can_initialize": False, "can_retrain": changed and training is None,
            "labels_changed": changed,
            "snapshot": {key: snapshot[key] for key in ("segments", "positive_segments", "active_drawn_rows", "drawn_segments",
                                                        "partial_edge_rows_not_used_as_training_labels")}}


def preview_version(db, version):
    """Only class-flip geometries and presentation fields leave the artifact store."""
    row = get_version(db, version)
    if row.status not in ("candidate", "champion", "archived", "rejected", "scheduled"):
        raise RegistryError("Preview is available after training completes")
    directory = version_directory(version)
    _, report, _ = verify_artifacts(directory, row.bundle_manifest_sha256)
    changes = {change["segment_uid"]: change for change in report.get("churn", [])}
    features = []
    if changes:
        from services.constraint_segments import segment_uid
        for feature in read_json(directory / "predicted_constraints.geojson")["features"]:
            uid = segment_uid(feature)
            if uid not in changes:
                continue
            change = changes[uid]
            props = feature.get("properties", {})
            features.append({"type": "Feature", "geometry": feature["geometry"], "properties": {
                "segment_uid": uid, "name": props.get("name"),
                "annotation_source": change["annotation_source"],
                "champion_class": change["champion_class"], "challenger_class": change["challenger_class"]}})
    if len(features) != len(changes):
        raise RegistryError("Preview roads do not match the candidate audit", 503)
    return {"type": "FeatureCollection", "features": features, "version": version,
            "compared_against": row.champion_version}


def initialize_registry(db, actor):
    registry_lock(db)
    existing = db.query(ModelVersion).first()
    if existing:
        champion = db.query(ModelVersion).filter_by(status="champion").one_or_none()
        if champion is None:
            raise RegistryError("Registry has no champion; repair its history before initialization")
        return champion
    directory = version_directory("v1")
    manifest, report, digest = verify_artifacts(directory)
    if manifest.get("version") != "v1" or manifest["status"] != "verified_offline_bundle":
        raise RegistryError("Initialization requires the verified v1 reconstruction", 422)
    # Registering v1 describes the already active export; it cannot change routing.
    from ai import Config
    if not Config.PREDICTED_CONSTRAINTS_PATH or sha256(Config.PREDICTED_CONSTRAINTS_PATH) != manifest["files"]["predicted_constraints.geojson"]:
        raise RegistryError("Verified v1 does not match the configured routing export", 422)
    _, _, snapshot = build_snapshot(directory / "predicted_constraints.geojson", [], actor)
    row = ModelVersion(version="v1", status="champion", label_hash=snapshot["label_hash"],
                       split_version=manifest["split_version"], threshold=manifest["threshold"],
                       report=report, bundle_manifest_sha256=digest, created_by=actor)
    db.add(row)
    db.commit()
    return row


def local_runner():
    try:
        return LocalRunner(RETRAIN_WORK_ROOT / "jobs", RETRAIN_PYTHON, RETRAIN_TIMEOUT_MIN)
    except ValueError as exc:
        raise RegistryError("Configure RETRAIN_PYTHON with the isolated training interpreter", 503) from exc


def retrain_runner(job_id=None):
    # An existing job keeps its original adapter even if configuration changes.
    if job_id:
        from services.retrain_contract import validate_job_id
        validate_job_id(job_id)
        if (RETRAIN_WORK_ROOT / "modal_jobs" / job_id / "job.json").is_file():
            runner_kind = "modal"
        elif (RETRAIN_WORK_ROOT / "jobs" / job_id / "job.json").is_file():
            runner_kind = "local"
        else:
            runner_kind = RETRAIN_RUNNER
    else:
        runner_kind = RETRAIN_RUNNER
    if runner_kind == "local":
        return local_runner()
    if runner_kind == "modal":
        try:
            from services.modal_retrain_runner import ModalRunner
            return ModalRunner(RETRAIN_WORK_ROOT / "modal_jobs", RETRAIN_MODAL_APP,
                               RETRAIN_MODAL_VOLUME, RETRAIN_MODAL_ENVIRONMENT, RETRAIN_TIMEOUT_MIN)
        except (ValueError, ImportError) as exc:
            raise RegistryError("Configure the Modal runner and install backend/requirements-modal.txt", 503) from exc
    raise RegistryError("RETRAIN_RUNNER must be local or modal", 503)


def start_retrain(db, actor):
    registry_lock(db)
    if db.query(ModelVersion).filter_by(status="training").first():
        raise RegistryError("A retrain is already active")
    champion = db.query(ModelVersion).filter_by(status="champion").one_or_none()
    if champion is None:
        raise RegistryError("Initialize the verified baseline registry before retraining")
    directory = version_directory(champion.version)
    manifest, _, _ = verify_artifacts(directory, champion.bundle_manifest_sha256)
    baseline = version_directory("v1")
    base_manifest, _, _ = verify_artifacts(baseline)
    if base_manifest["files"]["predicted_constraints.geojson"] != (manifest.get("baseline_sha256") or manifest["files"]["predicted_constraints.geojson"]):
        raise RegistryError("The road/feature baseline changed; reconcile and verify it first", 422)
    runner = retrain_runner()
    collection, history, snapshot = read_database_snapshot(db, baseline / "predicted_constraints.geojson", actor)
    if snapshot["label_hash"] == champion.label_hash:
        raise RegistryError("No new effective labels since the champion; retraining refused")
    numbers = [int(v[1:]) for v, in db.query(ModelVersion.version).all() if re.fullmatch(r"v[1-9][0-9]*", v)]
    version = f"v{max(numbers, default=0) + 1}"
    if version_directory(version).exists():
        raise RegistryError("Unregistered model artifacts already occupy the next version; inspect them first")
    job_id = uuid.uuid4().hex
    snapshot_dir = RETRAIN_WORK_ROOT / "snapshots" / job_id
    write_snapshot(snapshot_dir, collection, history, snapshot)
    row = ModelVersion(version=version, status="training", label_hash=snapshot["label_hash"],
                       split_version=champion.split_version, champion_version=champion.version,
                       job_id=job_id, created_by=actor)
    db.add(row)
    # Persist the job identity before spawning. A web-process crash after submit
    # can therefore be recovered by another worker without launching a second job.
    db.commit()
    try:
        runner.submit(snapshot_dir, directory, version=version, job_id=job_id)
    except RunnerUnavailable:
        # The request may have reached Modal before the connection dropped.
        # Keep the reservation and recover by job ID instead of launching twice.
        logger.warning("Retrain acknowledgement pending for %s; polling its reserved job", version)
    except Exception:
        logger.exception("Retrain submission failed for %s", version)
        row.status = "failed"
        row.error = "Retrain could not start; inspect the server log and runner configuration."
        db.commit()
        raise RegistryError(row.error, 503)
    return row


def reject_version(db, version, actor):
    registry_lock(db)
    row = get_version(db, version)
    if row.status != "candidate":
        raise RegistryError("Only a candidate can be rejected")
    row.status = "rejected"
    row.rejected_by = actor
    row.rejected_at = datetime.now(timezone.utc)
    db.commit()
    return row


def cancel_retrain(db, version, actor):
    """Keep the training reservation until the runner acknowledges termination."""
    registry_lock(db)
    row = get_version(db, version)
    if (row.report or {}).get("job_status") == "cancelled":
        return row
    if row.status != "training":
        raise RegistryError("Only an ongoing retrain can be cancelled")
    if (row.report or {}).get("cancel_requested_at"):
        return row
    try:
        retrain_runner(row.job_id).cancel(row.job_id)
    except KeyError as exc:
        raise RegistryError("Training is still starting; retry cancellation shortly") from exc
    except RunnerUnavailable as exc:
        raise RegistryError(str(exc), 503) from exc
    row.report = {**(row.report or {}), "cancel_requested_at": datetime.now(timezone.utc).isoformat(),
                  "cancel_requested_by": actor}
    db.commit()
    return row


def _complete_job(db, row, runner):
    try:
        status = runner.status(row.job_id)
    except KeyError:
        created = row.created_at.replace(tzinfo=timezone.utc) if row.created_at.tzinfo is None else row.created_at
        if (datetime.now(timezone.utc) - created).total_seconds() < 120:
            return None  # Submission reservation may still be spawning.
        status = {"state": "failed", "error": "Reserved job never reached the retrain runner; retry with a new retrain."}
    if status["state"] in ("queued", "running"):
        return None
    if status["state"] == "cancelled" or (row.report or {}).get("cancel_requested_at"):
        # Existing registry statuses remain compatible: a stopped retrain is a
        # rejected version with an explicit cancellation outcome in its report.
        row.status = "rejected"
        row.report = {**(row.report or {}), "schema_version": 1, "job_status": "cancelled"}
        row.rejected_by = row.report.get("cancel_requested_by")
        row.rejected_at = datetime.now(timezone.utc)
        row.error = None
        return {"type": "model_training_cancelled", "data": {"version": row.version}}
    if status["state"] != "succeeded":
        row.status = "failed"
        row.error = str(status.get("error", "Retrain failed"))[:2000]
        row.report = {"schema_version": 1, "job_status": status["state"],
                      "log_tail": str(status.get("log_tail", ""))[-8000:]}
        return {"type": "model_training_failed", "data": {"version": row.version}}
    destination = version_directory(row.version)
    if not destination.exists():
        runner.fetch(row.job_id, destination)
    manifest, report, digest = verify_artifacts(destination)
    if manifest.get("status") != "audited_candidate_bundle" or manifest.get("version") != row.version:
        raise ValueError("Runner returned the wrong candidate identity")
    for key in ("label_hash", "split_version", "champion_version"):
        if manifest.get(key) != getattr(row, key):
            raise ValueError(f"Candidate provenance mismatch: {key}")
    if manifest.get("validation_only"):
        raise ValueError("Synthetic-validation bundles cannot enter the admin registry")
    row.status = "candidate"
    row.threshold = manifest["threshold"]
    row.metrics = report["challenger"]["metrics"]
    row.report = report
    row.bundle_manifest_sha256 = digest
    row.error = None
    return {"type": "model_candidate_ready", "data": {"version": row.version,
            "recommendation": report["recommendation"], "requires_admin_promotion": True}}


def synchronize_jobs():
    """Each tick holds a transaction lock; no pinned connection for the job lifetime."""
    from database import SessionLocal
    with SessionLocal() as db:
        try:
            registry_lock(db)
        except RegistryError:
            return []
        rows = db.query(ModelVersion).filter_by(status="training").all()
        if not rows:
            return []
        events = []
        for row in rows:
            try:
                runner = retrain_runner(row.job_id)
                event = _complete_job(db, row, runner)
                if event:
                    events.append(event)
            except RunnerUnavailable:
                logger.warning("Retrain status/download unavailable for %s; retrying next poll", row.version)
            except RegistryError:
                # Missing SDK/config must not discard a job already in the cloud.
                logger.exception("Retrain runner unavailable for %s", row.version)
            except Exception:
                logger.exception("Candidate verification failed for %s", row.version)
                row.status = "failed"
                row.error = "Candidate artifact verification failed; champion unchanged. Inspect the server log."
                events.append({"type": "model_training_failed", "data": {"version": row.version}})
        db.commit()
        return events


async def poll_model_jobs():
    from state import manager
    unavailable_logged = False
    while True:
        try:
            events = await asyncio.to_thread(synchronize_jobs)
            unavailable_logged = False
            for event in events:
                await manager.broadcast(event)
        except Exception:
            if not unavailable_logged:
                logger.exception("Model job polling unavailable; check migration 0026 and runner settings")
                unavailable_logged = True
        await asyncio.sleep(RETRAIN_POLL_SECONDS)
