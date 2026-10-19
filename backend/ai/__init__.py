from .graph_builder import RoadNetworkGraph
from .sumo_interface import SUMOInterface
from .routing_engine import GeoAIRoutingEngine
from .osm_loader import load_place_graph, load_panabo_graph
from .qgis_loader import load_qgis_graph, load_qgis_graph_gpkg, load_roads_gpkg
from .config import Config

__all__ = [
    # GNN models
    "GCN", "GAT", "GraphSAGE", "PMGCN",
    # RL agents
    "DQNAgent", "PPOAgent", "DDPGAgent", "A3CAgent",
    # Infrastructure
    "RoadNetworkGraph",
    "SUMOInterface",
    "GeoAIRoutingEngine",
    # Graph loaders (use one depending on data source)
    "load_place_graph",       # OSM download for the active region
    "load_panabo_graph",      # deprecated alias for load_place_graph
    "load_qgis_graph",        # GeoJSON / Shapefile (two files)
    "load_qgis_graph_gpkg",   # GeoPackage (single file, two layers)
    "load_roads_gpkg",        # Raw road LineStrings GeoPackage
    # Gymnasium environment
    "DispatchRoutingEnv",
    "register_env",
    # Config
    "Config",
]


def register_env():
    """Load the optional Gymnasium environment only when explicitly requested."""
    from .dispatch_env import register_env as register
    return register()


def __getattr__(name):
    # Preserve the package API without loading optional ML dependencies at startup.
    from importlib import import_module

    if name in {"GCN", "GAT", "GraphSAGE", "PMGCN"}:
        module = ".gnn_models"
    elif name in {"DQNAgent", "PPOAgent", "DDPGAgent", "A3CAgent"}:
        module = ".rl_agents"
    elif name == "DispatchRoutingEnv":
        module = ".dispatch_env"
    else:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    value = getattr(import_module(module, __name__), name)
    globals()[name] = value
    return value
