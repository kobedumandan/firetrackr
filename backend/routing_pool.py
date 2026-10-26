"""
Process-pool workers for CPU-bound route computation.

Each pool process loads the road graph + GNN engine ONCE (in `init_worker`),
then answers pure-compute requests. This gives the routing work real
parallelism across processes instead of serializing behind the API process's
GIL. Only primitive args/results cross the process boundary — no DB objects,
no engine — so everything stays picklable and cheap to ship.

DB reads (obstructions, incident coords) and all DB writes stay in the parent
API process; these workers do graph math only.
"""
import logging
import os
import time

from routing_setup import build_routing_engine

logger = logging.getLogger(__name__)

_engine = None  # per-process, populated by init_worker()
_model_source = None

NODES_NEAR_RADIUS_KM = 2.0


def init_worker(custom_constraints=None, model_source=None) -> None:
    """ProcessPoolExecutor initializer — build this process's routing engine."""
    global _engine, _model_source
    _model_source = model_source
    _engine = build_routing_engine(register_gym=False, custom_constraints=custom_constraints, model_source=model_source)
    if _engine is None:
        raise RuntimeError("Routing worker could not load the selected model")


def model_status(hold_seconds=0.3):
    time.sleep(hold_seconds)
    return {"pid": os.getpid(), "ready": _engine is not None,
            "version": _model_source["version"] if _model_source else None}


def warmup(hold_seconds: float = 0.3) -> bool:
    """Force a pool worker to finish spawning (and thus run init_worker, loading
    its graph) before real traffic arrives. The short hold makes the pool fan a
    batch of these across all workers. Returns True if this worker's engine
    loaded."""
    time.sleep(hold_seconds)
    return _engine is not None


def compute_routes(origin_lat, origin_lng, target_lat, target_lng, obstructions):
    """Full multi-alpha route set from origin to target. Returns a list of
    plain route dicts (picklable) or None."""
    if _engine is None:
        return None
    src = _engine.graph.nodes_near(origin_lat, origin_lng, radius_km=NODES_NEAR_RADIUS_KM)
    tgt = _engine.graph.nodes_near(target_lat, target_lng, radius_km=NODES_NEAR_RADIUS_KM)
    if not src or not tgt:
        return None
    return _engine.compute_routes_multi_alpha(src[0][0], tgt[0][0], obstructions=obstructions)


def compute_position_routes(lat, lon, fire_lat, fire_lon, obstructions, previous_position=None):
    if _engine is None:
        return None
    return _engine.compute_routes_from_position(lat, lon, fire_lat, fire_lon, obstructions, previous_position)


def compute_connector(lat, lon, fire_lat, fire_lon, obstructions):
    """Connector GeoJSON from an off-route point to the fire. Returns a dict or None."""
    if _engine is None:
        return None
    return _engine.compute_connector(lat, lon, fire_lat, fire_lon, obstructions=obstructions)
