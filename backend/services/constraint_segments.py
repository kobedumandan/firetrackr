"""Stable segment identities and metric snapping for drawn annotations.

Prefer a supplied segment_uid. Legacy exports use a direction-independent
geometry hash, never their positional road_id. Keep this fallback unchanged
until the master layer and its re-export supply canonical segment_uids.
"""
import hashlib
import json
import math
from functools import lru_cache

from pyproj import Transformer
from shapely.geometry import LineString, shape
from shapely.ops import transform
from shapely.strtree import STRtree


def validate_coordinates(coordinates):
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise ValueError("At least 2 coordinate points required.")
    for point in coordinates:
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            raise ValueError("Each coordinate must be a [longitude, latitude] pair.")
        lon, lat = point
        if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in point):
            raise ValueError("Coordinates must be finite numbers.")
        if not -180 <= lon <= 180 or not -90 <= lat <= 90:
            raise ValueError("Coordinates are outside longitude/latitude bounds.")
    if LineString(coordinates).length == 0:
        raise ValueError("The polyline must have nonzero length.")
    return coordinates


def segment_uid(feature):
    uid = (feature.get("properties") or {}).get("segment_uid")
    if uid is not None and str(uid).strip():
        return str(uid)
    coords = tuple(tuple(round(float(v), 7) for v in p[:2]) for p in feature["geometry"]["coordinates"])
    canonical = min(coords, tuple(reversed(coords)))
    digest = hashlib.sha256(json.dumps(canonical, separators=(",", ":")).encode()).hexdigest()
    return "geom-v1-" + digest


class SegmentIndex:
    def __init__(self, features):
        self.features = {}
        self.geometries = []
        self.uids = []
        # Panabo is in UTM zone 51N; lengths and buffers below are metres.
        self.project = Transformer.from_crs(4326, 32651, always_xy=True).transform
        for feature in features:
            if (feature.get("geometry") or {}).get("type") != "LineString":
                continue
            uid = segment_uid(feature)
            geom = transform(self.project, shape(feature["geometry"]))
            if geom.is_empty or geom.length == 0:
                continue
            if uid in self.features:
                raise ValueError(f"Duplicate segment identity in road export: {uid}")
            self.features[uid] = feature
            self.uids.append(uid)
            self.geometries.append(geom)
        self.tree = STRtree(self.geometries)

    def snap(self, coordinates, buffer_m=8.0, min_coverage=0.60):
        validate_coordinates(coordinates)
        corridor = transform(self.project, LineString(coordinates)).buffer(buffer_m)
        return sorted(
            self.uids[i] for i in self.tree.query(corridor)
            if self.geometries[i].intersection(corridor).length / self.geometries[i].length >= min_coverage
        )


@lru_cache(maxsize=2)
def _load_index(path, modified_ns):
    with open(path, encoding="utf-8") as source:
        return SegmentIndex(json.load(source).get("features", []))


def load_segment_index(path=None):
    if path is None:
        from services.model_source import active_paths
        path, _ = active_paths()
    if path is None or not path.exists():
        raise FileNotFoundError("This region has no constraint segment export.")
    return _load_index(str(path), path.stat().st_mtime_ns)


def overlay_features(rows, index, style):
    """Use exact road geometries, not imprecise drawn vertices, for routing."""
    from services.constraint_schedule import constraint_style_key

    selected = {}
    for row in rows:
        uids = row.segment_uids if row.segment_uids is not None else index.snap(json.loads(row.coordinates))
        key = constraint_style_key(row)
        multiplier = max(1.0, float(style.get(key, {}).get("routing_multiplier", 1.45)))
        for uid in uids:
            original = index.features.get(uid)
            if original is None and uid.startswith('edge-v1-'):
                from services.road_edges import edge_uid
                coordinates = json.loads(row.coordinates)
                if edge_uid(coordinates) == uid:
                    original = {'geometry': {'type': 'LineString', 'coordinates': coordinates}, 'properties': {}}
            if original is None:
                continue
            previous = selected.get(uid)
            if previous and previous["properties"]["routing_multiplier"] >= multiplier:
                continue
            selected[uid] = {
                "type": "Feature", "geometry": original["geometry"],
                "properties": {**original.get("properties", {}), "segment_uid": uid,
                               "routing_multiplier": 1.0 if getattr(row, 'traffic_schedule', None) else multiplier,
                               "admin_constraint": bool(getattr(row, 'narrow_severity', None) or getattr(row, 'traffic_schedule', None)),
                               "traffic_schedule": getattr(row, 'traffic_schedule', None),
                               "scheduled_multiplier": multiplier,
                               "routing_constraint_type": key},
            }
    return list(selected.values())
