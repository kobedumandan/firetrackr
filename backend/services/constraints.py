"""GAT constraint styling helpers used by the map and constraint endpoints."""
import json

import state


# Properties carried through to the frontend per predicted-constraint feature.
_CONSTRAINT_PROP_KEYS = (
    "road_id", "segment_uid", "annotation_source", "barangay", "name", "highway",
    "display_constraint_type", "routing_constraint_type",
    "map_color", "map_weight", "map_opacity",
    "model_predicted_constrained", "model_probability_pct",
    "final_display_confidence_pct", "hover_confidence_text",
    "is_manual_verified", "is_gat_only_prediction",
)


# Labels for display_constraint_type values not covered by the style config
# (the GAT-only prediction buckets the export adds for the map legend).
_DISPLAY_LABELS = {
    "predicted_constraint_high_confidence": "Predicted constraint (high confidence)",
    "predicted_constraint_review": "Predicted constraint (needs review)",
    "normal": "Normal road",
}


# Map a user-drawn custom constraint_type onto the GAT style vocabulary.
_CUSTOM_STYLE_KEY = {
    "narrow_road": "narrow_road",
    "traffic_area": "traffic_general",
}


_CURRENT_SOURCE = object()


def _load_constraint_style(source=_CURRENT_SOURCE) -> dict:
    from services.model_source import constraint_paths
    generation = state.routing_generation
    if source is _CURRENT_SOURCE:
        source = state.active_model_source
    current = source is state.active_model_source
    cached = state.constraint_style_cache
    if current and cached is not None and cached[0] == generation and cached[1] is source:
        return cached[2]
    _, path = constraint_paths(source)
    if path and path.exists():
        with open(path, encoding="utf-8") as f:
            style = json.load(f)
    else:
        style = {}
    if current and generation == state.routing_generation and source is state.active_model_source:
        state.constraint_style_cache = (generation, source, style)
    return style


def _label_for(dtype: str, style: dict) -> str:
    """Human label for a display_constraint_type, preferring the style config."""
    if dtype in _DISPLAY_LABELS:
        return _DISPLAY_LABELS[dtype]
    s = style.get(dtype)
    if isinstance(s, dict) and s.get("label"):
        return s["label"]
    return (dtype or "").replace("_", " ").strip().capitalize() or "Unknown"
