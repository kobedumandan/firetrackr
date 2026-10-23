"""Routing engine status, ad-hoc route computation, and the GAT constraint layer."""
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import state
from ai import Config
from database import get_db
from models import GnnConstraint, Users
from schemas import RouteRequest, RouteResponse
from security import require_admin
from services.constraints import (
    _CONSTRAINT_PROP_KEYS, _CUSTOM_STYLE_KEY, _label_for, _load_constraint_style,
)
from services.routing import _load_active_obstructions
from services.constraint_segments import load_segment_index, segment_uid
from services.model_source import active_paths, constraint_paths


router = APIRouter(tags=["routing"])


@router.get("/api/routing/status")
def routing_status():
    constraints_path, _ = active_paths()
    region = {
        "region": Config.REGION,
        "region_label": Config.REGION_CFG["label"],
        "place_name": Config.PLACE_NAME,
        "road_source": Config.ROAD_SOURCE,
        "inference_mode": Config.GNN_INFERENCE_MODE,
        "has_constraints": bool(
            constraints_path and constraints_path.exists()
        ),
        "model_version": state.active_model_source["version"] if state.active_model_source else None,
    }
    if state.routing_engine is None:
        return {"status": "offline", "reason": "routing_engine is None", **region}
    g = state.routing_engine.graph.G
    return {
        "status": "online",
        "nodes": g.number_of_nodes(),
        "edges": g.number_of_edges(),
        "precomputed_weights": state.routing_engine._precomputed_weights,
        "gnn_type": (type(state.routing_engine.gnn).__name__
                     if state.routing_engine.gnn is not None else "exported"),
        **region,
    }


@router.post("/api/routing/compute", response_model=RouteResponse)
def compute_route(
    req: RouteRequest,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    try:
        obs = _load_active_obstructions(db)
        result = state.routing_engine.compute_route(req.source_node, req.target_node, obstructions=obs)
        return RouteResponse(**result)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Routing error: {exc}")


@router.get("/api/routing/graph/summary")
def graph_summary(_auth: Users = Depends(require_admin)):
    return state.routing_engine.graph.summary()


@router.get("/api/routing/gnn-constraints")
def gnn_constraints(
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    """Return GAT-predicted per-road constraints + user-drawn custom constraints.

    Each feature carries its own map_color / map_weight / map_opacity and
    display_constraint_type so the map can render the constraint palette
    directly. A routing_multiplier (resolved from the style config by
    routing_constraint_type) is attached for the routing engine's edge costs,
    and meta.legend is built server-side so the map legend is independent of
    the style config (it also covers the GAT-only prediction buckets).
    """
    cached = state.gnn_constraints_cache
    if cached is not None and cached[0] == state.routing_generation:
        return cached[1]
    generation = state.routing_generation
    source = state.active_model_source

    style = _load_constraint_style(source)
    multiplier_by_type = {
        k: v.get("routing_multiplier", 1.0)
        for k, v in style.items()
        if isinstance(v, dict)
    }

    # Regions without a trained constraint model (anything but Panabo) have no
    # predictions to serve; the map's GNN-constraints layer just stays empty.
    constraints_path, _ = constraint_paths(source)
    if not constraints_path or not constraints_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No predicted constraints for region '{Config.REGION}'",
        )

    with open(constraints_path, encoding="utf-8") as f:
        raw = json.load(f)

    custom_rows = db.query(GnnConstraint).filter(GnnConstraint.is_active.is_(True)).all()
    index = load_segment_index(constraints_path) if any(c.segment_uids is None for c in custom_rows) else None
    covered = set()
    for c in custom_rows:
        covered.update(c.segment_uids if c.segment_uids is not None else index.snap(json.loads(c.coordinates)))

    features: list = []
    type_counts: dict[str, int] = {}
    type_color: dict[str, str] = {}   # display type → its map_color (for legend)
    constrained = 0
    threshold = None
    model_name = "GAT"

    for feat in raw.get("features", []):
        props = feat.get("properties", {}) or {}
        geom = feat.get("geometry") or {}
        if geom.get("type") != "LineString" or not geom.get("coordinates"):
            continue
        uid = segment_uid(feat)
        if uid in covered:
            continue

        dtype = props.get("display_constraint_type") or "normal"
        type_counts[dtype] = type_counts.get(dtype, 0) + 1
        type_color.setdefault(dtype, props.get("map_color") or "#B0BEC5")
        if props.get("model_predicted_constrained"):
            constrained += 1
        if threshold is None:
            threshold = props.get("model_threshold")
            model_name = props.get("actual_model_used", model_name)

        rtype = props.get("routing_constraint_type") or dtype
        out = {k: props.get(k) for k in _CONSTRAINT_PROP_KEYS}
        out["segment_uid"] = uid
        out["routing_multiplier"] = multiplier_by_type.get(rtype, 1.0)
        out["display_label"] = _label_for(dtype, style)
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": geom["coordinates"]},
            "properties": out,
        })

    # ── Merge user-drawn custom constraints, styled from the GAT palette ───────
    for c in custom_rows:
        from services.constraint_schedule import constraint_style_key
        style_key = constraint_style_key(c)
        s = style.get(style_key, {})
        type_counts[style_key] = type_counts.get(style_key, 0) + 1
        type_color.setdefault(style_key, s.get("color", "#E53935"))
        constrained += 1
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": json.loads(c.coordinates)},
            "properties": {
                "display_constraint_type": style_key,
                "routing_constraint_type": style_key,
                "display_label": c.name or s.get("label", style_key),
                "map_color": s.get("color", "#E53935"),
                "map_weight": s.get("weight", 4),
                "map_opacity": s.get("opacity", 0.95),
                "routing_multiplier": s.get("routing_multiplier", 1.45),
                "model_predicted_constrained": 1,
                "hover_confidence_text": "Selected road edge" if any(uid.startswith('edge-v1-') for uid in (c.segment_uids or [])) else "Saved road constraint",
                "custom": True,
                "constraint_id": c.constraint_id,
                "narrow_severity": c.narrow_severity,
                "traffic_schedule": c.traffic_schedule,
                "segment_uids": c.segment_uids if c.segment_uids is not None else index.snap(json.loads(c.coordinates)),
                "annotation_source": "user_drawn",
            },
        })

    # ── Legend (server-built, sorted: constrained types by count, normal last) ─
    legend = [
        {
            "type": t,
            "label": _label_for(t, style),
            "color": type_color.get(t, "#B0BEC5"),
            "count": type_counts[t],
            "routing_multiplier": multiplier_by_type.get(t, 1.0),
        }
        for t in type_counts
    ]
    legend.sort(key=lambda it: (it["type"] == "normal", -it["count"]))

    result = {
        "constraints": {
            "type": "FeatureCollection",
            "features": features,
        },
        "style_config": style,
        "meta": {
            "model_version": source["version"] if source else None,
            "model": model_name,
            "threshold": threshold,
            "total": len(features),
            "constrained": constrained,
            "type_counts": type_counts,
            "legend": legend,
        },
    }
    if generation == state.routing_generation:
        state.gnn_constraints_cache = (generation, result)
    return result


@router.get("/api/routing/nearest-station")
def nearest_station(lat: float, lon: float, _auth: Users = Depends(require_admin)):
    node_id = state.routing_engine.nearest_station_node(lat, lon)
    if node_id is None:
        raise HTTPException(status_code=404, detail="No station node found near that location.")
    node_data = state.routing_engine.graph.G.nodes[node_id]
    return {"node_id": node_id, "lat": node_data["lat"], "lon": node_data["lon"]}


# Default catch radius for snapping a dispatcher's click onto a road. Wide
# enough to forgive an imprecise click at city zoom, tight enough that a click
# on open ground is rejected rather than dragged onto some distant street.
SNAP_RADIUS_M: float = 60.0


@router.get("/api/routing/snap")
def snap_to_road(
    lat: float,
    lon: float,
    radius_m: float = SNAP_RADIUS_M,
    _auth: Users = Depends(require_admin),
):
    """
    Snap a coordinate onto the nearest road segment.

    Called on pointer movement while an obstruction is being placed, so the
    map can show where the marker would actually land, and again on save so a
    stored obstruction always sits on the network the router uses.

    Returns ``{"snapped": null}`` rather than 404 when nothing is in range:
    "no road here" is the normal answer to a hover over open ground, not an
    error worth logging on every mouse move.
    """
    if state.routing_engine is None:
        raise HTTPException(status_code=503, detail="Routing engine unavailable.")
    hit = state.routing_engine.graph.snap_point(lat, lon, radius_km=radius_m / 1000.0)
    return {"snapped": hit}
