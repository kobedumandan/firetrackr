"""Notebook Cell 14 line graph: segments sharing projected endpoints connect."""
from collections import defaultdict
from itertools import combinations

import numpy as np


def segment_edges(frame):
    projected = frame.to_crs(epsg=32651)
    endpoints = defaultdict(list)
    for i, geometry in enumerate(projected.geometry):
        if geometry is None or geometry.is_empty or geometry.geom_type != "LineString":
            raise ValueError("Segment graph requires nonempty LineStrings")
        coords = list(geometry.coords)
        for x, y, *_ in (coords[0], coords[-1]):
            endpoints[(round(x, 2), round(y, 2))].append(i)
    edges = set()
    for segments in endpoints.values():
        for a, b in combinations(segments, 2):
            if a != b:
                edges.add((a, b))
                edges.add((b, a))
    if not edges:
        raise ValueError("No segment adjacency edges were created")
    # Match notebook ordering for champion parity, including floating reduction order.
    return np.asarray(list(edges), dtype=np.int64).T
