"""CPU GAT challenger training and head-to-head audit on one immutable snapshot.

No model registration, promotion, DB access or routing-file replacement occurs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import shutil

import geopandas as gpd
import numpy as np
import torch
from torch_geometric.data import Data

from backend.services.label_snapshot import label_hash
from training.audit import audit_scores
from training.bundle import score_bundle, validate_bundle
from training.export import hybrid_export
from training.features import fit_pipeline
from training.graph import segment_edges
from training.model import SegmentGAT
from training.optimization import train_model_conservative
from training.snapshot import load_snapshot
from training.split import block_split
from training.threshold import threshold_search_conservative


def prepare_training(snapshot_dir, champion_dir):
    frame, snapshot = load_snapshot(snapshot_dir)
    champion_dir = Path(champion_dir)
    champion = validate_bundle(champion_dir)
    baseline = json.loads((champion_dir / "predicted_constraints.geojson").read_text(encoding="utf-8"))
    champion_hash = champion.get("label_hash") or label_hash(baseline["features"])
    if snapshot["label_hash"] == champion_hash:
        raise ValueError("No new effective labels since the champion; retraining refused")
    source_hash = champion.get("baseline_sha256") or champion["files"]["predicted_constraints.geojson"]
    if snapshot["baseline_sha256"] != source_hash:
        raise ValueError("Snapshot uses a different road/feature baseline; rebuild and validate that baseline first")
    split = json.loads((champion_dir / "split_blocks.json").read_text(encoding="utf-8"))
    if split["split_version"] != champion["split_version"]:
        raise ValueError("Champion split provenance mismatch")
    frame["split"] = [block_split(block, split) for block in frame.spatial_block]
    for partition in ("train", "val", "test"):
        if set(frame.loc[frame["split"].eq(partition), "is_constrained"].tolist()) != {0, 1}:
            raise ValueError(f"{partition} blocks must contain both label classes")
    return frame, snapshot, champion, split


def train_and_audit(snapshot_dir, champion_dir, output_dir, style_path, epochs=700, lr=0.002, patience=80, seed=42, threads=4, version=None):
    if epochs < 1 or patience < 1 or threads < 1 or not np.isfinite(lr) or lr <= 0:
        raise ValueError("Training limits, learning rate and thread count must be positive")
    output = Path(output_dir)
    if output.exists():
        raise FileExistsError("Refusing to overwrite an existing model bundle")
    frame, snapshot, champion, split = prepare_training(snapshot_dir, champion_dir)
    style = json.loads(Path(style_path).read_text(encoding="utf-8"))
    torch.set_num_threads(threads)
    torch.manual_seed(seed)
    np.random.seed(seed)
    random.seed(seed)
    pipeline, matrix = fit_pipeline(frame, frame["split"].eq("train").to_numpy())
    edges = torch.from_numpy(segment_edges(frame))
    data = Data(x=torch.from_numpy(matrix), edge_index=edges,
                y_cls=torch.tensor(frame.is_constrained.to_numpy(), dtype=torch.long),
                y_reg=torch.tensor(frame.constraint_score.to_numpy(), dtype=torch.float32))
    for partition in ("train", "val", "test"):
        setattr(data, partition + "_mask", torch.tensor(frame["split"].eq(partition).to_numpy()))
    data.train_edge_index = edges[:, data.train_mask[edges[0]] & data.train_mask[edges[1]]]
    architecture = {"in_ch": matrix.shape[1], "hid": 64, "heads": 4, "dropout": 0.35}
    model = SegmentGAT(**architecture)
    model = train_model_conservative(model, data, "GAT", epochs=epochs, lr=lr, patience=patience)
    model.eval()
    with torch.no_grad():
        regression, classification = model(data.x, data.edge_index)
        probabilities = torch.softmax(classification, dim=1)[:, 1].numpy()
        regression = regression.numpy()
    if not np.isfinite(probabilities).all() or not np.isfinite(regression).all():
        raise ValueError("Training returned nonfinite predictions")
    validation = frame["split"].eq("val").to_numpy()
    threshold, validation_info = threshold_search_conservative(frame.is_constrained.to_numpy()[validation], probabilities[validation])
    old_probabilities, _ = score_bundle(champion_dir, frame)
    def scores(values):
        return [{"segment_uid": row.segment_uid, "spatial_block": str(row.spatial_block),
                 "label": int(row.is_constrained), "probability": float(values[i]),
                 "annotation_source": row.annotation_source} for i, row in enumerate(frame.itertuples())]
    challenger_scores = scores(probabilities)
    report = audit_scores(scores(old_probabilities), challenger_scores, split, champion["threshold"], threshold)
    validation_only = snapshot["purpose"] == "synthetic_validation"
    report.update(label_hash=snapshot["label_hash"], champion_version=champion["version"],
                  validation_only=validation_only, promotion_eligible=False,
                  promotion_blockers=["Explicit admin promotion of a registered candidate is required."])
    if validation_only:
        report["warnings"].append("Synthetic labels: this run validates plumbing and is not eligible for promotion.")
    training_report = {"schema_version": 1, "status": "training_completed", "architecture": architecture,
                       "threshold": threshold, "label_hash": snapshot["label_hash"], "split_version": split["split_version"],
                       "parameters": {"epochs": epochs, "lr": lr, "patience": patience, "seed": seed, "threads": threads},
                       "training": model.training_summary, "validation": validation_info,
                       "torch_version": str(torch.__version__), "validation_only": validation_only}
    export = hybrid_export(frame, probabilities, regression, threshold, style)
    output.mkdir(parents=True, exist_ok=False)
    torch.save({"base_model_key": "GAT", "model_class": "SegmentGAT", "model_arch": architecture,
                "selected_threshold": threshold, "feature_cols": pipeline["feature_cols"],
                "model_state_dict": model.state_dict()}, output / "checkpoint.pt")
    (output / "predicted_constraints.geojson").write_text(export.to_json() + "\n", encoding="utf-8")
    shutil.copyfile(Path(champion_dir) / "split_blocks.json", output / "split_blocks.json")
    for name, value in (("feature_pipeline.json", pipeline), ("validation_report.json", training_report),
                        ("scores.json", challenger_scores), ("report.json", report),
                        ("snapshot_manifest.json", snapshot), ("style_config.json", style)):
        (output / name).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    manifest = {"schema_version": 1, "version": version or output.name, "status": "audited_candidate_bundle",
                "model_class": "SegmentGAT", "architecture": architecture, "threshold": threshold,
                "label_hash": snapshot["label_hash"], "baseline_sha256": snapshot["baseline_sha256"],
                "split_version": split["split_version"], "champion_version": champion["version"],
                "validation_only": validation_only,
                "files": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(output.iterdir())}}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    validate_bundle(output)
    print(f"Candidate {output.name}: threshold={threshold:.2f}, recommendation={report['recommendation']}", flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("snapshot", "champion", "out", "style"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--epochs", type=int, default=700)
    parser.add_argument("--lr", type=float, default=0.002)
    parser.add_argument("--patience", type=int, default=80)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--version", help="Registry-assigned artifact identity")
    args = parser.parse_args()
    train_and_audit(args.snapshot, args.champion, args.out, args.style,
                    args.epochs, args.lr, args.patience, args.seed, args.threads, args.version)


if __name__ == "__main__":
    main()
