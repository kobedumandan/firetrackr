"""Load verified offline bundles and score raw feature exports without refitting."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from backend.services.constraint_segments import segment_uid
from training.features import transform_features
from training.graph import segment_edges
from training.model import SegmentGAT

REQUIRED_FILES = {"checkpoint.pt", "predicted_constraints.geojson", "split_blocks.json",
                  "feature_pipeline.json", "validation_report.json", "scores.json"}
CANDIDATE_FILES = REQUIRED_FILES | {"report.json", "snapshot_manifest.json", "style_config.json"}


def validate_bundle(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    status = manifest.get("status")
    if manifest.get("schema_version") != 1 or status not in ("verified_offline_bundle", "audited_candidate_bundle"):
        raise ValueError("Expected a verified champion or audited candidate bundle")
    required = CANDIDATE_FILES if status == "audited_candidate_bundle" else REQUIRED_FILES
    if set(manifest["files"]) != required:
        raise ValueError("Bundle manifest does not list the required artifacts")
    for name, digest in manifest["files"].items():
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f"Bundle integrity check failed: {name}")
    report = json.loads((directory / "validation_report.json").read_text(encoding="utf-8"))
    expected_status = "training_completed" if status == "audited_candidate_bundle" else "verified"
    if report.get("status") != expected_status:
        raise ValueError("Bundle validation did not complete")
    if manifest["architecture"] != report["architecture"] or manifest["threshold"] != report["threshold"]:
        raise ValueError("Manifest and validation report disagree")
    if manifest["split_version"] != report["split_version"]:
        raise ValueError("Manifest and validation split disagree")
    if status == "audited_candidate_bundle":
        snapshot = json.loads((directory / "snapshot_manifest.json").read_text(encoding="utf-8"))
        audit = json.loads((directory / "report.json").read_text(encoding="utf-8"))
        if len({manifest["label_hash"], report["label_hash"], snapshot["label_hash"], audit["label_hash"]}) != 1:
            raise ValueError("Candidate artifacts disagree on the training label hash")
        if audit["split_version"] != manifest["split_version"]:
            raise ValueError("Candidate audit uses a different frozen split")
        expected_validation_only = snapshot["purpose"] == "synthetic_validation"
        if any(value != expected_validation_only for value in
               (manifest["validation_only"], report["validation_only"], audit["validation_only"])):
            raise ValueError("Candidate validation-only markers disagree")
    return manifest


def score_bundle(directory, frame, device="cpu"):
    directory = Path(directory)
    manifest = validate_bundle(directory)
    pipeline = json.loads((directory / "feature_pipeline.json").read_text(encoding="utf-8"))
    matrix = transform_features(frame, pipeline)
    model = SegmentGAT(**manifest["architecture"])
    checkpoint = torch.load(directory / "checkpoint.pt", map_location="cpu", weights_only=True)
    model.load_state_dict(checkpoint["model_state_dict"], strict=True)
    model = model.to(device)
    model.eval()
    with torch.no_grad():
        regression, classification = model(torch.from_numpy(matrix).to(device), torch.from_numpy(segment_edges(frame)).to(device))
        probability = torch.softmax(classification, dim=1)[:, 1].cpu().numpy()
    if not np.isfinite(probability).all() or not torch.isfinite(regression).all():
        raise ValueError("Model returned nonfinite scores")
    return probability, regression.cpu().numpy()


def main():
    import geopandas as gpd

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--features", required=True, help="GeoJSON with raw model features and snapshot labels")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    frame = gpd.read_file(args.features)
    probabilities, _ = score_bundle(args.bundle, frame)
    uids = [segment_uid(feature) for feature in frame.iterfeatures()]
    if len(set(uids)) != len(uids):
        raise ValueError("Score inputs contain duplicate segment identities")
    rows = [{"segment_uid": uid, "spatial_block": str(row.spatial_block),
             "label": int(row.is_constrained), "probability": float(probabilities[i]),
             "annotation_source": getattr(row, "annotation_source", "unknown")}
            for i, (uid, row) in enumerate(zip(uids, frame.itertuples()))]
    with Path(args.out).open("x", encoding="utf-8") as output:
        json.dump(rows, output, indent=2)
        output.write("\n")
    print(f"Scored {len(rows)} segments using the bundle's saved feature pipeline")


if __name__ == "__main__":
    main()
