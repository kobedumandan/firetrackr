"""
Shared construction of the GeoAI routing engine.

Used both by the API lifespan (the main-process engine that serves the
/api/routing/* endpoints and the stale-driver watchdog) and by each
routing-pool worker process, so the two are guaranteed to load the same graph
and the same constraint weights.

Which dataset gets loaded is decided by the active region (see ai/config.py):
Panabo pairs its digitised QGIS network with GAT-predicted constraints, while
a testing region such as New Corella has an OSM network and no constraint
model at all.

Kept free of FastAPI/DB imports so pool subprocesses stay lightweight.
"""
import json
import logging

from ai import (
    GeoAIRoutingEngine, load_qgis_graph, load_roads_gpkg, load_place_graph,
    register_env, Config,
)

logger = logging.getLogger(__name__)


def _load_constraint_style() -> dict:
    path = Config.CONSTRAINT_STYLE_PATH
    if path and path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {}


def _load_graph():
    """Build the road-network graph for the active region.

    Panabo's QGIS export and New Corella's OSM export are both plain road
    LineString GeoPackages, so they share `load_roads_gpkg` and produce
    structurally identical graphs. The nodes/edges GeoJSON pair and the live
    OSM download remain as fallbacks for whichever region declares them.
    """
    roads_gpkg = Config.ROADS_GPKG
    nodes_file = Config.NODES_GEOJSON
    edges_file = Config.EDGES_GEOJSON

    if roads_gpkg and roads_gpkg.exists():
        logger.info("[region=%s] loading road network from %s", Config.REGION, roads_gpkg.name)
        return load_roads_gpkg(roads_gpkg)

    if nodes_file and edges_file and nodes_file.exists() and edges_file.exists():
        logger.info("[region=%s] loading road network from nodes/edges GeoJSON", Config.REGION)
        return load_qgis_graph(nodes_file, edges_file)

    if Config.ROAD_SOURCE == "osm":
        # Only regions that are declared OSM-sourced may hit the network. For a
        # QGIS region a missing .gpkg is a deployment error, not a cue to
        # silently substitute OpenStreetMap geometry for the digitised roads.
        logger.warning(
            "[region=%s] %s missing — falling back to a live OSM download of %r. "
            "Run `python fetch_osm_roads.py --region %s` to prebuild it.",
            Config.REGION, roads_gpkg.name if roads_gpkg else "roads gpkg",
            Config.PLACE_NAME, Config.REGION,
        )
        return load_place_graph()

    raise FileNotFoundError(
        f"[region={Config.REGION}] no road-network data found. Expected {roads_gpkg}."
    )


def build_routing_engine(register_gym: bool = True) -> "GeoAIRoutingEngine | None":
    """Load the road graph and configure exported or local GNN costs.

    Returns a ready-to-use engine, or None if the graph data could not be
    loaded (callers degrade gracefully). `register_gym` is only needed by the
    main process (RL env registration); pool workers pass False.
    """
    try:
        graph = _load_graph()

        model_path = Config.GRAPHSAGE_MODEL_PATH
        engine = GeoAIRoutingEngine(
            gnn_type=Config.GNN_TYPE,
            use_rl=Config.USE_RL,
            use_sumo=Config.USE_SUMO,
            gnn_model_path=(str(model_path) if Config.GNN_INFERENCE_MODE == "local"
                            and model_path.exists() else None),
            inference_mode=Config.GNN_INFERENCE_MODE,
            in_channels=Config.NODE_FEATURE_DIM,
            hidden_channels=Config.GNN_HIDDEN,
            out_channels=Config.GNN_OUT,
            device=Config.DEVICE,
        )
        engine.graph = graph

        # Constraint weights are region-specific: only Panabo has a trained GAT
        # model and hand-tuned multipliers. A region without them routes on the
        # raw travel_time_s edge weights, which ALT handles unchanged (the
        # landmark heuristic is admissible either way).
        constraints_path = Config.PREDICTED_CONSTRAINTS_PATH
        edge_weights_path = Config.EDGE_WEIGHTS_PATH
        if Config.GNN_INFERENCE_MODE == "local":
            logger.info("Local GNN inference enabled; exported constraint costs are skipped")
        elif constraints_path and constraints_path.exists():
            with open(constraints_path, encoding="utf-8") as f:
                predicted = json.load(f)
            style = _load_constraint_style()
            multiplier_by_type = {
                k: v.get("routing_multiplier", 1.0)
                for k, v in style.items()
                if isinstance(v, dict)
            }
            engine.apply_predicted_constraints(predicted.get("features", []), multiplier_by_type)
        elif edge_weights_path and edge_weights_path.exists():
            logger.warning("No constraint predictions found; using exported edge weights")
            with open(edge_weights_path) as f:
                edge_weights = json.load(f)
            engine.apply_edge_weights(edge_weights)
        else:
            logger.warning(
                "[region=%s] no constraint or edge-weight data — routing on raw travel time",
                Config.REGION,
            )

        if register_gym and Config.USE_RL:
            register_env()
        return engine
    except Exception as exc:
        logger.warning("build_routing_engine failed: %s", exc)
        return None
