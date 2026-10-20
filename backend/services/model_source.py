"""Explicit model sources keep graph, worker and map paths in agreement."""
from pathlib import Path

from ai import Config
import state


def constraint_paths(source):
    if source is None:
        return Config.PREDICTED_CONSTRAINTS_PATH, Config.CONSTRAINT_STYLE_PATH
    return Path(source["constraints_path"]), Path(source["style_path"]) if source.get("style_path") else None


def active_paths():
    return constraint_paths(state.active_model_source)


def source_for_version(row, manifest=None):
    from services.model_registry import version_directory
    directory = version_directory(row.version)
    candidate = "style_config.json" in manifest["files"] if manifest is not None else row.version != "v1"
    style = directory / "style_config.json" if candidate else Config.CONSTRAINT_STYLE_PATH
    return {"version": row.version, "manifest_sha256": row.bundle_manifest_sha256,
            "threshold": row.threshold, "constraints_path": str(directory / "predicted_constraints.geojson"),
            "style_path": str(style) if style else None}


def resolve_champion(db):
    """Only an absent/empty registry permits the configured baseline fallback."""
    if Config.REGION != "panabo" or Config.GNN_INFERENCE_MODE != "exported":
        return None
    from sqlalchemy.exc import ProgrammingError
    from models import ModelVersion
    from services.model_registry import RegistryError
    try:
        row = db.query(ModelVersion).filter_by(status="champion").one_or_none()
    except ProgrammingError as exc:
        if getattr(exc.orig, "pgcode", None) != "42P01":
            raise
        db.rollback()  # Pre-0026 installations retain their original baseline.
        return None
    if row is None:
        if db.query(ModelVersion).first() is not None:
            raise RegistryError("Registry history exists without a champion; routing replacement refused", 503)
        return None
    if not row.bundle_manifest_sha256:
        raise RegistryError("Champion has no registered artifact digest", 503)
    # Verify on reload, rather than reading checkpoints every ten-second tick.
    return source_for_version(row)
