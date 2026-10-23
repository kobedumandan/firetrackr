"""Paired spatial audit of previously scored model outputs.

This module does not load checkpoints or reconstruct missing feature pipelines.
Each score JSON is a list of {segment_uid, spatial_block, label, probability,
annotation_source}. Score both bundles with their own fitted pipelines first.
"""
import argparse
from collections import Counter, defaultdict
import json
import math
from pathlib import Path
import random

from training.split import block_split


def _counts(rows, threshold):
    tp = fp = fn = tn = 0
    for row in rows:
        actual, predicted = row["label"], row["probability"] >= threshold
        tp += bool(actual and predicted)
        fp += bool(not actual and predicted)
        fn += bool(actual and not predicted)
        tn += bool(not actual and not predicted)
    return tp, fp, fn, tn


def _f1(counts):
    tp, fp, fn, _ = counts
    return 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.0


def metrics(rows, threshold):
    tp, fp, fn, tn = _counts(rows, threshold)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    # Trapezoidal precision-recall area, grouping ties before adding points.
    groups = defaultdict(list)
    for row in rows:
        groups[row["probability"]].append(row["label"])
    previous_recall, previous_precision, area = 0.0, 1.0, 0.0
    seen = positives = 0
    for probability in sorted(groups, reverse=True):
        seen += len(groups[probability])
        positives += sum(groups[probability])
        current_recall = positives / (tp + fn) if tp + fn else 0.0
        current_precision = positives / seen
        area += (current_recall - previous_recall) * (current_precision + previous_precision) / 2
        previous_recall, previous_precision = current_recall, current_precision
    return {"precision": precision, "recall": recall, "f1": _f1((tp, fp, fn, tn)),
            "balanced_accuracy": (recall + specificity) / 2, "pr_auc": area}


def _index(rows):
    result = {}
    for row in rows:
        uid = row["segment_uid"]
        if not isinstance(uid, str) or not uid or uid in result:
            raise ValueError("Score rows need unique, nonempty segment_uids")
        if row["label"] not in (0, 1) or not math.isfinite(row["probability"]) or not 0 <= row["probability"] <= 1:
            raise ValueError("Invalid binary label or probability")
        if row.get("spatial_block") is None:
            raise ValueError("Missing spatial block")
        result[uid] = row
    return result


def audit_scores(champion, challenger, split, champion_threshold, challenger_threshold, draws=2000, seed=42):
    for threshold in (champion_threshold, challenger_threshold):
        if not math.isfinite(threshold) or not 0 <= threshold <= 1:
            raise ValueError("Thresholds must be in [0, 1]")
    if draws < 1:
        raise ValueError("Bootstrap draws must be positive")
    old, new = _index(champion), _index(challenger)
    if old.keys() != new.keys():
        raise ValueError("Both models must score identical segment_uid sets")
    for uid in old:
        if (old[uid]["label"], old[uid]["spatial_block"]) != (new[uid]["label"], new[uid]["spatial_block"]):
            raise ValueError("Both models must use the same snapshot labels and blocks")
    test = sorted(uid for uid in old if block_split(old[uid]["spatial_block"], split) == "test")
    if not test or {old[uid]["label"] for uid in test} != {0, 1}:
        raise ValueError("Test set must contain both positive and negative labels")
    old_metrics = metrics([old[uid] for uid in test], champion_threshold)
    new_metrics = metrics([new[uid] for uid in test], challenger_threshold)
    blocks = defaultdict(list)
    for uid in test:
        blocks[str(old[uid]["spatial_block"])].append(uid)
    block_counts = [(_counts([old[u] for u in blocks[b]], champion_threshold),
                     _counts([new[u] for u in blocks[b]], challenger_threshold)) for b in sorted(blocks)]
    rng = random.Random(seed)
    differences = []
    for _ in range(draws):
        selected = rng.choices(block_counts, k=len(block_counts))
        totals = [tuple(sum(pair[model][i] for pair in selected) for i in range(4)) for model in (0, 1)]
        differences.append(_f1(totals[1]) - _f1(totals[0]))
    differences.sort()
    lo = differences[int((draws - 1) * 0.025)]
    hi = differences[math.ceil((draws - 1) * 0.975)]
    probability_better = sum(d > 0 for d in differences) / draws
    recall_safe = new_metrics["recall"] >= old_metrics["recall"] - 0.02
    if not recall_safe:
        verdict = "do_not_recommend"
    elif probability_better >= 0.90:
        verdict = "recommend"
    elif lo <= 0 <= hi:
        verdict = "no_clear_difference"
    else:
        verdict = "do_not_recommend"
    churn = [{"segment_uid": uid, "annotation_source": new[uid].get("annotation_source", "unknown"),
              "champion_class": int(old[uid]["probability"] >= champion_threshold),
              "challenger_class": int(new[uid]["probability"] >= challenger_threshold)}
             for uid in sorted(old)
             if (old[uid]["probability"] >= champion_threshold) != (new[uid]["probability"] >= challenger_threshold)]
    positives = sum(old[uid]["label"] for uid in test)
    return {"schema_version": 1, "split_version": split["split_version"],
            "champion": {"threshold": champion_threshold, "metrics": old_metrics, "test_segment_uids": test},
            "challenger": {"threshold": challenger_threshold, "metrics": new_metrics, "test_segment_uids": test},
            "test_blocks": len(blocks), "test_positives": positives,
            "bootstrap": {"unit": "spatial_block", "draws": draws, "seed": seed,
                          "probability_better": probability_better, "f1_difference_ci95": [lo, hi]},
            "f1_difference": new_metrics["f1"] - old_metrics["f1"],
            "recommendation": verdict, "low_confidence": positives < 30 or len(blocks) < 2,
            "churn": churn, "churn_by_annotation_source": dict(Counter(row["annotation_source"] for row in churn)),
            "warnings": (["Fewer than 30 test positives; verdict has low confidence."] if positives < 30 else [])
                        + (["Fewer than two test blocks; bootstrap cannot estimate spatial variability."] if len(blocks) < 2 else [])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("champion", "challenger", "split", "out"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--champion-threshold", type=float, required=True)
    parser.add_argument("--challenger-threshold", type=float, required=True)
    args = parser.parse_args()
    def read(path):
        return json.loads(Path(path).read_text(encoding="utf-8"))
    report = audit_scores(read(args.champion), read(args.challenger), read(args.split),
                          args.champion_threshold, args.challenger_threshold)
    Path(args.out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
