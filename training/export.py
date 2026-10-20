"""Conservative hybrid map export: manual types win; GAT-only roads need review."""
import numpy as np


def hybrid_export(frame, probabilities, regression, threshold, style):
    result = frame.copy()
    manual = result["is_constrained"].astype(bool).to_numpy()
    predicted = probabilities >= threshold
    high = probabilities >= 0.65
    types = np.where(manual, result["constraint_type"],
                     np.where(high, "predicted_constraint_high_confidence",
                              np.where(predicted, "predicted_constraint_review", "normal")))
    result["manual_constraint_type"] = result["constraint_type"]
    result["display_constraint_type"] = types
    result["routing_constraint_type"] = np.where(manual, result["constraint_type"], "normal")
    result["annotation_source"] = np.where(manual,
        np.where(result["annotation_source"].eq("user_drawn"), "user_drawn", "manual_verified"),
        np.where(high, "gat_high_confidence_review", np.where(predicted, "gat_review_candidate", "normal_unconstrained")))
    result["model_probability"] = probabilities
    result["model_probability_pct"] = probabilities * 100
    result["model_score_reg"] = regression
    result["model_predicted_constrained"] = predicted.astype(int)
    result["model_threshold"] = threshold
    result["map_high_confidence_threshold"] = 0.65
    result["map_high_confidence_prediction"] = high.astype(int)
    result["is_manual_verified"] = manual.astype(int)
    result["is_gat_only_prediction"] = (~manual & predicted).astype(int)
    result["actual_model_used"] = "GAT"
    result["best_result_label"] = "GAT_VALIDATION_THRESHOLD"
    result["final_display_confidence_pct"] = np.where(manual, 100., probabilities * 100)
    result["hover_confidence_text"] = [f"{'Manual annotation; ' if m else ''}GAT probability: {p * 100:.2f}%"
                                       for m, p in zip(manual, probabilities)]
    for field, key, default in (("map_color", "color", "#B0BEC5"), ("map_weight", "weight", 3), ("map_opacity", "opacity", 0.85)):
        result[field] = [style.get(kind, {}).get(key, default) for kind in types]
    return result
