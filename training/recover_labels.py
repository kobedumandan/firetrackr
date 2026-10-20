"""Recover manual training labels retained in the shipped hybrid map export.

This reconstructs a baseline; it is not the missing original QGIS master file.
All geometry identities and simplified labels must agree before anything writes.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from training.labels import simplify_constraint_for_gnn

MANUAL_COLUMNS = (
    "is_narrow", "is_narrow_slight", "is_narrow_severe", "narrow_severity",
    "near_school", "near_market", "near_nightmarket", "near_highway",
    "traffic_school", "traffic_school_peak", "traffic_general", "traffic_highway",
    "traffic_market", "traffic_pnm", "traffic_nightmarket",
    "traffic_morning", "traffic_noon", "traffic_afternoon", "traffic_evening", "traffic_night",
    "traffic_severity", "school_morning_severity", "school_noon_severity", "school_afternoon_severity",
    "is_construction", "is_hard", "confirmed_normal", "confirmed_narrow", "confirmed_not_narrow",
    "source_confidence", "constraint_confidence", "est_width_m", "width_min_m", "width_max_m",
    "width_confidence", "narrow_notes", "notes", "traffic_start_1", "traffic_end_1",
    "traffic_start_2", "traffic_end_2", "traffic_notes", "traffic_note", "narrow_source_file",
)


def recover(export_path, roads_path):
    import geopandas as gpd
    from backend.services.constraint_segments import segment_uid

    export_path, roads_path = Path(export_path), Path(roads_path)
    raw = json.loads(export_path.read_text(encoding="utf-8"))
    by_geometry = {}
    source_counts = {}
    for feature in raw["features"]:
        # Match actual geometries even if a future export supplies canonical IDs.
        geometry_id = segment_uid({"geometry": feature["geometry"]})
        if geometry_id in by_geometry:
            raise ValueError(f"Duplicate geometry in export: {geometry_id}")
        props = feature["properties"]
        missing = set(MANUAL_COLUMNS) - props.keys()
        if missing:
            raise ValueError(f"Export lacks manual fields: {sorted(missing)}")
        labels = simplify_constraint_for_gnn(props)
        if any(props.get(key) != value for key, value in labels.items()):
            raise ValueError(f"Manual flags disagree with exported training labels: {geometry_id}")
        by_geometry[geometry_id] = props
        source = props.get("annotation_source", "unknown")
        source_counts[source] = source_counts.get(source, 0) + 1
    roads = gpd.read_file(roads_path)
    if roads.crs is None:
        raise ValueError("Road layer has no declared CRS")
    roads = roads.to_crs(epsg=4326)
    records = []
    seen = set()
    for feature in roads.iterfeatures():
        geometry_id = segment_uid({"geometry": feature["geometry"]})
        if geometry_id in seen:
            raise ValueError(f"Duplicate road geometry: {geometry_id}")
        seen.add(geometry_id)
        if geometry_id not in by_geometry:
            raise ValueError(f"Road geometry missing from label export: {geometry_id}")
        props = by_geometry[geometry_id]
        labels = simplify_constraint_for_gnn(props)
        records.append({
            "type": "Feature", "geometry": feature["geometry"],
            "properties": {**feature["properties"], **{key: props[key] for key in MANUAL_COLUMNS},
                           **labels, "primary_constraint": labels["constraint_type"],
                           "segment_uid": str(props.get("segment_uid") or geometry_id),
                           "label_source": "recovered_manual_constraint" if labels["is_constrained"] else "unannotated_background"},
        })
    if seen != by_geometry.keys():
        raise ValueError("Export contains geometries absent from the road layer")
    if not records:
        raise ValueError("Cannot recover an empty road layer")
    positive_count = sum(f["properties"]["is_constrained"] for f in records)
    manifest = {
        "schema_version": 1, "provenance": "recovered_from_shipped_export",
        "export_file": export_path.name, "export_sha256": hashlib.sha256(export_path.read_bytes()).hexdigest(),
        "roads_file": roads_path.name, "roads_sha256": hashlib.sha256(roads_path.read_bytes()).hexdigest(),
        "label_rules": "final_najud_gnn_gattt.ipynb:Cell 8.1",
        "segments": len(records), "positive_segments": positive_count,
        "background_segments": len(records) - positive_count,
        "source_annotation_counts": source_counts,
        "geometry_mismatches": 0, "simplified_label_mismatches": 0,
        "model_predictions_used_as_labels": False,
        "note": "Recovered historical labels, not the original master or proof of field verification. Background zeros include unannotated roads.",
    }
    return gpd.GeoDataFrame.from_features(records, crs="EPSG:4326"), manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", required=True)
    parser.add_argument("--roads", required=True)
    parser.add_argument("--out", required=True, help="New directory for recovered GeoPackage and provenance manifest")
    args = parser.parse_args()
    layer, manifest = recover(args.export, args.roads)
    output = Path(args.out)
    # Never overwrite an original master or a previous recovered baseline.
    output.mkdir(parents=True, exist_ok=False)
    layer.to_file(output / "roads_panabo_master_constraints.gpkg", driver="GPKG", layer="recovered_manual_labels")
    manifest["created_at"] = datetime.now(timezone.utc).isoformat()
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Recovered {manifest['segments']} segments: {manifest['positive_segments']} positive, {manifest['background_segments']} background.")
    print(f"Wrote recovered baseline and provenance to {output}")


if __name__ == "__main__":
    main()
