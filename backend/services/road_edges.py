"""Selectable QGIS road chains between connected junctions and dead ends.

Use shared network vertices, not visual crossings (bridges are not junctions).
Collapse opposite directions into one selectable road without changing routing.
"""
from collections import defaultdict
from functools import lru_cache
import hashlib
import json


def edge_uid(coordinates):
    points = tuple(tuple(round(float(v), 6) for v in p[:2]) for p in coordinates)
    canonical = min(points, tuple(reversed(points)))
    return 'edge-v1-' + hashlib.sha256(json.dumps(canonical, separators=(',', ':')).encode()).hexdigest()


def build_road_edges(features):
    neighbours = defaultdict(set)
    metadata = {}
    for feature in features:
        geometry = feature.get('geometry') or {}
        if geometry.get('type') != 'LineString':
            continue
        points = [tuple(round(float(v), 6) for v in p[:2]) for p in geometry['coordinates']]
        for a, b in zip(points, points[1:]):
            if a == b:
                continue
            neighbours[a].add(b)
            neighbours[b].add(a)
            metadata.setdefault(tuple(sorted((a, b))), feature.get('properties') or {})
    visited, result = set(), {}
    # Junctions first; remaining degree-two components are closed road loops.
    starts = sorted(neighbours, key=lambda p: (len(neighbours[p]) == 2, p))
    for start in starts:
        for following in sorted(neighbours[start]):
            pair = tuple(sorted((start, following)))
            if pair in visited:
                continue
            coordinates = [start, following]
            visited.add(pair)
            previous, current = start, following
            while len(neighbours[current]) == 2 and current != start:
                next_point = next(p for p in neighbours[current] if p != previous)
                next_pair = tuple(sorted((current, next_point)))
                if next_pair in visited:
                    break
                visited.add(next_pair)
                coordinates.append(next_point)
                previous, current = current, next_point
            uid = edge_uid(coordinates)
            props = metadata[pair]
            result[uid] = {'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': coordinates},
                           'properties': {'segment_uid': uid, 'name': props.get('name') or 'Unnamed road',
                                          'highway': props.get('highway') or '', 'surface': props.get('surface') or ''}}
    return result


@lru_cache(maxsize=2)
def _load(path, modified_ns):
    import geopandas as gpd
    roads = gpd.read_file(path).to_crs(epsg=4326)
    return build_road_edges(json.loads(roads.to_json())['features'])


def load_road_edges():
    from ai import Config
    path = Config.ROADS_GPKG
    if path is None or not path.exists():
        raise FileNotFoundError('The QGIS road network is unavailable.')
    return _load(str(path), path.stat().st_mtime_ns)
