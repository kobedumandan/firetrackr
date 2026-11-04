"""
OSM loader: downloads the active region's road network via OSMnx and converts
it into a RoadNetworkGraph ready for GNN input.

Note this is NOT how Panabo gets its roads — Panabo runs on a hand-digitised
QGIS export (see qgis_loader). This module serves OSM-sourced regions such as
New Corella, and stays available as a last-resort fallback.

The downloaded graph is cached locally as a .graphml file so subsequent
server restarts don't re-hit the OSM API.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import networkx as nx

from .graph_builder import RoadNetworkGraph
from .config import Config

logger = logging.getLogger(__name__)


def _require_osmnx():
    # Panabo uses QGIS. Importing OSMnx here would also keep its plotting stack
    # resident in every API worker, even when no OSM operation is requested.
    try:
        import osmnx as ox
    except ImportError as exc:
        raise RuntimeError("osmnx is required. Run: pip install osmnx") from exc
    return ox


def download_road_network(
    place: str = Config.PLACE_NAME,
    cache_path: Path = Config.OSM_GRAPHML,
    network_type: str = "drive",
    force_download: bool = False,
) -> nx.MultiDiGraph:
    """
    Fetch or load the OSM road network for the given place.

    Downloads from OSM on first call; subsequent calls load from the cached
    .graphml file to avoid network round-trips on every server restart.

    Args:
        place:          OSM place name string.
        cache_path:     Where to save/load the .graphml cache file.
        network_type:   OSMnx network type ('drive', 'walk', 'all').
        force_download: If True, re-download even if cache exists.

    Returns:
        A networkx MultiDiGraph with speed and travel_time edge attributes.
    """
    ox = _require_osmnx()
    cache_path = Path(cache_path)
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    if cache_path.exists() and not force_download:
        logger.info("Loading cached OSM graph from %s", cache_path)
        G = ox.load_graphml(cache_path)
    else:
        logger.info("Downloading OSM road network for '%s' …", place)
        G = ox.graph_from_place(
            place,
            network_type=network_type,
            retain_all=True,
            custom_filter=(
                '["highway"~"motorway|trunk|primary|secondary|tertiary'
                '|unclassified|residential|service|road"]'
            ),
        )
        G = ox.add_edge_speeds(G)
        G = ox.add_edge_travel_times(G)
        ox.save_graphml(G, cache_path)
        logger.info("OSM graph saved to %s  (%d nodes, %d edges)",
                    cache_path, len(G.nodes), len(G.edges))

    return G


def osm_to_road_network(
    G_osm,
    station_osm_node_ids: Optional[list[int]] = None,
) -> RoadNetworkGraph:
    """
    Convert an OSMnx MultiDiGraph into a RoadNetworkGraph.

    Args:
        G_osm:                 OSMnx graph (from download_road_network).
        station_osm_node_ids:  OSM node IDs that correspond to fire stations.
                               These nodes get is_station=True so the routing
                               engine can find the nearest station quickly.

    Returns:
        A populated RoadNetworkGraph.
    """
    station_set = set(station_osm_node_ids or [])
    rng = RoadNetworkGraph()

    # ── Add nodes ─────────────────────────────────────────────────────────────
    for node_id, data in G_osm.nodes(data=True):
        rng.add_node(
            node_id=node_id,
            lat=data["y"],
            lon=data["x"],
            is_station=(node_id in station_set),
            speed_limit=data.get("speed_kph", 40.0),
            elevation=data.get("elevation", 0.0),
        )

    # ── Add edges ─────────────────────────────────────────────────────────────
    for u, v, data in G_osm.edges(data=True):
        rng.add_edge(
            u=u,
            v=v,
            road_name=data.get("name", ""),
            lanes=int(data["lanes"][0] if isinstance(data.get("lanes"), list) else data.get("lanes", 1)),
            travel_time=data.get("travel_time", None),
            bidirectional=False,  # OSMnx already encodes direction
        )

    logger.info(
        "RoadNetworkGraph built: %d nodes, %d edges",
        rng.G.number_of_nodes(),
        rng.G.number_of_edges(),
    )
    return rng


def load_place_graph(
    place: str = Config.PLACE_NAME,
    cache_path: Path = Config.OSM_GRAPHML,
    station_osm_node_ids: Optional[list[int]] = None,
    force_download: bool = False,
) -> RoadNetworkGraph:
    """
    One-call convenience: download (or load cache) + convert to RoadNetworkGraph.

    Defaults to the active region (see Config.REGION), so:

        from ai.osm_loader import load_place_graph
        routing_engine.graph = load_place_graph()

    Args:
        place:                OSM place name. Defaults to the active region's.
        cache_path:           Where the .graphml cache lives (region-scoped).
        station_osm_node_ids: OSM node IDs of BFP fire stations. Find them via
                              osmnx or the PostGIS database.
        force_download:       Re-download OSM data even if cache exists.
    """
    G_osm = download_road_network(
        place=place, cache_path=cache_path, force_download=force_download
    )
    return osm_to_road_network(G_osm, station_osm_node_ids=station_osm_node_ids)


# Back-compat alias — predates region switching, when OSM meant Panabo.
load_panabo_graph = load_place_graph
