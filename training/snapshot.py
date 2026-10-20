"""Offline snapshot CLI and integrity validation, with no database connection."""
import argparse
import hashlib
import json
from pathlib import Path

from backend.services.label_snapshot import build_snapshot, label_hash, write_snapshot, LABEL_FIELDS


def load_snapshot(directory):
    import geopandas as gpd
    import pandas as pd

    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    name = f"labels_{manifest['label_hash']}.parquet"
    if manifest.get("schema_version") != 1 or manifest.get("labels_file") != name:
        raise ValueError("Unsupported label snapshot manifest")
    if set(manifest["files"]) != {name, "features.geojson", "annotations.json"}:
        raise ValueError("Snapshot manifest has unexpected files")
    for filename, digest in manifest["files"].items():
        if hashlib.sha256((directory / filename).read_bytes()).hexdigest() != digest:
            raise ValueError(f"Snapshot integrity check failed: {filename}")
    collection = json.loads((directory / "features.geojson").read_text(encoding="utf-8"))
    if label_hash(collection["features"]) != manifest["label_hash"]:
        raise ValueError("Snapshot label hash mismatch")
    frame = gpd.GeoDataFrame.from_features(collection["features"], crs="EPSG:4326")
    table = pd.read_parquet(directory / name)
    expected = frame[["segment_uid", *LABEL_FIELDS]].sort_values("segment_uid").reset_index(drop=True)
    pd.testing.assert_frame_equal(expected, table.reset_index(drop=True), check_dtype=False)
    if len(frame) != manifest["segments"]:
        raise ValueError("Snapshot segment count mismatch")
    return frame, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--annotations", required=True, help="JSON list of active and deleted drawn annotations")
    parser.add_argument("--out", required=True)
    parser.add_argument("--created-by", type=int)
    parser.add_argument("--purpose", choices=("training", "synthetic_validation"), default="training")
    args = parser.parse_args()
    annotations = json.loads(Path(args.annotations).read_text(encoding="utf-8"))
    collection, history, manifest = build_snapshot(args.baseline, annotations, args.created_by, args.purpose)
    manifest = write_snapshot(args.out, collection, history, manifest)
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
