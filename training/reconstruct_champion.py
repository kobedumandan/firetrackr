"""Rebuild the champion pipeline and install an offline v1 bundle only on parity.

Nothing in this command changes the database, active routing export or application
configuration. Its checkpoint must reproduce the shipped classification AND
regression outputs before the reconstruction is considered verified.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

import geopandas as gpd
import numpy as np
import torch

from backend.services.constraint_segments import segment_uid
from training.features import fit_pipeline
from training.graph import segment_edges
from training.model import SegmentGAT
from training.split import block_split


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def reconstruct(export_path, checkpoint_path, split_path, tolerance=1e-5):
    if not np.isfinite(tolerance) or not 0 < tolerance <= 1e-4:
        raise ValueError("Parity tolerance must be positive and no greater than 0.0001")
    split = json.loads(Path(split_path).read_text(encoding="utf-8"))
    if file_hash(export_path) != split["source_sha256"]:
        raise ValueError("Champion reconstruction requires the frozen split's original source export")
    frame = gpd.read_file(export_path)
    assigned = [block_split(block, split) for block in frame.spatial_block]
    if assigned != frame["split"].tolist():
        raise ValueError("Export splits disagree with the frozen block manifest")
    if frame.crs is None or frame.crs.to_epsg() != 4326:
        raise ValueError("Champion export must have declared WGS84 coordinates")
    uids = [segment_uid(f) for f in frame.iterfeatures()]
    if len(set(uids)) != len(uids):
        raise ValueError("Champion export contains duplicate segment identities")
    pipeline, matrix = fit_pipeline(frame, frame["split"].eq("train").to_numpy())
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    if checkpoint.get("base_model_key") != "GAT":
        raise ValueError("Expected the champion GAT checkpoint dictionary")
    state = checkpoint["model_state_dict"]
    saved_columns = checkpoint.get("feature_cols")
    if saved_columns is not None and list(saved_columns) != pipeline["feature_cols"]:
        raise ValueError("Checkpoint feature order differs from reconstructed pipeline")
    architecture = {"in_ch": matrix.shape[1], "hid": 64, "heads": 4, "dropout": 0.35}
    model = SegmentGAT(**architecture)
    model.load_state_dict(state, strict=True)
    model.eval()
    edges = segment_edges(frame)
    with torch.no_grad():
        regression, classification = model(torch.from_numpy(matrix), torch.from_numpy(edges))
        probabilities = torch.softmax(classification, dim=1)[:, 1].numpy().astype(np.float64)
        regression = regression.numpy().astype(np.float64)
    expected_probabilities = frame.model_probability.to_numpy(dtype=np.float64)
    expected_regression = frame.model_score_reg.to_numpy(dtype=np.float64)
    if not np.isfinite(np.concatenate([probabilities, regression, expected_probabilities, expected_regression])).all():
        raise ValueError("Parity comparison contains nonfinite values")
    threshold = float(checkpoint["selected_threshold"])
    threshold_values = frame.model_threshold.unique()
    if len(threshold_values) != 1 or float(threshold_values[0]) != threshold:
        raise ValueError("Checkpoint and export disagree on the selected threshold")
    probability_errors = np.abs(probabilities - expected_probabilities)
    regression_errors = np.abs(regression - expected_regression)
    decision_mismatches = int(np.count_nonzero((probabilities >= threshold) != (expected_probabilities >= threshold)))
    display_mismatches = int(np.count_nonzero((probabilities >= 0.65) != (expected_probabilities >= 0.65)))
    verified = bool(probability_errors.max() <= tolerance and regression_errors.max() <= tolerance
                    and decision_mismatches == 0 and display_mismatches == 0)
    report = {
        "schema_version": 1, "status": "verified" if verified else "parity_failed",
        "segments": len(frame), "input_features": matrix.shape[1], "graph_edges": edges.shape[1],
        "train_segments": int(frame["split"].eq("train").sum()),
        "split_version": split["split_version"], "threshold": threshold,
        "tolerance": tolerance, "max_probability_error": float(probability_errors.max()),
        "mean_probability_error": float(probability_errors.mean()),
        "max_regression_error": float(regression_errors.max()),
        "decision_mismatches": decision_mismatches, "map_confidence_mismatches": display_mismatches,
        "export_sha256": file_hash(export_path), "checkpoint_sha256": file_hash(checkpoint_path),
        "split_sha256": file_hash(split_path), "architecture": architecture,
        "torch_version": str(torch.__version__),
        "provenance": "train-only pipeline reconstructed from raw features in original champion export",
        "limitations": ["Saved predictions validate reconstruction; this is not a new model-accuracy measurement.",
                        "Existing frozen split is retained. No new labels were used to fit the reconstructed pipeline."],
    }
    pipeline["reconstruction"] = {key: report[key] for key in ("export_sha256", "checkpoint_sha256", "split_version", "train_segments")}
    scores = [{"segment_uid": uid, "spatial_block": str(row.spatial_block),
               "label": int(row.is_constrained), "probability": float(probabilities[i]),
               "annotation_source": row.annotation_source}
              for i, (uid, row) in enumerate(zip(uids, frame.itertuples()))]
    return report, pipeline, scores


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--split", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    output = Path(args.out)
    if output.exists():
        raise FileExistsError("Refusing to overwrite an existing model bundle")
    report, pipeline, scores = reconstruct(args.export, args.checkpoint, args.split)
    output.parent.mkdir(parents=True, exist_ok=True)
    (output.parent / (output.name + ".reconstruction_report.json")).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    if report["status"] != "verified":
        raise SystemExit("Parity failed. No champion bundle was created.")
    output.mkdir()
    shutil.copyfile(args.checkpoint, output / "checkpoint.pt")
    shutil.copyfile(args.export, output / "predicted_constraints.geojson")
    shutil.copyfile(args.split, output / "split_blocks.json")
    for name, data in (("feature_pipeline.json", pipeline), ("validation_report.json", report), ("scores.json", scores)):
        (output / name).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    manifest = {"schema_version": 1, "version": output.name, "status": "verified_offline_bundle",
                "model_class": "SegmentGAT", "architecture": report["architecture"],
                "threshold": report["threshold"], "split_version": report["split_version"],
                "files": {p.name: file_hash(p) for p in sorted(output.iterdir()) if p.is_file()}}
    # Written last: an interrupted copy never looks like a complete bundle.
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Verified offline champion bundle: {output}")


if __name__ == "__main__":
    main()
