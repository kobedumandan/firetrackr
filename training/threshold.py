"""Notebook Cell 17 validation objective, evaluated over thresholds in one pass."""
import numpy as np


def threshold_search_conservative(y_true, y_prob):
    y_true, y_prob = np.asarray(y_true), np.asarray(y_prob)
    if y_true.shape != y_prob.shape or y_true.ndim != 1 or not len(y_true):
        raise ValueError("Threshold search requires aligned nonempty validation vectors")
    if set(y_true.tolist()) != {0, 1} or not np.isfinite(y_prob).all():
        raise ValueError("Threshold search needs finite probabilities and both validation classes")
    thresholds = np.arange(0.15, 0.90 + 0.01, 0.01)
    predicted = y_prob[:, None] >= thresholds[None, :]
    actual = y_true[:, None] == 1
    tp = (predicted & actual).sum(axis=0)
    fp = (predicted & ~actual).sum(axis=0)
    fn = (~predicted & actual).sum(axis=0)
    tn = (~predicted & ~actual).sum(axis=0)
    precision = tp / np.maximum(tp + fp, 1)
    recall = tp / np.maximum(tp + fn, 1)
    specificity = tn / np.maximum(tn + fp, 1)
    f1 = 2 * tp / np.maximum(2 * tp + fp + fn, 1)
    balanced = (recall + specificity) / 2
    score = 0.30 * f1 + 0.25 * balanced + 0.20 * precision + 0.17 * recall + 0.08 * specificity
    score[tp + fp == 0] = -np.inf
    if not np.isfinite(score).any():
        # Same no-positive fallback as the notebook.
        threshold = 0.50
        pred = y_prob >= threshold
        tp, fp = int((pred & (y_true == 1)).sum()), int((pred & (y_true == 0)).sum())
        fn, tn = int((~pred & (y_true == 1)).sum()), int((~pred & (y_true == 0)).sum())
        p, r, s = tp / max(tp + fp, 1), tp / max(tp + fn, 1), tn / max(tn + fp, 1)
        return threshold, {"threshold": threshold, "precision": p, "recall": r,
                           "f1": 2 * tp / max(2 * tp + fp + fn, 1), "balanced_accuracy": (r + s) / 2,
                           "specificity": s, "predicted_positives": tp + fp, "actual_positives": tp + fn,
                           "tp": tp, "tn": tn, "fp": fp, "fn": fn, "score": 0.0}
    i = int(score.argmax())
    return float(thresholds[i]), {
        "threshold": float(thresholds[i]), "precision": float(precision[i]), "recall": float(recall[i]),
        "f1": float(f1[i]), "balanced_accuracy": float(balanced[i]), "specificity": float(specificity[i]),
        "predicted_positives": int(tp[i] + fp[i]), "actual_positives": int(tp[i] + fn[i]),
        "tp": int(tp[i]), "tn": int(tn[i]), "fp": int(fp[i]), "fn": int(fn[i]), "score": float(score[i]),
    }
