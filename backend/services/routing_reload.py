"""Prepare routing replacements before swapping; synchronize drawings and models.

Pool processes receive explicit paths and overlays, never DB connections.
Only the event-loop thread installs replacements. Retired pools finish requests
on the graph they originally received.
"""
import asyncio
import hashlib
import json
import logging
from concurrent.futures import ProcessPoolExecutor
import time

import state
from config import ROUTING_POOL_SIZE
from routing_setup import build_routing_engine
import routing_pool
from services.model_source import constraint_paths, resolve_champion

logger = logging.getLogger(__name__)
_reload_lock = asyncio.Lock()
_loaded_signature = None


def _read_overlay(db, model_source=None, force=False):
    path, style_path = constraint_paths(model_source)
    if path is None:
        return "no-constraints", []
    from models import GnnConstraint
    from services.constraint_segments import load_segment_index, overlay_features

    rows = db.query(GnnConstraint).filter(GnnConstraint.is_active.is_(True)).order_by(GnnConstraint.constraint_id).all()
    payload = {"model": model_source,
               "annotations": [(r.constraint_id, r.constraint_type, r.coordinates, r.segment_uids,
                                r.narrow_severity, r.traffic_schedule, r.baseline_segment_uid) for r in rows]}
    signature = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    if not force and signature == _loaded_signature:
        return signature, None
    if not rows:
        return signature, []
    style = {}
    if style_path and style_path.exists():
        with open(style_path, encoding="utf-8") as source:
            style = json.load(source)
    return signature, overlay_features(rows, load_segment_index(path), style)


def _read_deployment(force=False):
    from database import SessionLocal
    with SessionLocal() as db:
        source = resolve_champion(db)
        signature, features = _read_overlay(db, source, force)
        if features is not None and source:
            from services.model_artifacts import verify_artifacts
            from services.model_registry import version_directory
            manifest, _, _ = verify_artifacts(version_directory(source["version"]), source["manifest_sha256"])
            if manifest.get("version") != source["version"] or manifest.get("threshold") != source["threshold"]:
                raise ValueError("Champion metadata differs from the registered bundle")
        return signature, features, source


def discard_replacement(engine, pool):
    if pool is not None:
        try:
            pool.shutdown(wait=False, cancel_futures=True)
        except Exception:
            logger.exception("Unused routing pool cleanup failed")
    if engine is not None:
        try:
            engine.shutdown()
        except Exception:
            logger.exception("Unused routing engine cleanup failed")


def _build_replacement(features, register_gym, model_source=None):
    engine = build_routing_engine(register_gym=register_gym, custom_constraints=features, model_source=model_source)
    if engine is None:
        raise RuntimeError("Replacement routing engine failed to build; previous engine retained.")
    pool = None
    try:
        if ROUTING_POOL_SIZE > 0:
            pool = ProcessPoolExecutor(max_workers=ROUTING_POOL_SIZE,
                                       initializer=routing_pool.init_worker, initargs=(features, model_source))
            deadline = time.monotonic() + 180
            warmed = set()
            expected_version = model_source["version"] if model_source else None
            while len(warmed) < ROUTING_POOL_SIZE:
                futures = [pool.submit(routing_pool.model_status) for _ in range(ROUTING_POOL_SIZE * 2)]
                for future in futures:
                    status = future.result(timeout=max(0, deadline - time.monotonic()))
                    if not status["ready"] or status["version"] != expected_version:
                        raise RuntimeError("A replacement routing worker loaded the wrong model")
                    warmed.add(status["pid"])
                if time.monotonic() >= deadline and len(warmed) < ROUTING_POOL_SIZE:
                    raise RuntimeError("Not all routing workers finished warming")
        return engine, pool
    except BaseException:
        discard_replacement(engine, pool)
        raise


def install_replacement(signature, features, source, engine, pool):
    """No await/DB work: publish ready objects together on the event loop."""
    global _loaded_signature
    old_pool = state.routing_pool_executor
    state.routing_engine = engine
    state.routing_pool_executor = pool
    state.active_model_source = source
    state.routing_generation += 1
    state.gnn_constraints_cache = None
    state.constraint_style_cache = None
    state.coverage_cache = None
    _loaded_signature = signature
    if old_pool is not None:
        try:
            old_pool.shutdown(wait=False)
        except Exception:
            logger.exception("Retired routing pool could not shut down cleanly")
    logger.info("Routing loaded model=%s with %s drawn overlays", source["version"] if source else "configured", len(features))


async def reload_routing(force=False, register_gym=False):
    async with _reload_lock:
        signature, features, source = await asyncio.to_thread(_read_deployment, force)
        if features is None:
            return False
        task = asyncio.create_task(asyncio.to_thread(_build_replacement, features, register_gym, source))
        try:
            engine, pool = await asyncio.shield(task)
        except asyncio.CancelledError:
            try:
                engine, pool = await task
                discard_replacement(engine, pool)
            except Exception:
                logger.exception("Cancelled routing replacement failed during cleanup")
            raise
        install_replacement(signature, features, source, engine, pool)
        return True


async def refresh_after_constraint_change():
    state.gnn_constraints_cache = None
    try:
        await reload_routing()
    except Exception:
        logger.exception("Constraint saved; routing refresh failed and will be retried")
        return False
    return True


async def poll_routing_changes():
    while True:
        await asyncio.sleep(10)
        try:
            await reload_routing()
        except Exception:
            logger.exception("Routing synchronization failed; retaining previous graph")
