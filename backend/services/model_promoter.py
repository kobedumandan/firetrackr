"""Explicit admin promotion/rollback; prepare routing before committing history."""
import asyncio
from datetime import datetime, timezone
import logging
import math

from ai import Config
from models import ModelVersion
from services import model_registry as registry
from services import routing_reload
from services.model_artifacts import read_json, verify_artifacts
from services.model_source import source_for_version

logger = logging.getLogger(__name__)
FIXED_PARAMETERS = {"epochs": 700, "lr": 0.002, "patience": 80, "seed": 42, "threads": 4}


def _check_export(directory, original_directory, style_path):
    from services.constraint_segments import segment_uid
    def geometries(path):
        features = read_json(path).get("features", [])
        result = {}
        for feature in features:
            uid = segment_uid(feature)
            if uid in result:
                raise registry.RegistryError("Model export contains duplicate road identities")
            result[uid] = segment_uid({"geometry": feature["geometry"], "properties": {}})
        if not result:
            raise registry.RegistryError("Model export has no road segments")
        return features, result
    features, actual = geometries(directory / "predicted_constraints.geojson")
    _, original = geometries(original_directory / "predicted_constraints.geojson")
    if actual != original:
        raise registry.RegistryError("Model export changes the verified road identities or geometry")
    style = read_json(style_path) if style_path else {}
    if not isinstance(style, dict):
        raise registry.RegistryError("Model style must be an object")
    for value in style.values():
        if isinstance(value, dict) and "routing_multiplier" in value:
            multiplier = value["routing_multiplier"]
            if isinstance(multiplier, bool) or not isinstance(multiplier, (int, float)) or not math.isfinite(multiplier) or multiplier < 1:
                raise registry.RegistryError("Model style has an invalid routing multiplier")
    for feature in features:
        props = feature.get("properties", {})
        multiplier = props.get("routing_multiplier")
        if multiplier is not None and (isinstance(multiplier, bool) or not isinstance(multiplier, (int, float)) or not math.isfinite(multiplier) or multiplier < 1):
            raise registry.RegistryError("Model export has an invalid routing multiplier")


def check_promotion(db, row, champion):
    if Config.REGION != "panabo" or Config.GNN_INFERENCE_MODE != "exported" or Config.USE_RL or Config.USE_SUMO:
        raise registry.RegistryError("Model activation requires Panabo exported inference with RL/SUMO disabled")
    if row.status not in ("candidate", "archived"):
        raise registry.RegistryError("Only a candidate or archived version can be promoted")
    if champion is None:
        raise registry.RegistryError("Registry has no champion; initialize or repair it first")
    if not row.bundle_manifest_sha256:
        raise registry.RegistryError("Model has no registered artifact digest")
    directory = registry.version_directory(row.version)
    manifest, audit, _ = verify_artifacts(directory, row.bundle_manifest_sha256)
    if manifest.get("version") != row.version or manifest["threshold"] != row.threshold:
        raise registry.RegistryError("Registered identity or threshold differs from the bundle")
    if manifest["split_version"] != row.split_version:
        raise registry.RegistryError("Registered frozen split differs from the bundle")
    if row.version == "v1":
        if row.status != "archived" or manifest["status"] != "verified_offline_bundle":
            raise registry.RegistryError("The original baseline is available only as an archived rollback")
        _check_export(directory, directory, Config.CONSTRAINT_STYLE_PATH)
        return manifest
    if manifest["status"] != "audited_candidate_bundle" or manifest.get("validation_only"):
        raise registry.RegistryError("Synthetic or unaudited bundles cannot be promoted")
    if manifest.get("label_hash") != row.label_hash or manifest.get("champion_version") != row.champion_version:
        raise registry.RegistryError("Registered training provenance differs from the bundle")
    if audit != row.report or audit["challenger"]["metrics"] != row.metrics:
        raise registry.RegistryError("Registered audit differs from the immutable bundle")
    if row.status == "candidate" and row.champion_version != champion.version:
        raise registry.RegistryError("Champion changed since this candidate's audit; re-audit before promoting")
    validation = read_json(directory / "validation_report.json")
    if validation.get("parameters") != FIXED_PARAMETERS:
        raise registry.RegistryError("Candidate did not use the verified full training settings")
    baseline = db.get(ModelVersion, "v1")
    if baseline is None or not baseline.bundle_manifest_sha256:
        raise registry.RegistryError("Verified original baseline provenance is missing")
    original, _, _ = verify_artifacts(registry.version_directory("v1"), baseline.bundle_manifest_sha256)
    if (manifest.get("baseline_sha256") != original["files"]["predicted_constraints.geojson"]
            or manifest["files"]["split_blocks.json"] != original["files"]["split_blocks.json"]
            or manifest["architecture"] != original["architecture"]
            or manifest.get("model_class") != "SegmentGAT"):
        raise registry.RegistryError("Candidate changes the verified road baseline, architecture or frozen split")
    _check_export(directory, registry.version_directory("v1"), directory / "style_config.json")
    return manifest


def promotion_readiness(db, row):
    champion = db.query(ModelVersion).filter_by(status="champion").one_or_none()
    try:
        check_promotion(db, row, champion)
    except registry.RegistryError as exc:
        return {"promotion_eligible": False, "promotion_blockers": [str(exc)],
                "expected_champion": champion.version if champion else None}
    except (OSError, ValueError, KeyError):
        logger.exception("Model %s failed activation integrity checks", row.version)
        return {"promotion_eligible": False, "promotion_blockers": ["Artifact integrity checks failed."],
                "expected_champion": champion.version if champion else None}
    return {"promotion_eligible": True, "promotion_blockers": [], "expected_champion": champion.version}


def promote_version(db, version, actor, expected_champion):
    """Shared transaction for immediate promotion and a future scheduler.

    Returns a committed payload and prepared routing objects, for installation on
    the event loop. This function does not publish process state or broadcast.
    """
    registry.registry_lock(db)
    row = registry.get_version(db, version)
    champion = db.query(ModelVersion).filter_by(status="champion").one_or_none()
    if champion is None or champion.version != expected_champion:
        raise registry.RegistryError("Champion changed; refresh the report before promoting")
    manifest = check_promotion(db, row, champion)
    source = source_for_version(row, manifest)
    signature, features = routing_reload._read_overlay(db, source, force=True)
    engine = pool = None
    try:
        engine, pool = routing_reload._build_replacement(features, False, source)
        rollback = row.status == "archived"
        previous = champion.version
        champion.status = "archived"
        db.flush()  # Release the partial unique champion key before claiming it.
        row.status = "champion"
        row.promoted_by = actor
        row.promoted_at = datetime.now(timezone.utc)
        # Reserved scheduled statuses are reset on an immediate change/rollback.
        for pending in db.query(ModelVersion).filter_by(status="scheduled").all():
            pending.status = "candidate"
        db.flush()
        payload = registry.serialize_version(row)
        payload.update(previous_champion=previous, rollback=rollback, routing_applied=True)
        # Checkpoints/exports remain immutable. The transaction changes only
        # registry history after both main and worker replacements are ready.
        db.commit()
    except BaseException:
        try:
            db.rollback()
        finally:
            routing_reload.discard_replacement(engine, pool)
        raise
    return payload, (signature, features, source, engine, pool)


def _promote_transaction(version, actor, expected_champion):
    from database import SessionLocal
    with SessionLocal() as db:
        return promote_version(db, version, actor, expected_champion)


async def promote_and_reload(version, actor, expected_champion):
    """Serialize with annotation reloads; finish a committed swap on cancellation."""
    from state import manager
    async with routing_reload._reload_lock:
        task = asyncio.create_task(asyncio.to_thread(_promote_transaction, version, actor, expected_champion))
        cancelled = False
        try:
            payload, prepared = await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled = True
            payload, prepared = await task
        routing_reload.install_replacement(*prepared)
        # Other web processes detect the committed champion on their next poll.
        await manager.broadcast({"type": "model_promoted", "data": {
            "version": payload["version"], "previous_champion": payload["previous_champion"],
            "rollback": payload["rollback"], "scheduled": False}})
        if cancelled:
            raise asyncio.CancelledError
        return payload
