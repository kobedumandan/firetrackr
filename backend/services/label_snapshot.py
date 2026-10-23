"""Freeze baseline manual labels plus active drawings; keep deletion evidence.

The core accepts plain annotation rows without database I/O. No prediction can
become a positive training label through this module.
"""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

LABEL_FLAGS = ("is_narrow", "is_narrow_severe", "narrow_severity", "is_construction",
               "traffic_nightmarket", "traffic_market", "traffic_pnm", "traffic_general",
               "traffic_school", "traffic_highway")
LABEL_FIELDS = LABEL_FLAGS + ("constraint_type", "constraint_score", "is_constrained")


def simplify_constraint_for_gnn(row):
    """Notebook Cell 8.1; width estimates and model guesses are not labels."""
    candidates = []
    for flag, kind, score in (
        ("is_construction", "construction", 1.00), ("traffic_nightmarket", "traffic_nightmarket", 1.00),
        ("traffic_market", "traffic_market", 0.85), ("traffic_pnm", "traffic_pnm", 0.80),
        ("traffic_general", "traffic_general", 0.70), ("traffic_school", "traffic_school", 0.65),
        ("traffic_highway", "traffic_highway", 0.60),
    ):
        if row.get(flag, 0) == 1:
            candidates.append((kind, score))
    if row.get("is_narrow_severe", 0) == 1:
        candidates.append(("narrow_road_severe", 0.85))
    elif row.get("is_narrow", 0) == 1:
        severity = int(row.get("narrow_severity", 0))
        if severity >= 3:
            candidates.append(("narrow_road_severe", 0.85))
        elif severity == 1:
            candidates.append(("narrow_road_slight", 0.45))
        else:
            candidates.append(("narrow_road", 0.55))
    if not candidates:
        return {"constraint_type": "normal", "constraint_score": 0.0, "is_constrained": 0}
    kind, score = max(candidates, key=lambda item: item[1])
    return {"constraint_type": kind, "constraint_score": score, "is_constrained": 1}


def label_hash(features):
    from .constraint_segments import segment_uid

    rows = []
    for feature in features:
        props = feature["properties"]
        flags = {key: int(props.get(key, 0)) for key in LABEL_FLAGS}
        rows.append({"segment_uid": segment_uid(feature), **flags, **simplify_constraint_for_gnn(flags)})
    rows.sort(key=lambda row: row["segment_uid"])
    if not rows or len({r["segment_uid"] for r in rows}) != len(rows):
        raise ValueError("Labels require unique segment identities and at least one row")
    payload = json.dumps(rows, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(payload.encode()).hexdigest()


def build_snapshot(baseline_path, annotations, created_by=None, purpose="training"):
    from .constraint_segments import SegmentIndex, segment_uid

    if purpose not in ("training", "synthetic_validation"):
        raise ValueError("Unknown snapshot purpose")
    annotations = list(annotations)
    for row in annotations:
        if not isinstance(row.get("is_active", True), bool):
            raise ValueError("Annotation activity must be boolean")
        if row['constraint_type'] not in ('narrow_road', 'traffic_area'):
            raise ValueError("Unsupported annotation type")
        uids = row.get('segment_uids')
        if uids is not None and (not isinstance(uids, list) or any(not isinstance(uid, str) for uid in uids)):
            raise ValueError("Annotation segment_uids must be a list of strings")
    data = Path(baseline_path).read_bytes()
    original = json.loads(data)["features"]
    index = SegmentIndex(original)
    baseline_hash = label_hash(original)
    features, by_uid = [], {}
    for feature in original:
        props = feature["properties"]
        flags = {key: int(props.get(key, 0)) for key in LABEL_FLAGS}
        labels = simplify_constraint_for_gnn(flags)
        if any(props.get(key) != value for key, value in labels.items()):
            raise ValueError("Baseline manual flags disagree with its training labels")
        props = {key: value for key, value in props.items()
                 if not key.startswith(("model_", "map_", "final_display_", "human_verified_"))
                 and key not in ("display_constraint_type", "routing_constraint_type", "annotation_source",
                                 "is_gat_only_prediction", "is_manual_verified", "hover_confidence_text",
                                 "actual_model_used", "best_result_label")}
        uid = segment_uid(feature)
        props.update(flags)
        props.update(labels)
        props.update(segment_uid=uid, annotation_source="manual_verified" if labels["is_constrained"] else "normal_unconstrained")
        out = {"type": "Feature", "geometry": feature["geometry"], "properties": props}
        features.append(out)
        by_uid[uid] = out
    # A selected junction-to-junction edge can be shorter than a training
    # feature. Never label the rest of that feature from a partial selection.
    def pairs(coordinates):
        points = [tuple(round(float(v), 6) for v in p[:2]) for p in coordinates]
        return {tuple(sorted((a, b))) for a, b in zip(points, points[1:]) if a != b}

    selected_pairs = {}
    for annotation in annotations:
        if annotation.get('is_active', True) and any(uid.startswith('edge-v1-') for uid in (annotation.get('segment_uids') or [])):
            coords = annotation['coordinates']
            group = (annotation['constraint_type'], annotation.get('narrow_severity'))
            selected_pairs.setdefault(group, set()).update(pairs(json.loads(coords) if isinstance(coords, str) else coords))
    baseline_pairs = {uid: pairs(feature['geometry']['coordinates']) for uid, feature in by_uid.items()}
    history, touched = [], set()
    partial_edge_rows = 0
    active_count = matched_count = 0
    for row in annotations:
        active = row.get("is_active", True)
        if not isinstance(active, bool):
            raise ValueError("Annotation activity must be boolean")
        kind = row["constraint_type"]
        if kind not in ("narrow_road", "traffic_area"):
            raise ValueError("Unsupported annotation type")
        uids = row.get("segment_uids")
        if uids is None:
            coords = row.get("coordinates")
            uids = index.snap(json.loads(coords) if isinstance(coords, str) else coords)
        if not isinstance(uids, list) or any(not isinstance(uid, str) for uid in uids):
            raise ValueError("Annotation segment_uids must be a list of strings")
        uids = sorted(set(uids))
        selected_edge_uids = [uid for uid in uids if uid.startswith('edge-v1-')]
        if selected_edge_uids:
            coords = row['coordinates']
            covered = pairs(json.loads(coords) if isinstance(coords, str) else coords)
            group_coverage = selected_pairs.get((kind, row.get('narrow_severity')), set())
            uids = [uid for uid, road_pairs in baseline_pairs.items()
                    if road_pairs and road_pairs <= group_coverage and road_pairs & covered]
            if active and not uids:
                partial_edge_rows += 1
        if active and set(uids) - by_uid.keys():
            raise ValueError("Active annotation references unknown segments; reconcile road identities first")
        history.append({"id": row.get("id", row.get("constraint_id")), "constraint_type": kind,
                        "is_active": active, "segment_uids": uids,
                        "narrow_severity": row.get('narrow_severity'), "traffic_schedule": row.get('traffic_schedule'),
                        **({'selected_edge_uids': selected_edge_uids} if selected_edge_uids else {})})
        if not active:
            continue
        active_count += 1
        matched_count += bool(uids)
        for uid in uids:
            props = by_uid[uid]["properties"]
            if kind == "narrow_road":
                props["is_narrow"] = 1
                severity = row.get('narrow_severity')
                if severity in ('slight', 'severe'):
                    props['is_narrow_severe'] = int(severity == 'severe')
                    props['narrow_severity'] = 1 if severity == 'slight' else 3
                else:
                    props["narrow_severity"] = max(2, props["narrow_severity"])
            else:
                props["traffic_general"] = 1
            props.update(simplify_constraint_for_gnn(props))
            props["annotation_source"] = "user_drawn"
            touched.add(uid)
    for feature in features:
        feature["properties"]["primary_constraint"] = feature["properties"]["constraint_type"]
    manifest = {
        "schema_version": 1, "purpose": purpose, "label_hash": label_hash(features),
        "baseline_label_hash": baseline_hash, "baseline_sha256": hashlib.sha256(data).hexdigest(),
        "created_at": datetime.now(timezone.utc).isoformat(), "created_by": created_by,
        "segments": len(features), "positive_segments": sum(f["properties"]["is_constrained"] for f in features),
        "counts_by_type": dict(Counter(f["properties"]["constraint_type"] for f in features)),
        "active_drawn_rows": active_count, "matched_drawn_rows": matched_count,
        "drawn_segments": len(touched), "inactive_drawn_rows": len(history) - active_count,
        "model_predictions_used_as_labels": False,
        "partial_edge_rows_not_used_as_training_labels": partial_edge_rows,
    }
    return {"type": "FeatureCollection", "features": features}, history, manifest


def write_snapshot(directory, collection, history, manifest):
    import pandas as pd
    import pyarrow  # noqa: F401 -- fail before creating files if unavailable

    directory = Path(directory)
    rows = [{"segment_uid": f["properties"]["segment_uid"],
             **{key: f["properties"][key] for key in LABEL_FIELDS}} for f in collection["features"]]
    if label_hash(collection["features"]) != manifest["label_hash"]:
        raise ValueError("Snapshot labels changed before writing")
    directory.mkdir(parents=True, exist_ok=False)
    name = f"labels_{manifest['label_hash']}.parquet"
    pd.DataFrame(rows).sort_values("segment_uid").to_parquet(directory / name, index=False)
    for filename, data in (("features.geojson", collection), ("annotations.json", history)):
        (directory / filename).write_text(json.dumps(data, allow_nan=False) + "\n", encoding="utf-8")
    manifest = {**manifest, "labels_file": name,
                "files": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(directory.iterdir())}}
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def read_database_snapshot(db, baseline_path, created_by):
    """Read annotations once, retaining tombstones; no DB writes or credentials."""
    from models import GnnConstraint

    rows = db.query(GnnConstraint).order_by(GnnConstraint.constraint_id).all()
    annotations = [{"id": row.constraint_id, "constraint_type": row.constraint_type,
                    "coordinates": row.coordinates, "segment_uids": row.segment_uids,
                    "narrow_severity": row.narrow_severity,
                    "traffic_schedule": row.traffic_schedule,
                    "is_active": row.is_active} for row in rows]
    return build_snapshot(baseline_path, annotations, created_by)


def snapshot_from_database(db, baseline_path, directory, created_by):
    collection, history, manifest = read_database_snapshot(db, baseline_path, created_by)
    return write_snapshot(directory, collection, history, manifest)
