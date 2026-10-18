"""
Road network graph builder for Panabo City.

Converts PostGIS geometry data (fire stations, incidents, road intersections)
into a NetworkX DiGraph and a PyTorch Geometric Data object for GNN input.
"""

from __future__ import annotations

import numpy as np
import networkx as nx
import scipy.sparse as sp
from typing import TYPE_CHECKING, List, Tuple, Optional, Dict, Any

if TYPE_CHECKING:
    from torch_geometric.data import Data


# ── Node feature indices ───────────────────────────────────────────────────────
# Each node (road intersection) carries these features:
#   [latitude, longitude, is_fire_station, is_incident_site,
#    avg_congestion, speed_limit_kmh, elevation_m]
NODE_FEATURE_DIM = 8


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two WGS84 points in kilometres."""
    R = 6371.0
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dlam = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(phi1) * np.cos(phi2) * np.sin(dlam / 2) ** 2
    return R * 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))


class RoadNetworkGraph:
    """
    Builds and manages the road network graph for GNN-based routing.

    Usage:
        graph = RoadNetworkGraph()
        graph.add_node(node_id=0, lat=7.308, lon=125.684, is_station=True)
        graph.add_node(node_id=1, lat=7.312, lon=125.690)
        graph.add_edge(0, 1, road_name="Quezon Ave", lanes=2)
        data = graph.to_pyg()          # PyTorch Geometric Data
        G   = graph.to_networkx()      # NetworkX DiGraph
    """

    def __init__(self):
        self.G: nx.DiGraph = nx.DiGraph()
        self._node_features: Dict[int, List[float]] = {}

    # ── Graph construction ────────────────────────────────────────────────────

    def add_node(
        self,
        node_id: int,
        lat: float,
        lon: float,
        is_station: bool = False,
        is_incident: bool = False,
        congestion: float = 0.0,
        speed_limit: float = 40.0,
        elevation: float = 0.0,
        road_type: float = 0.0,
        **attrs,
    ):
        features = [lat, lon, float(is_station), float(is_incident),
                    congestion, speed_limit, elevation, road_type]
        self._node_features[node_id] = features
        self.G.add_node(node_id, lat=lat, lon=lon, **attrs)

    def add_edge(
        self,
        u: int,
        v: int,
        road_name: str = "",
        lanes: int = 1,
        bidirectional: bool = True,
        travel_time: Optional[float] = None,
    ):
        u_data = self.G.nodes[u]
        v_data = self.G.nodes[v]
        dist_km = _haversine_km(u_data["lat"], u_data["lon"], v_data["lat"], v_data["lon"])
        speed_kmh = self._node_features[u][5]
        tt = travel_time if travel_time is not None else (dist_km / speed_kmh) * 3600

        edge_attrs = dict(distance_km=dist_km, travel_time_s=tt,
                          road_name=road_name, lanes=lanes, weight=tt)
        self.G.add_edge(u, v, **edge_attrs)
        if bidirectional:
            self.G.add_edge(v, u, **edge_attrs)

    # ── Conversion helpers ────────────────────────────────────────────────────

    def to_networkx(self) -> nx.DiGraph:
        return self.G

    def to_pyg(self) -> Data:
        """Convert to a PyTorch Geometric Data object for GNN input."""
        import torch
        from torch_geometric.data import Data

        nodes = sorted(self._node_features.keys())
        x = torch.tensor([self._node_features[n] for n in nodes], dtype=torch.float)

        # Build edge_index and edge_attr
        edges = list(self.G.edges(data=True))
        if not edges:
            edge_index = torch.zeros((2, 0), dtype=torch.long)
            edge_attr = torch.zeros((0, 2), dtype=torch.float)
        else:
            node_to_idx = {n: i for i, n in enumerate(nodes)}
            src = [node_to_idx[u] for u, v, _ in edges]
            dst = [node_to_idx[v] for u, v, _ in edges]
            edge_index = torch.tensor([src, dst], dtype=torch.long)
            edge_attr = torch.tensor(
                [[d.get("distance_km", 0.0), d.get("travel_time_s", 0.0)] for _, _, d in edges],
                dtype=torch.float,
            )

        return Data(x=x, edge_index=edge_index, edge_attr=edge_attr)

    def to_adjacency_matrix(self) -> sp.csr_matrix:
        """Scipy sparse adjacency matrix (weighted by travel time)."""
        return nx.to_scipy_sparse_array(self.G, weight="weight", format="csr")

    # ── Routing helpers ───────────────────────────────────────────────────────

    def shortest_path(self, source: int, target: int) -> List[int]:
        """Dijkstra shortest path by travel time (fallback routing)."""
        return nx.shortest_path(self.G, source=source, target=target, weight="weight")

    def shortest_path_length(self, source: int, target: int) -> float:
        return nx.shortest_path_length(self.G, source=source, target=target, weight="weight")

    def update_congestion(self, node_id: int, congestion: float):
        """Live update of congestion feature for a node (called from SUMO or IoT)."""
        if node_id in self._node_features:
            self._node_features[node_id][4] = max(0.0, min(1.0, congestion))

    def nodes_near(
        self, lat: float, lon: float, radius_km: float = 0.5
    ) -> List[Tuple[int, float]]:
        """Return (node_id, distance_km) pairs within radius_km of a coordinate."""
        results = []
        for n in self.G.nodes:
            d = _haversine_km(lat, lon, self.G.nodes[n]["lat"], self.G.nodes[n]["lon"])
            if d <= radius_km:
                results.append((n, d))
        return sorted(results, key=lambda x: x[1])

    def nearest_edge(
        self, lat: float, lon: float, radius_km: float = 0.5
    ) -> Optional[Tuple[int, int, float, float, float]]:
        """
        Snap (lat, lon) to the nearest road *segment* by perpendicular projection.

        Unlike :meth:`nodes_near`, which only measures straight-line distance to
        intersection vertices, this projects the point onto each edge segment.
        That keeps the snap on the road the point actually lies on instead of
        jumping to a closer intersection that belongs to a parallel road.

        Returns ``(u, v, proj_lat, proj_lon, perp_km)`` for the closest edge —
        ``(u, v)`` are its endpoints and ``(proj_lat, proj_lon)`` is the foot of
        the perpendicular along that segment — or ``None`` if no edge lies
        within ``radius_km``. Projection is done in a local planar frame
        (metres), accurate at city scale.
        """
        D2R = np.pi / 180.0
        cos0 = np.cos(lat * D2R)
        R = 6_371_000.0  # earth radius, metres

        def to_xy(la: float, lo: float) -> Tuple[float, float]:
            return lo * D2R * cos0 * R, la * D2R * R

        px, py = to_xy(lat, lon)
        best: Optional[Tuple[int, int, float, float, float]] = None
        best_d = float("inf")

        for u, v in self.G.edges():
            a, b = self.G.nodes[u], self.G.nodes[v]
            ax, ay = to_xy(a["lat"], a["lon"])
            bx, by = to_xy(b["lat"], b["lon"])
            dx, dy = bx - ax, by - ay
            seg_len2 = dx * dx + dy * dy
            if seg_len2 == 0.0:
                continue
            t = ((px - ax) * dx + (py - ay) * dy) / seg_len2
            t = max(0.0, min(1.0, t))
            ex = px - (ax + dx * t)
            ey = py - (ay + dy * t)
            d = (ex * ex + ey * ey) ** 0.5
            if d < best_d:
                best_d = d
                proj_lat = a["lat"] + (b["lat"] - a["lat"]) * t
                proj_lon = a["lon"] + (b["lon"] - a["lon"]) * t
                best = (u, v, proj_lat, proj_lon, d / 1000.0)

        if best is None or best[4] > radius_km:
            return None
        return best

    def _edge_geometry_index(self):
        """
        Endpoint coordinates of every edge as parallel numpy arrays.

        Cached and keyed on the edge count, the same way the routing engine
        caches midpoints. snap_point runs on mouse movement while a dispatcher
        is placing an obstruction, so it cannot afford nearest_edge's
        per-call Python loop over the whole network.
        """
        n_edges = self.G.number_of_edges()
        cache = getattr(self, "_edge_geom_cache", None)
        if cache is not None and cache[0] == n_edges:
            return cache[1]

        us, vs, alat, alon, blat, blon = [], [], [], [], [], []
        for u, v in self.G.edges():
            a, b = self.G.nodes[u], self.G.nodes[v]
            us.append(u)
            vs.append(v)
            alat.append(a["lat"])
            alon.append(a["lon"])
            blat.append(b["lat"])
            blon.append(b["lon"])

        index = tuple(
            np.asarray(arr, dtype=dt)
            for arr, dt in (
                (us, np.int64), (vs, np.int64),
                (alat, np.float64), (alon, np.float64),
                (blat, np.float64), (blon, np.float64),
            )
        )
        self._edge_geom_cache = (n_edges, index)
        return index

    def snap_point(
        self, lat: float, lon: float, radius_km: float = 0.05
    ) -> Optional[Dict[str, Any]]:
        """
        Snap a coordinate onto the nearest road segment.

        Same projection as :meth:`nearest_edge` -- a local planar frame in
        metres, accurate at city scale -- but evaluated over all edges at once.

        Returns the snapped point, the distance to it, and the bearing of the
        road there (degrees clockwise from north, 0-180 since a road has no
        inherent direction for this purpose). The bearing is what lets the map
        draw a marker *across* the carriageway instead of a pin beside it.
        Returns None when no road lies within ``radius_km``.
        """
        us, vs, alat, alon, blat, blon = self._edge_geometry_index()
        if us.size == 0:
            return None

        D2R = np.pi / 180.0
        R = 6_371_000.0
        cos0 = np.cos(lat * D2R)

        px, py = lon * D2R * cos0 * R, lat * D2R * R
        ax, ay = alon * D2R * cos0 * R, alat * D2R * R
        bx, by = blon * D2R * cos0 * R, blat * D2R * R

        dx, dy = bx - ax, by - ay
        seg_len2 = dx * dx + dy * dy
        # Zero-length edges would divide by zero; park them at t=0 and let the
        # distance test discard them naturally.
        safe = np.where(seg_len2 == 0.0, 1.0, seg_len2)
        t = np.clip(((px - ax) * dx + (py - ay) * dy) / safe, 0.0, 1.0)
        t = np.where(seg_len2 == 0.0, 0.0, t)

        ex = px - (ax + dx * t)
        ey = py - (ay + dy * t)
        dist_m = np.sqrt(ex * ex + ey * ey)

        k = int(np.argmin(dist_m))
        best_m = float(dist_m[k])
        if best_m > radius_km * 1000.0:
            return None

        tk = float(t[k])
        proj_lat = float(alat[k] + (blat[k] - alat[k]) * tk)
        proj_lon = float(alon[k] + (blon[k] - alon[k]) * tk)

        bearing = float(np.degrees(np.arctan2(float(dx[k]), float(dy[k]))) % 180.0)

        return {
            "latitude":    proj_lat,
            "longitude":   proj_lon,
            "distance_m":  round(best_m, 2),
            "bearing_deg": round(bearing, 2),
            "u": int(us[k]),
            "v": int(vs[k]),
        }

    # ── Statistics ────────────────────────────────────────────────────────────

    def summary(self) -> Dict[str, Any]:
        return {
            "num_nodes": self.G.number_of_nodes(),
            "num_edges": self.G.number_of_edges(),
            "is_connected": nx.is_weakly_connected(self.G),
            "avg_degree": np.mean([d for _, d in self.G.degree()]) if self.G.number_of_nodes() else 0,
        }
