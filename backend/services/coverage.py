"""Station reachability coverage: whole-graph compute, cached per process."""
import json

from fastapi import HTTPException
from sqlalchemy.orm import Session

import state
from ai import Config
from coverage_engine import compute_coverage
from models import Station
from services.resource_limits import memory_work_lock


_BARANGAYS_GEOJSON_PATH = Config.BARANGAYS_PATH


def _station_source_nodes(db: Session, engine=None) -> list[int]:
    """Snap every operational station with coordinates to its nearest graph
    node. Inactive stations don't respond, so they don't count as coverage."""
    engine = engine if engine is not None else state.routing_engine
    nodes: list[int] = []
    for s in db.query(Station).all():
        if s.station_latitude is None or s.station_longitude is None:
            continue
        if (s.station_status or "operational") == "inactive":
            continue
        near = engine.graph.nodes_near(
            float(s.station_latitude), float(s.station_longitude), radius_km=2.0
        )
        if near:
            nodes.append(near[0][0])
    return nodes


def _compute_or_get_coverage(db: Session, refresh: bool = False) -> dict:
    """Share one computation and discard results whose inputs changed mid-flight."""
    with state.coverage_cache_lock:
        previous_cache = state.coverage_cache
        if previous_cache is not None and not refresh:
            return previous_cache

    with memory_work_lock:
        with state.coverage_cache_lock:
            cached = state.coverage_cache
            # Overlapping refreshes share the new result; a later refresh still
            # recomputes. Cold map and gap requests also converge on this cache.
            if cached is not None and (not refresh or cached is not previous_cache):
                return cached

        for _attempt in range(2):
            with state.coverage_cache_lock:
                engine = state.routing_engine
                revision = state.coverage_revision
            if engine is None:
                raise HTTPException(status_code=503, detail="Routing engine not loaded.")

            sources = _station_source_nodes(db, engine)
            if not sources:
                raise HTTPException(
                    status_code=404,
                    detail="No operational stations with coordinates to compute coverage from.",
                )

            barangays = None
            if _BARANGAYS_GEOJSON_PATH.exists():
                with open(_BARANGAYS_GEOJSON_PATH, encoding="utf-8") as f:
                    barangays = json.load(f)

            edge_costs, _ = engine._compute_edge_costs()
            result = compute_coverage(engine.graph, edge_costs, sources, barangays)
            if result is None:
                raise HTTPException(status_code=500, detail="Coverage computation produced no data.")

            with state.coverage_cache_lock:
                if revision == state.coverage_revision and engine is state.routing_engine:
                    state.coverage_cache = result
                    return result
            # A model/station update raced the computation. Retry current inputs
            # once, without retaining the superseded geometry result.
            del result, edge_costs, barangays
            db.expire_all()

    raise HTTPException(status_code=503, detail="Coverage inputs changed. Please retry.")
