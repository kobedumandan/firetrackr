"""
GeoAI Routing Engine — ties together the GNN models, RL agents,
NetworkX graph, and SUMO simulation into one callable interface
that the FastAPI endpoints will use.

Call flow for a dispatch request:
  1. Use the loaded directed road graph.
  2. Read exported constraint costs (default), or run the explicit local GNN.
     Without exports, exported mode uses base travel times.
  3. ALT (A* with Landmarks and Triangle inequality) searches the active costs.
  4. Return route (WKT LINESTRING), ETA, and confidence score.
"""

from __future__ import annotations

import heapq
import logging
import time
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional, Tuple, Dict, Any

import numpy as np

if TYPE_CHECKING:
    import torch

from .graph_builder import RoadNetworkGraph
from .sumo_interface import SUMOInterface

logger = logging.getLogger(__name__)

# How much to penalise low-GNN-score roads relative to travel_time_s.
# Edge cost = travel_time_s * (1 + (1 - gnn_score) * GNN_PENALTY_WEIGHT)
# Range: [travel_time_s * 1.0,  travel_time_s * 1.5]
# Always >= travel_time_s, so landmark heuristics remain admissible.
GNN_PENALTY_WEIGHT: float = 0.5

# How much scheduled congestion inflates an edge's cost on the constraint path.
# Edge cost *= 1 + congestion * CONGESTION_WEIGHT, with congestion (derived from
# the GAT geojson's time-of-day traffic schedule) in [0, 1) → factor in
# [1.0, 3.0). Always >= 1.0, so the ALT landmark heuristic (precomputed on the
# un-congested "weight") stays admissible.
CONGESTION_WEIGHT: float = 2.0

# ── Scheduled congestion (replaces the deprecated SUMO live feed) ─────────────
# Each road in the GAT geojson carries a time-of-day traffic schedule. We fold
# that schedule into a per-edge congestion vector (one value per bucket below)
# at load time, then pick the bucket matching the current wall-clock at route
# time. No live data source needed.
_TRAFFIC_BUCKETS: Tuple[str, ...] = ("morning", "noon", "afternoon", "evening", "night")
_BUCKET_MINUTE_RANGES: Dict[str, List[Tuple[int, int]]] = {
    "morning":   [(6 * 60, 10 * 60)],   # 06:00–10:00
    "noon":      [(10 * 60, 14 * 60)],  # 10:00–14:00
    "afternoon": [(14 * 60, 18 * 60)],  # 14:00–18:00
    "evening":   [(18 * 60, 22 * 60)],  # 18:00–22:00
    "night":     [(22 * 60, 24 * 60), (0, 6 * 60)],  # 22:00–06:00 (wraps midnight)
}
# traffic_severity / school_*_severity (ordinal 0-3) → congestion in [0, 1).
# Capped below 1.0 so scheduled traffic heavily penalises but never hard-blocks
# a road — only blockades/floods (applied as inf weights) do that.
_SEVERITY_TO_CONGESTION: Dict[int, float] = {0: 0.0, 1: 0.4, 2: 0.7, 3: 0.95}
# A road flagged busy for a period but with no severity rating gets this.
_FLAGGED_BASE_CONGESTION: float = 0.4


# ALT search state: (previous node or None at the source, current node).
_SearchState = Tuple[Optional[int], int]


def _bucket_index_for_hour(hour: int) -> int:
    """Map a 24h clock hour to its index in _TRAFFIC_BUCKETS."""
    minute = hour * 60
    for i, name in enumerate(_TRAFFIC_BUCKETS):
        for start, end in _BUCKET_MINUTE_RANGES[name]:
            if start <= minute < end:
                return i
    return _TRAFFIC_BUCKETS.index("night")


def _parse_hhmm(value: Any) -> Optional[int]:
    """Parse a 'HH:MM' string to minutes-since-midnight, else None."""
    if not value:
        return None
    try:
        h, m = str(value).split(":")
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return None


def _buckets_for_window(start_min: int, end_min: int) -> set:
    """Return the set of bucket indices a [start, end] minute window overlaps."""
    # A window whose start >= end wraps past midnight.
    ranges = (
        [(start_min, 24 * 60), (0, end_min)]
        if start_min >= end_min
        else [(start_min, end_min)]
    )
    out: set = set()
    for i, name in enumerate(_TRAFFIC_BUCKETS):
        for bs, be in _BUCKET_MINUTE_RANGES[name]:
            for ws, we in ranges:
                if ws < be and bs < we:  # half-open overlap
                    out.add(i)
    return out


def _congestion_schedule_for_feature(props: Dict[str, Any]) -> List[float]:
    """
    Fold one road's time-of-day traffic fields into a per-bucket congestion
    vector aligned to _TRAFFIC_BUCKETS, each value in [0, 1).

    Combines three signals (taking the max in each bucket):
      1. binary traffic_<bucket> flags,
      2. explicit traffic_start/end_{1,2} windows, and
      3. school_<period>_severity ratings,
    each scaled by traffic_severity (or _FLAGGED_BASE_CONGESTION when a period
    is flagged busy but carries no severity).
    """
    vec = [0.0] * len(_TRAFFIC_BUCKETS)

    try:
        sev = int(props.get("traffic_severity") or 0)
    except (ValueError, TypeError):
        sev = 0
    sev_cong = _SEVERITY_TO_CONGESTION.get(sev, 0.0)
    active = sev_cong if sev_cong > 0 else _FLAGGED_BASE_CONGESTION

    # 1. Binary time-of-day flags → their own bucket.
    for i, name in enumerate(_TRAFFIC_BUCKETS):
        if props.get(f"traffic_{name}"):
            vec[i] = max(vec[i], active)

    # 2. Explicit traffic windows → every bucket they overlap.
    for s_key, e_key in (("traffic_start_1", "traffic_end_1"),
                         ("traffic_start_2", "traffic_end_2")):
        s = _parse_hhmm(props.get(s_key))
        e = _parse_hhmm(props.get(e_key))
        if s is None or e is None or s == e:
            continue
        for i in _buckets_for_window(s, e):
            vec[i] = max(vec[i], active)

    # 3. School-zone severities → their specific bucket.
    for name, key in (("morning", "school_morning_severity"),
                      ("noon", "school_noon_severity"),
                      ("afternoon", "school_afternoon_severity")):
        try:
            ssev = int(props.get(key) or 0)
        except (ValueError, TypeError):
            ssev = 0
        c = _SEVERITY_TO_CONGESTION.get(ssev, 0.0)
        if c > 0:
            vec[_TRAFFIC_BUCKETS.index(name)] = max(vec[_TRAFFIC_BUCKETS.index(name)], c)

    return vec


NUM_LANDMARKS: int = 16   # number of ALT landmark nodes

# -- Alternative-route generation ---------------------------------------------
# Alternatives come from the penalty method: re-run the search with the edges of
# the routes found so far made more expensive. On its own that guarantees a
# *different* path but says nothing about whether it is a *sensible* one, which
# is how a crew ends up offered a scenic detour through half the municipality.
# So every candidate has to pass the acceptance tests below before it is
# offered, and if none pass we return fewer routes. Two good routes beat three
# where one is nonsense.
PENALTY_FACTOR: float = 1.5    # gentle nudge, not a push-away; the tests below filter
MAX_ALT_STRETCH: float = 1.35  # an alternative may be at most 35% slower than the best
MAX_ALT_SHARING: float = 0.75  # ...and must differ by >25% of an accepted route's driving time
MAX_ALT_ATTEMPTS: int = 6      # searches to try before giving up on finding more

# How far from a road an obstruction may sit and still be attached to it. Past
# this it is treated as not on the network at all.
OBSTRUCTION_SNAP_RADIUS_KM: float = 0.06

# Extra reach around the snapped point, so a closure also takes the opposite
# carriageway of a divided road and the stub segments either side of the exact
# vertex it landed on.
#
# This used to be a flat 50m sweep over edge midpoints, which was far wider
# than it sounds: OSM splits roads into ~18m segments, so one blockade removed
# every approach to a junction in both directions -- about ten edges -- and on
# a sparse rural network that regularly severed origin from destination
# outright. Routing then correctly found no path, the reroute returned "no
# results", and it looked like obstructions were being ignored when in fact
# they were being applied far too aggressively.
OBSTRUCTION_SPREAD_M: float = 12.0
OBSTRUCTION_SEVERITY: Dict[str, float] = {
    "blockade":  float("inf"),   # fully blocked
    "flood":     float("inf"),   # impassable
    "repair":    5.0,            # 5x slower
    "accident":  8.0,            # 8x slower
}


class GeoAIRoutingEngine:

    def __init__(
        self,
        gnn_type: str = "gat",
        use_rl: bool = False,
        use_sumo: bool = False,
        gnn_model_path: Optional[str] = None,
        rl_model_path: Optional[str] = None,
        sumo_kwargs: Optional[Dict] = None,
        in_channels: int = 7,
        hidden_channels: int = 64,
        out_channels: int = 16,
        device: str = "cpu",
        inference_mode: str = "exported",
    ):
        if inference_mode not in {"exported", "local"}:
            raise ValueError("inference_mode must be 'exported' or 'local'")
        self.inference_mode = inference_mode
        self.device = device
        self.use_rl = use_rl
        self.use_sumo = use_sumo

        self._precomputed_weights = False  # set True after apply_edge_weights()
        self._use_constraint_costs = False  # set True after apply_predicted_constraints()

        # Per-edge time-of-day congestion vectors (one float per _TRAFFIC_BUCKETS
        # entry), built from the GAT geojson traffic schedule in
        # apply_predicted_constraints and read live in apply_congestion.
        self._edge_congestion_schedule: Dict[Tuple[int, int], List[float]] = {}
        self._edge_traffic_schedules = {}

        # Cached (edge_costs, node_scores_map) from the active cost source. The
        # graph sweep that builds these only changes when edge weights change, so
        # we hold the result and invalidate it in invalidate_landmarks() (the
        # single chokepoint every weight-mutating method already calls).
        self._edge_cost_cache: "Tuple[Dict[Tuple[int, int], float], Dict[int, float]] | None" = None
        # Edge midpoint coordinates for obstruction lookups, built on first
        # use and reused until the graph changes. See _edge_midpoint_index.
        self._edge_mid_cache: "Tuple[int, Any] | None" = None

        # ── GNN model ─────────────────────────────────────────────────────────
        self.gnn = None
        if inference_mode == "local":
            import torch
            from .gnn_models import GAT, PMGCN, GraphSAGE

            self.device = torch.device(device)
            if gnn_type == "pmgcn":
                self.gnn = PMGCN(
                    in_channels=in_channels,
                    hidden_channels=hidden_channels,
                    task_out_channels=out_channels,
                ).to(self.device)
            elif gnn_type == "graphsage":
                self.gnn = GraphSAGE(
                    in_channels=in_channels,
                    hidden_channels=hidden_channels,
                    out_channels=out_channels,
                ).to(self.device)
            else:
                self.gnn = GAT(
                    in_channels=in_channels,
                    hidden_channels=hidden_channels,
                    out_channels=out_channels,
                ).to(self.device)

            if gnn_model_path:
                self._load_gnn(gnn_model_path)
            self.gnn.eval()

        # ── RL agent (PPO) ────────────────────────────────────────────────────
        self.rl_agent = None
        if use_rl:
            from .rl_agents import PPOAgent

            self.rl_agent = PPOAgent(model_path=rl_model_path or "checkpoints/ppo_dispatch")
            if rl_model_path:
                try:
                    self.rl_agent.load()
                    logger.info("PPO agent loaded from %s", rl_model_path)
                except Exception as exc:
                    logger.warning("PPO load failed (%s) — running without trained RL weights.", exc)

        # ── SUMO interface ────────────────────────────────────────────────────
        self.sumo: Optional[SUMOInterface] = None
        if use_sumo:
            self.sumo = SUMOInterface(**(sumo_kwargs or {}))
            try:
                self.sumo.start()
                logger.info("SUMO simulation connected.")
            except Exception as exc:
                logger.warning("SUMO start failed (%s) — falling back to static routing.", exc)
                self.sumo = None

        # ── Road network graph ────────────────────────────────────────────────
        self.graph = RoadNetworkGraph()

        # ── ALT landmark state ────────────────────────────────────────────────
        self._landmark_nodes: List[int] = []
        self._landmark_dists: Dict[int, Dict[int, float]] = {}      # lm → {node: dist}
        self._landmark_dists_rev: Dict[int, Dict[int, float]] = {}  # lm → {node: dist} (reversed)
        self._landmarks_valid: bool = False

    # ── GNN helpers ───────────────────────────────────────────────────────────

    def _load_gnn(self, path: str):
        import torch

        state = torch.load(path, map_location=self.device, weights_only=True)
        self.gnn.load_state_dict(state)
        logger.info("GNN weights loaded from %s", path)

    def apply_edge_weights(self, weights: dict):
        """
        Apply precomputed GNN edge weights to graph edges.

        weights: dict mapping "u_v_0" (OSM node pair) → float score.
        Higher score = better road = lower Dijkstra cost.
        Modulates travel_time by a factor in [0.6, 1.0].
        """
        if not weights:
            return
        vals = list(weights.values())
        min_w, max_w = min(vals), max(vals)
        spread = max_w - min_w or 1e-6

        applied = 0
        for u, v, data in self.graph.G.edges(data=True):
            key = f"{u}_{v}_0"
            if key in weights:
                w = weights[key]
                factor = 1.0 - 0.4 * (w - min_w) / spread  # [0.6, 1.0]
                data["weight"] = data.get("travel_time_s", 60.0) * factor
                applied += 1

        self._precomputed_weights = True
        self.invalidate_landmarks()
        logger.info(
            "GraphSAGE edge weights applied: %d / %d edges covered",
            applied, self.graph.G.number_of_edges(),
        )

    def apply_predicted_constraints(
        self,
        features: List[Dict[str, Any]],
        multiplier_by_type: Optional[Dict[str, float]] = None,
    ) -> None:
        """
        Apply GAT-predicted per-road constraints to the routing graph.

        Each feature is a road segment whose geometry matches a road in the
        graph (built from roads_panabo.gpkg). For every consecutive coordinate
        pair we look up the graph edge by snapped (lon, lat) and set:

            edge["weight"]              = travel_time_s * routing_multiplier
            edge["routing_multiplier"]  = routing_multiplier

        The per-road multiplier is resolved in this order:
          1. the feature's own ``routing_multiplier`` property (if present);
          2. ``multiplier_by_type[routing_constraint_type]`` (falling back to
             ``display_constraint_type``) — used when the export only carries a
             constraint *type* and the multipliers live in the style config.

        Fully blocked segments (is_blocked == 1) get an infinite weight so the
        ALT search never traverses them. Because routing_multiplier >= 1.0,
        weight >= travel_time_s, keeping the ALT landmark heuristic admissible.

        After this call, route computations use these per-edge costs instead of
        the live GNN forward pass (see _compute_constraint_edge_costs).
        """
        if not features:
            return

        mult_by_type = multiplier_by_type or {}

        # Rebuilt from scratch on every (re)load so stale schedules don't linger.
        self._edge_congestion_schedule = {}
        self._edge_traffic_schedules = {}

        SNAP = 6  # must match qgis_loader.load_roads_gpkg SNAP_DECIMALS

        # Build a (lon, lat) → node_ids lookup from current graph nodes. A
        # coordinate can hold two nodes where the loader split a carriageway
        # U-turn (see qgis_loader._block_carriageway_uturns).
        coord_to_nodes: Dict[Tuple[float, float], List[int]] = {}
        for n, nd in self.graph.G.nodes(data=True):
            coord_to_nodes.setdefault(
                (round(nd["lon"], SNAP), round(nd["lat"], SNAP)), []
            ).append(n)

        def _edge_pairs(lon1, lat1, lon2, lat2):
            us = coord_to_nodes.get((round(lon1, SNAP), round(lat1, SNAP)), ())
            vs = coord_to_nodes.get((round(lon2, SNAP), round(lat2, SNAP)), ())
            return [(u, v) for u in us for v in vs]

        applied = 0
        for feat in features:
            props = feat.get("properties", {})
            geom = feat.get("geometry") or {}
            if geom.get("type") != "LineString":
                continue

            mult = props.get("routing_multiplier")
            if mult is None:
                ctype = props.get("routing_constraint_type") or props.get(
                    "display_constraint_type"
                )
                mult = mult_by_type.get(ctype, 1.0)
            try:
                mult = float(mult or 1.0)
            except (TypeError, ValueError):
                mult = 1.0

            blocked = bool(props.get("is_blocked", 0))
            coords = geom.get("coordinates", [])

            # Time-of-day congestion schedule for this road (skipped when blocked,
            # since an inf-weight edge is never traversed anyway).
            cong_vec = None if blocked else _congestion_schedule_for_feature(props)
            has_cong = bool(cong_vec) and any(cong_vec)

            for i in range(len(coords) - 1):
                lon1, lat1 = coords[i][0], coords[i][1]
                lon2, lat2 = coords[i + 1][0], coords[i + 1][1]
                # Update both directions; one-way roads only have one, and
                # has_edge skips the missing reverse.
                pairs = _edge_pairs(lon1, lat1, lon2, lat2)
                for a, b in pairs + [(v, u) for u, v in pairs]:
                    if not self.graph.G.has_edge(a, b):
                        continue
                    data = self.graph.G[a][b]
                    base = data.get("travel_time_s", 60.0)
                    data["routing_multiplier"] = mult
                    data["weight"] = float("inf") if blocked else base * mult
                    applied += 1

                    if props.get('admin_constraint'):
                        # Explicit admin constraints replace legacy congestion on
                        # these exact graph edges, including overnight schedules.
                        self._edge_congestion_schedule.pop((a, b), None)
                        self._edge_traffic_schedules.pop((a, b), None)
                        if props.get('traffic_schedule'):
                            self._edge_traffic_schedules[(a, b)] = (
                                props['traffic_schedule'], props['scheduled_multiplier'])
                        continue

                    if has_cong:
                        cur = self._edge_congestion_schedule.get((a, b))
                        if cur is None:
                            self._edge_congestion_schedule[(a, b)] = list(cong_vec)
                        else:
                            for k in range(len(cur)):
                                if cong_vec[k] > cur[k]:
                                    cur[k] = cong_vec[k]

        self._precomputed_weights = True
        self._use_constraint_costs = True
        self.invalidate_landmarks()
        logger.info(
            "GAT constraint multipliers applied: %d edge-directions over %d features "
            "(graph has %d edges)",
            applied, len(features), self.graph.G.number_of_edges(),
        )

    def _compute_constraint_edge_costs(
        self,
    ) -> Tuple[Dict[Tuple[int, int], float], Dict[int, float]]:
        """
        Build per-edge costs from the GAT routing multipliers stored on the
        graph (see apply_predicted_constraints), replacing the live GNN.

        Edge cost = the precomputed edge["weight"] (= travel_time_s * multiplier,
        or inf when blocked). node_scores_map carries a routing "goodness" in
        [0, 1] (1 / multiplier) per node, used only for the confidence metric.
        """
        edge_costs: Dict[Tuple[int, int], float] = {}
        node_mult_acc: Dict[int, List[float]] = {}

        for u, v, data in self.graph.G.edges(data=True):
            base = data.get("travel_time_s", 60.0)
            cost = data.get("weight", base)
            edge_costs[(u, v)] = cost
            mult = float(data.get("routing_multiplier", 1.0) or 1.0)
            node_mult_acc.setdefault(u, []).append(mult)
            node_mult_acc.setdefault(v, []).append(mult)

        node_scores_map: Dict[int, float] = {}
        for n in self.graph.G.nodes():
            mults = node_mult_acc.get(n)
            avg = (sum(mults) / len(mults)) if mults else 1.0
            node_scores_map[n] = 1.0 / avg if avg > 0 else 1.0

        return edge_costs, node_scores_map

    def _edge_midpoint_index(self):
        """
        Per-edge (u, v, midpoint lat, midpoint lon) as parallel numpy arrays.

        Built once and reused. apply_obstructions previously walked every edge
        in the graph for every obstruction, which cost ~300ms per obstruction
        on Panabo's 28k-edge network -- paid on every dispatch, every reroute
        and every responder location ping that recomputes a connector. The
        midpoints only move when the graph itself changes, so they are cached
        here and the distance test is vectorised against them.

        The cache is keyed on the edge count so a rebuilt graph cannot be
        matched against stale coordinates; invalidate_landmarks() also clears it.
        """
        n_edges = self.graph.G.number_of_edges()
        if self._edge_mid_cache is not None and self._edge_mid_cache[0] == n_edges:
            return self._edge_mid_cache[1]

        G = self.graph.G
        us, vs, mlat, mlon = [], [], [], []
        for u, v in G.edges():
            un, vn = G.nodes[u], G.nodes[v]
            us.append(u)
            vs.append(v)
            mlat.append((un["lat"] + vn["lat"]) / 2.0)
            mlon.append((un["lon"] + vn["lon"]) / 2.0)

        index = (
            np.asarray(us, dtype=np.int64),
            np.asarray(vs, dtype=np.int64),
            np.asarray(mlat, dtype=np.float64),
            np.asarray(mlon, dtype=np.float64),
        )
        self._edge_mid_cache = (n_edges, index)
        return index

    def apply_obstructions(
        self,
        obstructions: List[Dict[str, Any]],
        edge_costs: Dict[Tuple[int, int], float],
    ) -> Dict[Tuple[int, int], float]:
        """
        Overlay obstruction penalties onto an existing edge-cost dict.

        Each obstruction is snapped to the road segment it sits on and that
        segment is penalised in both directions, along with anything within
        OBSTRUCTION_SPREAD_M of the snapped point. Severity comes from
        OBSTRUCTION_SEVERITY: a multiplier, or inf for a full closure.

        An obstruction with no road within OBSTRUCTION_SNAP_RADIUS_KM is
        skipped and logged rather than applied to whatever is vaguely nearby.

        Returns the mutated edge_costs dict (same object, modified in place).
        """
        if not obstructions:
            return edge_costs

        us, vs, mlat, mlon = self._edge_midpoint_index()
        if us.size == 0:
            return edge_costs

        G = self.graph.G
        R_EARTH_KM = 6371.0088
        affected = 0
        unplaced = 0

        for obs in obstructions:
            olat, olon = float(obs["latitude"]), float(obs["longitude"])
            severity = OBSTRUCTION_SEVERITY.get(obs.get("type", "repair"), 5.0)

            # Attach the obstruction to one specific road segment rather than
            # to whatever happens to lie within a radius of it.
            hit = self.graph.snap_point(
                olat, olon, radius_km=OBSTRUCTION_SNAP_RADIUS_KM
            )
            if hit is None:
                unplaced += 1
                continue

            # The snapped segment, both ways: a closed road is closed in both
            # directions unless something says otherwise.
            targets = {(hit["u"], hit["v"]), (hit["v"], hit["u"])}

            # ...plus anything within the (small) spread of the snapped point,
            # measured from that point rather than the raw click.
            lat1 = np.radians(hit["latitude"])
            lat2 = np.radians(mlat)
            dlat = lat2 - lat1
            dlon = np.radians(mlon - hit["longitude"])
            a = (np.sin(dlat / 2.0) ** 2
                 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2.0) ** 2)
            dist_m = 2.0 * R_EARTH_KM * 1000.0 * np.arcsin(np.sqrt(a))
            for i in np.nonzero(dist_m <= OBSTRUCTION_SPREAD_M)[0]:
                targets.add((int(us[i]), int(vs[i])))

            for u, v in targets:
                if not G.has_edge(u, v):
                    continue
                if severity == float("inf"):
                    edge_costs[(u, v)] = float("inf")
                else:
                    data = G[u][v]
                    current = edge_costs.get(
                        (u, v), data.get("weight", data.get("travel_time_s", 60.0))
                    )
                    edge_costs[(u, v)] = current * severity
                affected += 1

        if unplaced:
            logger.warning(
                "Obstructions: %d of %d are not within %.0f m of any road and "
                "were ignored",
                unplaced, len(obstructions), OBSTRUCTION_SNAP_RADIUS_KM * 1000,
            )
        if affected:
            logger.info(
                "Obstructions: %d active, %d edge-costs modified",
                len(obstructions), affected,
            )
        return edge_costs

    def apply_congestion(
        self,
        edge_costs: Dict[Tuple[int, int], float],
        now: Optional[datetime] = None,
    ) -> Dict[Tuple[int, int], float]:
        """
        Overlay scheduled time-of-day congestion onto an existing edge-cost dict.

        Congestion comes from each road's traffic schedule in the GAT geojson,
        folded into per-edge per-bucket vectors at load time (see
        _edge_congestion_schedule / _congestion_schedule_for_feature). For the
        bucket matching ``now`` (defaults to the current wall-clock), each edge's
        cost is scaled by (1 + congestion * CONGESTION_WEIGHT), so roads that are
        busy at this hour cost proportionally more. This replaces the deprecated
        SUMO live feed — no external data source is required.

        Applied as a fresh per-route overlay (not baked into the cached constraint
        costs) so the penalty tracks the clock without busting the static cache.
        Because the factor is >= 1.0 the ALT landmark heuristic stays admissible.

        Returns the mutated edge_costs dict (same object, modified in place).
        """
        if not self._edge_congestion_schedule and not self._edge_traffic_schedules:
            return edge_costs

        from services.constraint_schedule import MANILA, schedule_active
        now = now or datetime.now(MANILA)
        now = now.replace(tzinfo=MANILA) if now.tzinfo is None else now.astimezone(MANILA)
        bucket = _bucket_index_for_hour(now.hour)

        affected = 0
        for (u, v), vec in self._edge_congestion_schedule.items():
            congestion = vec[bucket]
            if congestion <= 0.0:
                continue
            current = edge_costs.get((u, v))
            if current is None or current == float("inf"):
                continue
            edge_costs[(u, v)] = current * (1.0 + congestion * CONGESTION_WEIGHT)
            affected += 1

        if affected:
            logger.info(
                "Congestion [%s]: %d edge-costs inflated (CONGESTION_WEIGHT=%.1f)",
                _TRAFFIC_BUCKETS[bucket], affected, CONGESTION_WEIGHT,
            )
        for edge, (schedule, multiplier) in self._edge_traffic_schedules.items():
            current = edge_costs.get(edge)
            if current is not None and current != float('inf') and schedule_active(schedule, now):
                edge_costs[edge] = current * max(1.0, float(multiplier))
        return edge_costs

    def _run_gnn(self, data) -> torch.Tensor:
        """Run GNN forward pass and return node embeddings / scores."""
        import torch
        from .gnn_models import PMGCN

        x = data.x.to(self.device)
        edge_index = data.edge_index.to(self.device)
        with torch.no_grad():
            if isinstance(self.gnn, PMGCN):
                scores, _ = self.gnn(x, edge_index)
            else:
                scores = self.gnn(x, edge_index)
        return scores  # shape: [num_nodes, out_channels]

    # ── Congestion update ─────────────────────────────────────────────────────

    def _update_congestion_from_sumo(self):
        """Pull live congestion from SUMO and apply to graph nodes."""
        if self.sumo is None or not self.sumo.is_connected:
            return
        try:
            self.sumo.step()
            congestion_map = self.sumo.get_congestion_map()
            for edge_id, level in congestion_map.items():
                node_id = self._sumo_edge_to_node(edge_id)
                if node_id is not None:
                    self.graph.update_congestion(node_id, level)
        except Exception as exc:
            logger.warning("SUMO congestion update failed: %s", exc)

    def _sumo_edge_to_node(self, edge_id: str) -> Optional[int]:
        """Map a SUMO edge ID to a graph node ID. Override to suit your network."""
        try:
            return int(edge_id.split("_")[-1])
        except (ValueError, IndexError):
            return None

    # ── ALT landmark preprocessing ────────────────────────────────────────────

    def invalidate_landmarks(self):
        """Mark landmark cache as stale. Call after topology or weight changes."""
        self._landmarks_valid = False
        # Edge costs derive from the same weights as landmarks, so any change
        # that stales landmarks also stales the cached edge-cost dict.
        self._edge_cost_cache = None
        self._edge_mid_cache = None

    def _precompute_landmarks(self, num_landmarks: int = NUM_LANDMARKS) -> None:
        """
        Select landmark nodes with farthest-point selection and precompute
        shortest-path distances from/to each landmark using the base "weight"
        edge attribute (= travel_time_s at graph-build time).

        Because per-query GNN costs are always >= travel_time_s (penalty
        factor is in [1.0, 1.5]), these distances are valid admissible lower
        bounds for every ALT query.
        """
        import networkx as nx

        G = self.graph.G
        nodes = list(G.nodes())
        if len(nodes) < 2:
            logger.warning("Graph too small for landmark precomputation (%d nodes)", len(nodes))
            self._landmarks_valid = False
            return

        t0 = time.perf_counter()
        actual_k = min(num_landmarks, len(nodes))

        # ── Farthest-point landmark selection ─────────────────────────────────
        # Seed with a Dijkstra from nodes[0] to find the true farthest node.
        d0 = nx.single_source_dijkstra_path_length(G, nodes[0], weight="weight")
        first_lm = max(nodes, key=lambda v: d0.get(v, 0.0))

        landmarks: List[int] = [first_lm]
        fwd: Dict[int, Dict[int, float]] = {
            first_lm: dict(nx.single_source_dijkstra_path_length(G, first_lm, weight="weight"))
        }
        # min_dist[v] = distance from v to its nearest landmark so far
        min_dist: Dict[int, float] = {v: fwd[first_lm].get(v, float("inf")) for v in nodes}

        while len(landmarks) < actual_k:
            # The node farthest from all current landmarks becomes the next one
            next_lm = max(
                (v for v in nodes if v not in landmarks),
                key=lambda v: min_dist.get(v, 0.0),
                default=None,
            )
            if next_lm is None:
                break
            landmarks.append(next_lm)
            d = dict(nx.single_source_dijkstra_path_length(G, next_lm, weight="weight"))
            fwd[next_lm] = d
            for v in nodes:
                min_dist[v] = min(min_dist[v], d.get(v, float("inf")))

        # ── Backward distances (Dijkstra on reversed graph) ───────────────────
        rev_G = G.reverse(copy=False)
        rev: Dict[int, Dict[int, float]] = {
            lm: dict(nx.single_source_dijkstra_path_length(rev_G, lm, weight="weight"))
            for lm in landmarks
        }

        self._landmark_nodes = landmarks
        self._landmark_dists = fwd
        self._landmark_dists_rev = rev
        self._landmarks_valid = True

        elapsed = (time.perf_counter() - t0) * 1000
        logger.info(
            "ALT: %d landmarks precomputed in %.1fms (graph: %d nodes, %d edges)",
            len(landmarks), elapsed, G.number_of_nodes(), G.number_of_edges(),
        )

    def _alt_heuristic(self, node: int, target: int) -> float:
        """
        Admissible lower-bound on cost(node → target) via the triangle inequality:

          For each landmark L:
            cost(n, t) >= dist(L, t) - dist(L, n)   [forward]
            cost(n, t) >= dist(n, L) - dist(t, L)   [backward]
        """
        h = 0.0
        for lm in self._landmark_nodes:
            d_L_n = self._landmark_dists[lm].get(node, float("inf"))
            d_L_t = self._landmark_dists[lm].get(target, float("inf"))
            if d_L_t < float("inf") and d_L_n < float("inf"):
                h = max(h, d_L_t - d_L_n)

            d_n_L = self._landmark_dists_rev[lm].get(node, float("inf"))
            d_t_L = self._landmark_dists_rev[lm].get(target, float("inf"))
            if d_n_L < float("inf") and d_t_L < float("inf"):
                h = max(h, d_n_L - d_t_L)
        return h

    # ── ALT search ────────────────────────────────────────────────────────────

    def _alt_search(
        self,
        source: int,
        target: int,
        weight_overrides: Optional[Dict[Tuple[int, int], float]] = None,
        previous_node: Optional[int] = None,
    ) -> Tuple[List[int], float]:
        """
        A* search guided by the ALT heuristic, with U-turns forbidden.

        The search is edge-based: a state is (previous node, node), so it
        knows which way it arrived and can refuse to go straight back to the
        point it just left -- a fire truck cannot reverse mid-road, least of
        all on a flyover. "The point it just left" includes a node's twin at
        the same coordinate (qgis_loader splits carriageway junctions into
        such twins), which is what makes that split U-turn-proof.

        The node-based ALT heuristic stays admissible and consistent: banning
        transitions only removes paths, it never makes one cheaper.

        weight_overrides: per-edge cost map; used to carry GNN modulation and
                          cumulative penalties across multi-route calls.
        Returns (route_nodes, total_cost).
        Raises ValueError if target is unreachable.
        """
        if source == target:
            return [source], 0.0

        G = self.graph.G
        node_features = self.graph._node_features
        twins = self._colocated_nodes()

        def edge_cost(u: int, v: int) -> float:
            if weight_overrides and (u, v) in weight_overrides:
                return weight_overrides[(u, v)]
            data = G[u][v]
            return data.get("weight", data.get("travel_time_s", 60.0))

        start: _SearchState = (previous_node, source)
        h0 = self._alt_heuristic(source, target) if self._landmarks_valid else 0.0
        # heap entries: (f_score, g_score, tiebreak, state)
        counter = 0
        heap: List[Tuple[float, float, int, _SearchState]] = [(h0, 0.0, counter, start)]
        g_score: Dict[_SearchState, float] = {start: 0.0}
        came_from: Dict[_SearchState, _SearchState] = {}
        closed: set = set()

        while heap:
            _, g, _, state = heapq.heappop(heap)

            if state in closed:
                continue
            closed.add(state)
            prev, node = state

            if node == target:
                path: List[int] = []
                cur = state
                while cur != start:
                    path.append(cur[1])
                    cur = came_from[cur]
                path.append(source)
                path.reverse()
                return path, g

            for nb in G.successors(node):
                if prev is not None and (nb == prev or nb in twins.get(prev, ())):
                    continue  # U-turn
                nxt: _SearchState = (node, nb)
                if nxt in closed:
                    continue
                feats = node_features.get(nb)
                if feats is not None and feats[4] >= 1.0:
                    continue  # fully congested — impassable

                w = edge_cost(node, nb)
                new_g = g + w
                if new_g < g_score.get(nxt, float("inf")):
                    g_score[nxt] = new_g
                    came_from[nxt] = state
                    h = self._alt_heuristic(nb, target) if self._landmarks_valid else 0.0
                    counter += 1
                    heapq.heappush(heap, (new_g + h, new_g, counter, nxt))

        raise ValueError(f"ALT search could not reach node {target} from {source}")

    def _colocated_nodes(self) -> Dict[int, Tuple[int, ...]]:
        """{node: other nodes at the exact same coordinate}, only for nodes that
        have any. Cached per graph size; the graph topology is fixed after load.
        """
        G = self.graph.G
        key = G.number_of_nodes()
        cached = getattr(self, "_twins_cache", None)
        if cached is not None and cached[0] == key:
            return cached[1]
        by_coord: Dict[Tuple[float, float], List[int]] = {}
        for n, nd in G.nodes(data=True):
            by_coord.setdefault((nd["lat"], nd["lon"]), []).append(n)
        twins = {
            n: tuple(m for m in group if m != n)
            for group in by_coord.values() if len(group) > 1
            for n in group
        }
        self._twins_cache = (key, twins)
        return twins

    # ── GNN edge cost computation ─────────────────────────────────────────────

    def _compute_gnn_edge_costs(
        self,
    ) -> Tuple[Dict[Tuple[int, int], float], Dict[int, float]]:
        """
        Run GNN forward pass and build per-edge costs.

        Edge cost = travel_time_s * (1 + (1 - gnn_score) * GNN_PENALTY_WEIGHT)
        Factor range: [1.0, 1.5] — always >= travel_time_s, keeping landmark
        heuristics admissible.

        Returns:
          edge_costs:      (u, v) → float
          node_scores_map: node_id → normalised GNN score in [0, 1]
        """
        pyg_data = self.graph.to_pyg()
        node_scores = self._run_gnn(pyg_data)
        raw = node_scores.norm(dim=-1).cpu().numpy()
        w_min, w_max = float(raw.min()), float(raw.max())
        spread = w_max - w_min if w_max > w_min else 1e-6
        norm = (raw - w_min) / spread

        nodes_sorted = sorted(self.graph._node_features.keys())
        node_to_idx = {n: i for i, n in enumerate(nodes_sorted)}
        node_scores_map: Dict[int, float] = {n: float(norm[i]) for n, i in node_to_idx.items()}

        edge_costs: Dict[Tuple[int, int], float] = {}
        for u, v, data in self.graph.G.edges(data=True):
            gnn_score = node_scores_map.get(u, 0.5)
            penalty = 1.0 + (1.0 - gnn_score) * GNN_PENALTY_WEIGHT
            edge_costs[(u, v)] = data.get("travel_time_s", 60.0) * penalty

        return edge_costs, node_scores_map

    def _compute_edge_costs(
        self,
    ) -> Tuple[Dict[Tuple[int, int], float], Dict[int, float]]:
        """
        Return per-edge costs and per-node scores from the active source:
        Exported constraints/edge weights, base travel times, or explicit local GNN.

        On the exported path the costs only change when constraints are
        reloaded, so the result is cached and reused until invalidate_landmarks()
        clears it — repeated calls (e.g. the connector recomputed on every
        responder location ping) then skip the full-graph sweep. The live GNN
        path is NOT cached: it runs a fresh forward pass each call and reflects
        live SUMO congestion, so it must recompute every time.

        edge_costs is returned as a shallow copy because apply_obstructions
        mutates it in place; node_scores_map is read-only at every call site and
        is shared.
        """
        if self.inference_mode == "local":
            return self._compute_gnn_edge_costs()

        if not self._use_constraint_costs and not self._precomputed_weights:
            # Exported mode never falls back to a local model or random scores.
            return (
                {(u, v): data.get("travel_time_s", 60.0)
                 for u, v, data in self.graph.G.edges(data=True)},
                {n: 1.0 for n in self.graph.G.nodes()},
            )

        if self._edge_cost_cache is None:
            self._edge_cost_cache = self._compute_constraint_edge_costs()
        cached_edge_costs, cached_node_scores = self._edge_cost_cache
        return dict(cached_edge_costs), cached_node_scores

    # ── Main routing API ──────────────────────────────────────────────────────

    def compute_route(
        self,
        source_node: int,
        target_node: int,
        obstructions: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Compute the optimal fire-response route using ALT (A* with Landmarks).

        Flow:
          1. Run GNN forward pass → per-edge cost modulation.
          2. Precompute landmarks if stale.
          3. ALT (A*) search on GNN-modulated edge costs.
          4. ETA is the sum of base travel_time_s values along the path.

        Returns a dict with:
          - route_nodes, eta_seconds, gnn_confidence, route_wkt, computation_ms
        """
        t0 = time.perf_counter()
        self._update_congestion_from_sumo()

        if self.graph.G.number_of_nodes() == 0:
            raise ValueError("Road network graph has no nodes.")

        edge_costs, node_scores_map = self._compute_edge_costs()
        if obstructions:
            self.apply_obstructions(obstructions, edge_costs)
        if self._use_constraint_costs:
            self.apply_congestion(edge_costs)

        # The second objective: pure travel time, model ignored. Obstructions
        # still apply -- a blocked road is blocked whatever you are optimising
        # for -- but the GAT multipliers and congestion schedule do not, so
        # this is what the router would do with no model at all.
        time_costs: Dict[Tuple[int, int], float] = {
            (u, v): data.get("travel_time_s", 60.0)
            for u, v, data in self.graph.G.edges(data=True)
        }
        if obstructions:
            self.apply_obstructions(obstructions, time_costs)

        if not self._landmarks_valid:
            self._precompute_landmarks()

        route_nodes, _ = self._alt_search(source_node, target_node, edge_costs)

        # ETA uses base travel_time_s, not the GNN-modulated cost
        eta_seconds = float(sum(
            self.graph.G[route_nodes[i]][route_nodes[i + 1]].get("travel_time_s", 60.0)
            for i in range(len(route_nodes) - 1)
        ))

        avg_score = float(np.mean([node_scores_map.get(n, 0.5) for n in route_nodes]))
        confidence = float(np.clip(avg_score * 100, 0, 100))

        coords = [
            (self.graph.G.nodes[n]["lon"], self.graph.G.nodes[n]["lat"])
            for n in route_nodes
        ]
        if len(coords) == 1:
            coords *= 2  # A zero-distance response still needs parseable LineString WKT.
        wkt = "LINESTRING(" + ", ".join(f"{lon} {lat}" for lon, lat in coords) + ")"

        elapsed = (time.perf_counter() - t0) * 1000
        logger.info(
            "Route %d→%d: %d nodes, ETA %.0fs, confidence %.1f%%, computed in %.1fms",
            source_node, target_node, len(route_nodes), eta_seconds, confidence, elapsed,
        )

        return {
            "route_nodes":    route_nodes,
            "eta_seconds":    round(eta_seconds),
            "gnn_confidence": round(confidence, 1),
            "route_wkt":      wkt,
            "computation_ms": round(elapsed, 1),
        }

    def compute_routes_multi_alpha(
        self,
        source_node: int,
        target_node: int,
        obstructions: Optional[List[Dict[str, Any]]] = None,
        previous_node: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Generate up to 3 routes, each answering a different question.

        Route "recommended": best path on the constraint-aware costs -- the
            GAT model's risk multipliers and scheduled congestion included.
            This is the one pre-selected for the crew.
        Route "fastest": best path on raw travel_time_s, with the model's
            opinion switched off entirely. Where this diverges from the
            recommended route, the gap IS the model's contribution, which is
            what makes it worth showing the dispatcher.
        Route "alternative": fills any remaining slot via the penalty method.

        Only genuinely useful routes are returned, so this can yield fewer
        than 3 (see MAX_ALT_STRETCH / MAX_ALT_SHARING). Where no constraint
        data is loaded -- New Corella is raw OSM -- the first two objectives
        are identical by definition, the duplicate is dropped, and the result
        degrades cleanly to penalty-based alternatives.

        ETA on every route is the sum of base travel_time_s values, never the
        scoring cost, so times stay comparable no matter which objective
        produced the path.
        """
        from .graph_builder import _haversine_km

        t0 = time.perf_counter()
        self._update_congestion_from_sumo()

        if self.graph.G.number_of_nodes() == 0:
            raise ValueError("Road network graph has no nodes.")

        edge_costs, node_scores_map = self._compute_edge_costs()
        if obstructions:
            self.apply_obstructions(obstructions, edge_costs)
        if self._use_constraint_costs:
            self.apply_congestion(edge_costs)

        # The second objective: pure travel time, model ignored. Obstructions
        # still apply -- a blocked road is blocked whatever you are optimising
        # for -- but the GAT multipliers and congestion schedule do not, so
        # this is what the router would do with no model at all.
        time_costs: Dict[Tuple[int, int], float] = {
            (u, v): data.get("travel_time_s", 60.0)
            for u, v, data in self.graph.G.edges(data=True)
        }
        if obstructions:
            self.apply_obstructions(obstructions, time_costs)

        if not self._landmarks_valid:
            self._precompute_landmarks()

        def _edge_times(route_nodes: List[int]) -> Dict[Tuple[int, int], float]:
            """Map each edge of a route to its base travel time."""
            return {
                (route_nodes[i], route_nodes[i + 1]):
                    self.graph.G[route_nodes[i]][route_nodes[i + 1]].get("travel_time_s", 60.0)
                for i in range(len(route_nodes) - 1)
            }

        def _build(route_nodes: List[int]) -> Dict[str, Any]:
            coords = [
                (self.graph.G.nodes[n]["lon"], self.graph.G.nodes[n]["lat"])
                for n in route_nodes
            ]
            times = _edge_times(route_nodes)
            distance_m = float(sum(
                _haversine_km(
                    coords[i][1], coords[i][0],
                    coords[i + 1][1], coords[i + 1][0],
                ) * 1000
                for i in range(len(coords) - 1)
            ))
            avg_score = float(np.mean([node_scores_map.get(n, 0.5) for n in route_nodes]))
            if len(coords) == 1:
                coords *= 2  # Source and incident may snap to the same road node.
            return {
                "route_nodes":           route_nodes,
                "eta_seconds":           round(float(sum(times.values()))),
                "gnn_confidence":        round(float(np.clip(avg_score * 100, 0, 100)), 1),
                "route_wkt": "LINESTRING(" + ", ".join(
                    f"{lon} {lat}" for lon, lat in coords
                ) + ")",
                "route_distance_meters": round(distance_m, 1),
                "_edge_times":           times,
                "_total_time":           float(sum(times.values())),
            }

        def _penalise(route_nodes: List[int]) -> None:
            for i in range(len(route_nodes) - 1):
                u, v = route_nodes[i], route_nodes[i + 1]
                working_costs[(u, v)] = working_costs.get(
                    (u, v), self.graph.G[u][v].get("travel_time_s", 60.0)
                ) * PENALTY_FACTOR

        # working_costs is a mutable copy - penalties accumulate across iterations
        working_costs: Dict[Tuple[int, int], float] = dict(edge_costs)

        accepted: List[Dict[str, Any]] = []
        seen_wkts: set = set()
        rejected = 0

        def _distinct_enough(cand: Dict[str, Any]) -> bool:
            """True when cand differs enough from every route already accepted."""
            for prev in accepted:
                shared = sum(
                    t for e, t in cand["_edge_times"].items() if e in prev["_edge_times"]
                )
                if shared > prev["_total_time"] * MAX_ALT_SHARING:
                    return False
            return True

        # ── Objective 1: constraint-aware (the recommended route) ─────────────
        try:
            best_nodes, _ = self._alt_search(source_node, target_node, working_costs, previous_node)
        except ValueError as exc:
            logger.warning("ALT primary route failed: %s", exc)
            return []

        best = _build(best_nodes)
        best["route_type"] = "recommended"
        accepted.append(best)
        seen_wkts.add(best["route_wkt"])
        _penalise(best_nodes)

        # ── Objective 2: fastest on raw travel time (model switched off) ──────
        # Skipped when no constraint data is loaded, because the two objectives
        # are then the same function and this is just the primary search again.
        if self._use_constraint_costs:
            try:
                fast_nodes, _ = self._alt_search(source_node, target_node, time_costs, previous_node)
            except ValueError as exc:
                logger.debug("Fastest-route objective failed: %s", exc)
            else:
                fast = _build(fast_nodes)
                # No stretch test here: this route minimises travel time, so it
                # can never be the slow detour that test exists to catch.
                if fast["route_wkt"] in seen_wkts:
                    logger.debug("Fastest route identical to recommended - dropped")
                elif not _distinct_enough(fast):
                    logger.debug("Fastest route too similar to recommended - dropped")
                else:
                    fast["route_type"] = "fastest"
                    accepted.append(fast)
                    seen_wkts.add(fast["route_wkt"])
                    _penalise(fast_nodes)

        # ── Remaining slots: penalty-based alternatives ───────────────────────
        for _ in range(MAX_ALT_ATTEMPTS):
            if len(accepted) >= 3:
                break
            try:
                cand_nodes, _ = self._alt_search(source_node, target_node, working_costs, previous_node)
            except ValueError as exc:
                logger.debug("No further alternative: %s", exc)
                break

            cand = _build(cand_nodes)
            # Penalise regardless of the verdict, otherwise a rejected candidate
            # is simply found again on the next attempt and the loop spins.
            _penalise(cand_nodes)

            if cand["route_wkt"] in seen_wkts:
                continue

            # Bounded stretch: never offer a detour that costs the crew real time.
            if cand["_total_time"] > best["_total_time"] * MAX_ALT_STRETCH:
                rejected += 1
                logger.debug(
                    "Alternative rejected (stretch %.2f > %.2f)",
                    cand["_total_time"] / max(best["_total_time"], 1e-9),
                    MAX_ALT_STRETCH,
                )
                continue

            if not _distinct_enough(cand):
                rejected += 1
                logger.debug("Alternative rejected (shares too much with an accepted route)")
                continue

            cand["route_type"] = "alternative"
            seen_wkts.add(cand["route_wkt"])
            accepted.append(cand)

        results: List[Dict[str, Any]] = []
        for idx, r in enumerate(accepted):
            r.pop("_edge_times", None)
            r.pop("_total_time", None)
            r["rank"] = idx + 1
            r["is_selected"] = idx == 0
            results.append(r)

        elapsed = (time.perf_counter() - t0) * 1000
        logger.info(
            "Multi-route %d->%d: %d routes accepted (%s), %d rejected, in %.1fms",
            source_node, target_node, len(results),
            "/".join(r["route_type"] for r in results), rejected, elapsed,
        )
        return results

    def nearest_station_node(self, incident_lat: float, incident_lon: float) -> Optional[int]:
        """Return the graph node ID of the nearest fire station to an incident."""
        candidates = self.graph.nodes_near(incident_lat, incident_lon, radius_km=20.0)
        for node_id, _ in candidates:
            if self.graph.G.nodes[node_id].get("is_station"):
                return node_id
        return None

    def compute_routes_from_position(self, lat, lon, dest_lat, dest_lon, obstructions=None, previous_position=None):
        """Route from the current road segment, retaining direction at its junction.

        Geometry begins at the reported fix. A small GPS-to-road snap is explicit;
        the remaining partial edge is traversed before entering ALT. No graph or
        shared engine state is temporarily rewritten.
        """
        import math
        from .graph_builder import _haversine_km

        snap = self.graph.nearest_edge(lat, lon, radius_km=0.05)
        targets = self.graph.nodes_near(dest_lat, dest_lon, radius_km=0.5)
        if snap is None or not targets:
            return []
        u, v, plat, plon, _ = snap
        graph = self.graph.G
        a, b = graph.nodes[u], graph.nodes[v]
        endpoints = [(u, v)]
        if graph.has_edge(v, u):
            endpoints.append((v, u))
        # Recent motion disambiguates the two directions on a bidirectional road.
        # At a junction the truck may choose a fresh outgoing edge normally.
        at_node = min(_haversine_km(plat, plon, a['lat'], a['lon']),
                      _haversine_km(plat, plon, b['lat'], b['lon'])) * 1000 < 1
        if previous_position and not at_node and _haversine_km(*previous_position, lat, lon) * 1000 > 1:
            dy, dx = lat - previous_position[0], (lon - previous_position[1]) * math.cos(math.radians(lat))
            def alignment(edge):
                end = graph.nodes[edge[1]]
                ey, ex = end['lat'] - plat, (end['lon'] - plon) * math.cos(math.radians(lat))
                return (dx * ex + dy * ey) / max(1e-15, math.hypot(ex, ey))
            endpoints = [max(endpoints, key=alignment)]
        costs, _ = self._compute_edge_costs()
        if obstructions:
            self.apply_obstructions(obstructions, costs)
        if self._use_constraint_costs:
            self.apply_congestion(costs)
        choices = []
        for start, end in endpoints:
            end_data = graph.nodes[end]
            partial_m = _haversine_km(plat, plon, end_data['lat'], end_data['lon']) * 1000
            if partial_m > 1 and not math.isfinite(costs.get((start, end), 0)):
                continue
            routes = self.compute_routes_multi_alpha(end, targets[0][0], obstructions=obstructions,
                                                     previous_node=start if partial_m > 1 else None)
            edge_m = _haversine_km(graph.nodes[start]['lat'], graph.nodes[start]['lon'], end_data['lat'], end_data['lon']) * 1000
            access_m = _haversine_km(lat, lon, plat, plon) * 1000
            extra_seconds = graph[start][end].get('travel_time_s', 60) * partial_m / max(edge_m, 0.01) + access_m / 5
            prepared = []
            for route in routes:
                coords = [(lon, lat), (plon, plat)]
                coords += [(graph.nodes[node]['lon'], graph.nodes[node]['lat']) for node in route['route_nodes']]
                clean = [coords[0]]
                for point in coords[1:]:
                    if _haversine_km(point[1], point[0], clean[-1][1], clean[-1][0]) * 1000 > .001:
                        clean.append(point)
                if len(clean) < 2:
                    continue
                prepared.append({**route, 'route_wkt': 'LINESTRING(' + ', '.join(f'{x} {y}' for x, y in clean) + ')',
                                 'eta_seconds': round(route['eta_seconds'] + extra_seconds),
                                 'route_distance_meters': round(float(route.get('route_distance_meters', 0) + partial_m + access_m), 1)})
            if prepared:
                primary = routes[0]['route_nodes']
                score = sum(costs.get((x, y), graph[x][y].get('travel_time_s', 60)) for x, y in zip(primary, primary[1:]))
                if partial_m > .001:
                    score += costs.get((start, end), graph[start][end].get('travel_time_s', 60)) * partial_m / max(edge_m, .01)
                choices.append((score, prepared))
        if not choices:
            return []
        return min(choices, key=lambda choice: choice[0])[1]

    def compute_connector(
        self,
        driver_lat: float,
        driver_lon: float,
        dest_lat: float,
        dest_lon: float,
        obstructions: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Compute a connector path from the driver's current position directly
        to the destination (incident location).

        The connector replaces the "rejoin the planned route" behaviour: the
        main route still represents the truck's originally dispatched path,
        but if the personnel deviates, the connector shows their actual best
        path to the incident from where they currently are.

        Returns a GeoJSON LineString dict:
          {"type": "LineString", "coordinates": [[lon, lat], ...]}

        Raises ValueError if driver or destination node cannot be resolved.
        """

        # 1. Snap the driver to the nearest road *segment* (perpendicular
        #    projection), not the nearest intersection vertex. Nearest-node
        #    snapping can latch onto an intersection that belongs to a parallel
        #    road; projecting onto edges keeps the connector on the road the
        #    driver is actually travelling.
        snap = self.graph.nearest_edge(driver_lat, driver_lon, radius_km=0.5)
        if snap is None:
            raise ValueError("No graph edge within 500 m of driver position")
        edge_u, edge_v, proj_lat, proj_lon, _perp_km = snap

        # 2. Nearest graph node to destination (incident)
        target_candidates = self.graph.nodes_near(dest_lat, dest_lon, radius_km=0.5)
        if not target_candidates:
            raise ValueError("No graph node within 500 m of destination")
        target_node = target_candidates[0][0]

        edge_costs, _ = self._compute_edge_costs()
        if obstructions:
            self.apply_obstructions(obstructions, edge_costs)
        if self._use_constraint_costs:
            self.apply_congestion(edge_costs)

        if not self._landmarks_valid:
            self._precompute_landmarks()

        # 3. Route from whichever endpoint of the snapped segment yields the
        #    cheaper path to the target, so the connector doesn't backtrack
        #    along the segment the driver is standing on. nearest_edge returns
        #    a directed edge, so on a one-way street (no v→u edge) only the
        #    downstream end is legal — never send the driver back against
        #    traffic.
        entries = (edge_u, edge_v) if self.graph.G.has_edge(edge_v, edge_u) else (edge_v,)
        best_route: Optional[List[int]] = None
        best_cost = float("inf")
        for entry in entries:
            try:
                route_nodes, cost = self._alt_search(entry, target_node, edge_costs)
            except ValueError:
                continue
            if cost < best_cost:
                best_cost = cost
                best_route = route_nodes

        if best_route is None:
            raise ValueError("No connector route found to destination")

        # 4. Build the line: actual driver position → foot of perpendicular on
        #    the road → routed node path. Drop a routed node if it duplicates
        #    the projection point (happens when the driver projects onto an
        #    endpoint, t == 0 or t == 1).
        coords = [[driver_lon, driver_lat], [proj_lon, proj_lat]]
        for n in best_route:
            nd = self.graph.G.nodes[n]
            pt = [nd["lon"], nd["lat"]]
            if pt != coords[-1]:
                coords.append(pt)
        return {"type": "LineString", "coordinates": coords}

    def shutdown(self):
        if self.sumo:
            self.sumo.close()
