"""Freeze exported notebook blocks; deterministically assign future blocks.

Run from the repository root:
python -m training.split --export backend/data/best_model_predicted_constraints.geojson --out training/split_blocks.json
"""
import argparse
import hashlib
import json
from pathlib import Path

SPLITS = {"train", "val", "test"}


def block_split(block, manifest):
    block = str(block)
    known = manifest["blocks"].get(block)
    if known is not None:
        if known not in SPLITS:
            raise ValueError(f"Invalid split for block {block}")
        return known
    value = int(hashlib.sha256((manifest["split_version"] + ":" + block).encode()).hexdigest()[:16], 16) / 2**64
    return "train" if value < 0.70 else "val" if value < 0.85 else "test"


def freeze_export(path):
    data = Path(path).read_bytes()
    blocks = {}
    for feature in json.loads(data)["features"]:
        props = feature["properties"]
        block, split = str(props["spatial_block"]), props["split"]
        if split not in SPLITS:
            raise ValueError(f"Invalid split: {split}")
        if block in blocks and blocks[block] != split:
            raise ValueError(f"Block {block} has conflicting splits")
        blocks[block] = split
    if not blocks or set(blocks.values()) != SPLITS:
        raise ValueError("Export must contain train, val and test blocks")
    return {"schema_version": 1, "split_version": "panabo-export-v1",
            "source_sha256": hashlib.sha256(data).hexdigest(),
            "source": Path(path).name, "unseen_block_policy": "sha256:70/15/15",
            "blocks": dict(sorted(blocks.items()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    manifest = freeze_export(args.export)
    # Refuse to accidentally reset comparison history.
    with Path(args.out).open("x", encoding="utf-8") as output:
        json.dump(manifest, output, indent=2, sort_keys=True)
        output.write("\n")


if __name__ == "__main__":
    main()
