"""
Centralised configuration for the AI / GeoAI routing module.

All paths are resolved relative to the backend/ directory so they work
regardless of where uvicorn is launched from.

Region switching (local development only)
─────────────────────────────────────────
Production is ALWAYS Panabo City — the system was built for and proposed to BFP
Panabo City, and its road network is a hand-digitised QGIS export with
GAT-predicted constraint weights layered on top.

The REGION environment variable swaps the GIS/routing dataset wholesale so a
developer can exercise the app without being physically in Panabo. It is a
development convenience, not a multi-city feature, and should never be set on a
deployed instance:

    REGION=panabo       (default)  production: QGIS network + GAT constraints
    REGION=new_corella            dev aid: OSM network, no constraint weights

Every region-dependent path below is resolved from REGIONS[REGION] at import
time, so the rest of the codebase keeps referring to the same Config
attributes it always has. With REGION unset the resolved values are byte-for-
byte the Panabo ones, i.e. the default path is unchanged.
"""

from pathlib import Path
import os

from dotenv import load_dotenv

# REGION is resolved at import time, and this module is pulled in by
# routing_pool -> routing_setup, which main.py imports before anything that
# touches the database. database.py's load_dotenv() therefore runs too late to
# help: without this call, REGION=... in backend/.env is silently ignored and
# the server loads Panabo's network no matter what the .env says.
load_dotenv()

# backend/
BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
CACHE_DIR = BASE_DIR / "cache"


# ── Region registry ───────────────────────────────────────────────────────────
# Each entry describes one GIS/routing dataset. Keys with a None value mean the
# region simply does not have that asset and the code that consumes it must
# degrade gracefully (see routing_setup.build_routing_engine).
REGIONS: dict[str, dict] = {
    # Production dataset. The road network is a QGIS export (NOT OpenStreetMap)
    # and is paired with the GAT constraint predictions + hand-tuned routing
    # multipliers. Do not repoint these at OSM data.
    "panabo": {
        "label": "Panabo City",
        "place_name": "Panabo City, Davao del Norte, Philippines",
        "road_source": "qgis",
        "roads_gpkg": DATA_DIR / "roads_panabo.gpkg",
        "nodes_geojson": DATA_DIR / "panabo_nodes.geojson",
        "edges_geojson": DATA_DIR / "panabo_edges.geojson",
        "osm_graphml": CACHE_DIR / "panabo_graph.graphml",
        "constraints_path": DATA_DIR / "best_model_predicted_constraints.geojson",
        "constraint_style_path": DATA_DIR / "constraint_style_config.json",
        "edge_weights_path": DATA_DIR / "edge_weights.json",
        "barangays_path": DATA_DIR / "panabo_barangays.geojson",
        "sumo_net": BASE_DIR / "sumo" / "panabo.net.xml",
        "sumo_route": BASE_DIR / "sumo" / "panabo.rou.xml",
        # Panabo City bounding-box diagonal, used to normalise distance features.
        "max_dist_km": 50.0,
    },
    # Development/testing only. Sourced from OpenStreetMap via
    # `python fetch_osm_roads.py --region new_corella`. No constraint model has
    # been trained here and none is needed — ALT routes on raw travel time.
    "new_corella": {
        "label": "New Corella",
        "place_name": "New Corella, Davao del Norte, Philippines",
        "road_source": "osm",
        "roads_gpkg": DATA_DIR / "roads_new_corella.gpkg",
        "nodes_geojson": None,
        "edges_geojson": None,
        "osm_graphml": CACHE_DIR / "new_corella_graph.graphml",
        "constraints_path": None,
        "constraint_style_path": None,
        "edge_weights_path": None,
        "barangays_path": DATA_DIR / "new_corella_barangays.geojson",
        "sumo_net": None,
        "sumo_route": None,
        "max_dist_km": 50.0,
    },
}

REGION = os.getenv("REGION", "panabo").strip().lower()
if REGION not in REGIONS:
    raise ValueError(
        f"Unknown REGION={REGION!r}. Valid regions: {', '.join(sorted(REGIONS))}"
    )

GNN_INFERENCE_MODE = os.getenv("GNN_INFERENCE_MODE", "exported").strip().lower()
if GNN_INFERENCE_MODE not in {"exported", "local"}:
    raise ValueError("GNN_INFERENCE_MODE must be 'exported' or 'local'")

_REGION_CFG = REGIONS[REGION]


class Config:
    # ── Active region ─────────────────────────────────────────────────────────
    REGION      = REGION
    REGION_CFG  = _REGION_CFG
    ROAD_SOURCE = _REGION_CFG["road_source"]   # 'qgis' | 'osm'

    # ── Project / Location ────────────────────────────────────────────────────
    PLACE_NAME = _REGION_CFG["place_name"]
    COORD_SRID = 4326  # WGS84

    # ── Directory layout ──────────────────────────────────────────────────────
    CACHE_DIR       = CACHE_DIR
    CHECKPOINT_DIR  = BASE_DIR / "checkpoints"
    SUMO_DIR        = BASE_DIR / "sumo"

    # ── Cached OSM graph (avoids re-downloading every restart) ────────────────
    OSM_GRAPHML     = _REGION_CFG["osm_graphml"]

    # ── Region road-network sources (consumed by routing_setup) ───────────────
    ROADS_GPKG      = _REGION_CFG["roads_gpkg"]
    NODES_GEOJSON   = _REGION_CFG["nodes_geojson"]
    EDGES_GEOJSON   = _REGION_CFG["edges_geojson"]

    # ── Model checkpoints ─────────────────────────────────────────────────────
    GRAPHSAGE_MODEL_PATH = BASE_DIR / "ai" / "models" / "gnn_final_graphsage.pt"
    # Trained GAT constraint-prediction model (GAT manual threshold, 0.45).
    # Checkpoint dict: {model_state_dict, selected_threshold, metrics, ...}.
    # Stored as the model artifact; routing consumes the precomputed per-road
    # constraint types from PREDICTED_CONSTRAINTS_PATH (mapped to multipliers via
    # CONSTRAINT_STYLE_PATH) rather than running this model live (it expects
    # 73 features + classification/regression heads).
    GAT_MODEL_PATH       = BASE_DIR / "ai" / "models" / "best_gat_manual_threshold_model.pt"
    # Precomputed GAT constraint predictions (one feature per road segment,
    # carrying display_constraint_type, map_* style fields and routing_multiplier).
    # These are region-specific and only Panabo has them; on a region without a
    # trained constraint model they are None and routing falls back to raw
    # travel time. Always guard with `if Config.X and Config.X.exists()`.
    PREDICTED_CONSTRAINTS_PATH = _REGION_CFG["constraints_path"]
    CONSTRAINT_STYLE_PATH      = _REGION_CFG["constraint_style_path"]
    EDGE_WEIGHTS_PATH          = _REGION_CFG["edge_weights_path"]
    # Barangay boundary polygons for the active region (coverage-by-barangay,
    # incident→barangay assignment, seeding).
    BARANGAYS_PATH             = _REGION_CFG["barangays_path"]
    GNN_MODEL_PATH  = CHECKPOINT_DIR / "gnn_model.pt"
    PPO_MODEL_PATH  = str(CHECKPOINT_DIR / "ppo_dispatch")
    DQN_MODEL_PATH  = str(CHECKPOINT_DIR / "dqn_dispatch")
    DDPG_MODEL_PATH = str(CHECKPOINT_DIR / "ddpg_dispatch")
    A3C_MODEL_PATH  = str(CHECKPOINT_DIR / "a3c_dispatch.pt")

    # ── SUMO network files ────────────────────────────────────────────────────
    # Only Panabo has a prepared SUMO network; str(None) would be a silent
    # footgun, so leave these None when the region has no scenario built.
    SUMO_NET_FILE   = str(_REGION_CFG["sumo_net"]) if _REGION_CFG["sumo_net"] else None
    SUMO_ROUTE_FILE = str(_REGION_CFG["sumo_route"]) if _REGION_CFG["sumo_route"] else None
    SUMO_PORT       = int(os.getenv("SUMO_PORT", "8813"))
    SUMO_STEP_LEN   = 1.0  # seconds per simulation step

    # ── GNN hyperparameters ───────────────────────────────────────────────────
    GNN_INFERENCE_MODE  = GNN_INFERENCE_MODE
    GNN_TYPE            = os.getenv("GNN_TYPE", "graphsage")  # 'graphsage' | 'gat' | 'pmgcn'
    NODE_FEATURE_DIM    = 8   # must match graph_builder.NODE_FEATURE_DIM
    GNN_HIDDEN          = 64
    GNN_OUT             = 1   # scalar routing score per node

    # ── RL / Gymnasium environment ────────────────────────────────────────────
    ENV_ID              = "DispatchRouting-v0"
    MAX_NEIGHBORS       = 8    # action-space size (Discrete)
    MAX_STEPS_PER_EP    = 200  # episode truncation limit
    ARRIVAL_BONUS       = 100.0
    STEP_TIME_PENALTY   = 1.0 / 60.0   # per second of travel time
    INVALID_ACTION_PEN  = -10.0
    CONGESTION_PENALTY  = 5.0

    # ── Feature normalisation constants ───────────────────────────────────────
    MAX_DIST_KM         = _REGION_CFG["max_dist_km"]   # region bounding-box diagonal
    MAX_SPEED_KMH       = 80.0
    MAX_ETA_S           = 600.0  # 10 minutes

    # ── Runtime flags (toggle via environment variables) ──────────────────────
    USE_SUMO            = os.getenv("USE_SUMO", "false").lower() == "true"
    USE_RL              = os.getenv("USE_RL", "false").lower() == "true"
    DEVICE              = os.getenv("TORCH_DEVICE", "cpu")
