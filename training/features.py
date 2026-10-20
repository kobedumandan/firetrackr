"""Portable feature pipeline matching notebook Cell 13 (width disabled).

Champion reconstruction uses the raw geometry/proximity features retained in its
export. A fitted pipeline is immutable during inference: never refit on new labels.
"""
import numpy as np
import pandas as pd

GEOMETRY_FEATURES = [
    "length_m", "centroid_x", "centroid_y", "bearing_sin", "bearing_cos",
    "start_degree", "end_degree", "avg_degree", "max_degree",
]
PROXIMITY_FEATURES = [name for category in ("school", "mall_market", "crowded_zone")
                      for name in (f"dist_to_{category}", f"near_{category}_100m",
                                   f"near_{category}_200m", f"near_{category}_500m")]
CATEGORICAL_FEATURES = ["highway", "barangay"]


def _prepare(frame, numeric_features, categorical_features):
    frame = frame.copy()
    missing = set(numeric_features + categorical_features) - set(frame.columns)
    if missing:
        raise ValueError(f"Missing model features: {sorted(missing)}")
    for column in numeric_features:
        if column in ("maxspeed", "lanes"):
            frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(0)
        else:
            frame[column] = pd.to_numeric(frame[column], errors="raise")
    for column in categorical_features:
        frame[column] = frame[column].fillna("unknown" if column == "highway" else "Unknown").astype(str)
    if not np.isfinite(frame[numeric_features].to_numpy(dtype=np.float64)).all():
        raise ValueError("Numeric model features must be finite")
    return frame


def fit_pipeline(frame, train_mask):
    """Fit on train rows only; return raw JSON parameters and float32 matrix."""
    from sklearn.preprocessing import MinMaxScaler, OneHotEncoder

    numeric = GEOMETRY_FEATURES + PROXIMITY_FEATURES + [c for c in ("maxspeed", "lanes") if c in frame.columns]
    categorical = list(CATEGORICAL_FEATURES)
    frame = _prepare(frame, numeric, categorical)
    train_mask = np.asarray(train_mask, dtype=bool)
    if train_mask.shape != (len(frame),) or not train_mask.any():
        raise ValueError("Expected a nonempty training mask aligned with the feature rows")
    scaler = MinMaxScaler().fit(frame.loc[train_mask, numeric])
    encoder = OneHotEncoder(handle_unknown="ignore", sparse_output=False).fit(frame.loc[train_mask, categorical])
    columns = numeric + encoder.get_feature_names_out(categorical).tolist()
    pipeline = {
        "schema_version": 1, "numeric_features": numeric, "categorical_features": categorical,
        "feature_cols": columns, "n_features": len(columns), "use_est_width_feature": False,
        "scaler": {"type": "MinMaxScaler", "feature_range": [0, 1],
                   "data_min_": scaler.data_min_.tolist(), "data_max_": scaler.data_max_.tolist(),
                   "scale_": scaler.scale_.tolist(), "min_": scaler.min_.tolist()},
        "encoder": {"type": "OneHotEncoder", "handle_unknown": "ignore",
                    "categories_": [values.tolist() for values in encoder.categories_]},
    }
    reference = np.hstack([scaler.transform(frame[numeric]), encoder.transform(frame[categorical])]).astype(np.float32)
    result = transform_features(frame, pipeline)
    if not np.array_equal(reference, result):
        raise ValueError("Portable pipeline differs from sklearn's fitted transform")
    return pipeline, result


def transform_features(frame, pipeline):
    if pipeline.get("schema_version") != 1 or pipeline.get("use_est_width_feature") is not False:
        raise ValueError("Unsupported feature pipeline schema or width mode")
    numeric, categorical = pipeline["numeric_features"], pipeline["categorical_features"]
    frame = _prepare(frame, numeric, categorical)
    scale, offset = np.asarray(pipeline["scaler"]["scale_"]), np.asarray(pipeline["scaler"]["min_"])
    if scale.shape != (len(numeric),) or offset.shape != scale.shape:
        raise ValueError("Scaler dimensions do not match numeric features")
    # Same operation order as MinMaxScaler.transform; no clipping of unseen values.
    values = frame[numeric].to_numpy(dtype=np.float64) * scale
    values += offset
    categories = pipeline["encoder"]["categories_"]
    if len(categories) != len(categorical):
        raise ValueError("Encoder dimensions do not match categorical features")
    encoded = [(frame[column].to_numpy()[:, None] == np.asarray(levels)[None, :]).astype(np.float64)
               for column, levels in zip(categorical, categories)]
    columns = numeric + [f"{column}_{level}" for column, levels in zip(categorical, categories) for level in levels]
    if columns != pipeline["feature_cols"]:
        raise ValueError("Feature column order does not match pipeline parameters")
    result = np.hstack([values, *encoded]).astype(np.float32)
    if result.shape[1] != pipeline["n_features"] or not np.isfinite(result).all():
        raise ValueError("Feature matrix has invalid dimensions or values")
    return result
