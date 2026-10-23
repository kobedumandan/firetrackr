"""
Response-coverage (reachability isochrone) computation.

Given the loaded routing graph and a set of source nodes (fire stations), runs a
multi-source Dijkstra on the SAME constraint-aware edge costs the router uses to
find how long a truck takes to reach every road. Reachable road segments are
bucketed into time bands (e.g. <=3 / <=5 / <=8 min); each band is turned into a
filled polygon by fattening (buffering) its reachable road lines and unioning
them. Per-barangay coverage percentages are then measured by intersecting each
band polygon with the barangay boundaries.

Pure graph/geometry math — no FastAPI/DB imports — so it is easy to test and can
be reused by a pool worker later. Blocked roads (infinite edge weight) are
skipped, so coverage honestly reflects what the routing engine can traverse.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Sequence, Tuple

import networkx as nx
from shapely.geometry import LineString, MultiLineString, mapping, shape
from shapely.ops import linemerge, unary_union

logger = logging.getLogger(__name__)

# Default response-time bands, in minutes (nested: <=3 subset of <=5 subset of <=8).
DEFAULT_BANDS_MIN: Tuple[int, ...] = (3, 5, 8)

# ~40 m expressed in degrees near the equator. Reachable road lines are buffered
# by this so adjacent covered roads merge into one filled coverage blob rather
# than hairline strokes. Coverage therefore follows the road corridors — an
# honest "these roads are reachable within N min" rather than a filled circle.
BUFFER_DEG: float = 0.0004

# Polygon simplification tolerance (degrees) to keep the GeoJSON payload small.
SIMPLIFY_DEG: float = 0.0002

# Buffer smoothness (quadrant segments). 1 = coarse/fast; the coverage blob is a
# planning aid, not a survey boundary, so low detail is fine and much faster.
BUFFER_QUAD_SEGS: int = 1

# Fastest band green (well covered) -> amber -> red (slow to reach). One per band.
BAND_COLORS: Tuple[str, ...] = ("#22c55e", "#f59e0b", "#ef4444", "#b91c1c")

# Coverage-status thresholds (percent of a barangay reachable within the band).
_GOOD_PCT = 80.0
_PARTIAL_PCT = 40.0


def _status_for(pct: float) -> str:
    if pct >= _GOOD_PCT:
        return "covered"
    if pct >= _PARTIAL_PCT:
        return "partial"
    return "gap"


def _edge_weight_fn(edge_costs: Dict[Tuple[int, int], float]):
    """Build a NetworkX weight callable backed by the router's edge-cost dict.

    Falls back to the edge's own ``weight``/``travel_time_s`` when a pair is
    missing, and returns ``None`` for blocked (infinite-cost) edges so Dijkstra
    treats them as impassable instead of traversable-but-expensive.
    """

    def wfn(u: int, v: int, data: Dict[str, Any]):
        cost = edge_costs.get((u, v))
        if cost is None:
            cost = data.get("weight", data.get("travel_time_s", 60.0))
        if cost == float("inf"):
            return None
        return cost

    return wfn


def compute_coverage(
    graph,
    edge_costs: Dict[Tuple[int, int], float],
    source_nodes: Sequence[int],
    barangays_geojson: Dict[str, Any] | None = None,
    bands_min: Sequence[int] = DEFAULT_BANDS_MIN,
) -> Dict[str, Any] | None:
    """Compute reachability isochrones + per-barangay coverage from stations.

    Args:
        graph: the RoadNetworkGraph (uses ``graph.G``, a NetworkX DiGraph whose
            nodes carry ``lat``/``lon``).
        edge_costs: ``(u, v) -> cost`` from the routing engine's
            ``_compute_edge_costs`` (constraint-aware travel time; ``inf`` when
            blocked).
        source_nodes: graph node ids to expand from (stations snapped to nodes).
        barangays_geojson: FeatureCollection of barangay polygons; when given,
            per-band coverage percentages are computed. Names come from
            ``properties.adm4_en``.
        bands_min: response-time band edges in minutes, ascending.

    Returns a dict with ``isochrones`` (GeoJSON FeatureCollection, one nested
    polygon per band), ``gaps_by_min`` (``{minutes: [rows sorted worst-first]}``),
    and ``meta``. Returns ``None`` if no source node is on the graph.
    """
    G = graph.G
    bands_min = [int(m) for m in bands_min]
    bands_s = [m * 60.0 for m in bands_min]
    max_s = max(bands_s)

    sources = [n for n in source_nodes if n in G]
    if not sources:
        logger.warning("Coverage: no source nodes on the graph — nothing to compute.")
        return None

    t0 = time.perf_counter()

    # 1. Multi-source Dijkstra: min constraint-aware travel time from the nearest
    #    station to every node reachable within the widest band.
    dist = nx.multi_source_dijkstra_path_length(
        G, sources, cutoff=max_s, weight=_edge_weight_fn(edge_costs)
    )

    # 2. Assign each reachable (undirected) road segment to the tightest band its
    #    slower endpoint falls in.
    lines_by_band: List[List[LineString]] = [[] for _ in bands_s]
    seen: set = set()
    for u, v in G.edges():
        du, dv = dist.get(u), dist.get(v)
        if du is None or dv is None:
            continue
        key = (u, v) if u < v else (v, u)
        if key in seen:
            continue
        seen.add(key)
        seg_time = max(du, dv)
        for bi, bs in enumerate(bands_s):
            if seg_time <= bs:
                a, b = G.nodes[u], G.nodes[v]
                lines_by_band[bi].append(
                    LineString([(a["lon"], a["lat"]), (b["lon"], b["lat"])])
                )
                break

    # 3. Buffer each band's OWN (disjoint) reachable segments into a filled area.
    #    Merging the many tiny road segments into long polylines first
    #    (linemerge) makes the buffer roughly 10x cheaper than buffering and
    #    unioning every segment individually. Bands are then nested by unioning
    #    the per-band polygons — cheap, since only a handful of polygons remain.
    band_polys: List[Any] = []
    for lst in lines_by_band:
        if not lst:
            band_polys.append(None)
            continue
        merged = linemerge(MultiLineString(lst))
        band_polys.append(merged.buffer(BUFFER_DEG, quad_segs=BUFFER_QUAD_SEGS))

    features: List[Dict[str, Any]] = []
    polys_cum: List[Any] = []
    accumulated_polys: List[Any] = []
    previous_display = None
    for bi, bs in enumerate(bands_s):
        if band_polys[bi] is not None:
            accumulated_polys.append(band_polys[bi])
        if not accumulated_polys:
            polys_cum.append(None)
            continue
        # Measure the cumulative reachable area before display simplification.
        # Simplifying each band independently can remove different slivers and
        # make a wider time band appear to cover less of a barangay.
        poly = unary_union(accumulated_polys)
        polys_cum.append(poly)
        display_poly = poly.simplify(SIMPLIFY_DEG)
        if previous_display is not None:
            display_poly = display_poly.union(previous_display)
        previous_display = display_poly
        features.append(
            {
                "type": "Feature",
                "geometry": mapping(display_poly),
                "properties": {
                    "max_seconds": bs,
                    "max_minutes": bands_min[bi],
                    "label": f"≤ {bands_min[bi]} min",
                    "color": BAND_COLORS[min(bi, len(BAND_COLORS) - 1)],
                },
            }
        )

    # 4. Per-barangay coverage % for every band (worst-covered first).
    gaps_by_min: Dict[int, List[Dict[str, Any]]] = {}
    bgy_shapes: List[Tuple[str, Any, float]] = []
    for feat in (barangays_geojson or {}).get("features", []):
        name = (feat.get("properties") or {}).get("adm4_en") or "—"
        try:
            g = shape(feat["geometry"])
        except Exception:
            continue
        if not g.is_valid:
            g = g.buffer(0)
        bgy_shapes.append((name, g, g.area))

    for bi, m in enumerate(bands_min):
        poly = polys_cum[bi]
        rows: List[Dict[str, Any]] = []
        for name, g, area in bgy_shapes:
            if poly is None or area <= 0:
                pct = 0.0
            else:
                try:
                    pct = max(0.0, min(100.0, g.intersection(poly).area / area * 100.0))
                except Exception:
                    pct = 0.0
            rows.append(
                {"barangay": name, "covered_pct": round(pct, 1), "status": _status_for(pct)}
            )
        rows.sort(key=lambda r: r["covered_pct"])
        gaps_by_min[m] = rows

    elapsed = (time.perf_counter() - t0) * 1000
    logger.info(
        "Coverage: %d sources, %d reachable nodes, %d bands, %d barangays in %.0fms",
        len(sources), len(dist), len(features), len(bgy_shapes), elapsed,
    )

    return {
        "isochrones": {"type": "FeatureCollection", "features": features},
        "gaps_by_min": gaps_by_min,
        "meta": {
            "bands_min": bands_min,
            "sources": len(sources),
            "reachable_nodes": len(dist),
            "barangays": len(bgy_shapes),
            "generated_ms": round(elapsed),
        },
    }
