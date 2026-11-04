"""Publish a verified local model to a private bucket without changing the DB.

Run from backend/: python publish_model_bundle.py --version v1
    --manifest-sha256 <digest registered in model_versions>
Never overwrites an existing object or changes an existing bucket's privacy.
"""
import argparse
import json
from pathlib import Path
import tempfile
import zipfile

import httpx

import config
from services.model_artifacts import verify_artifacts
from services.model_bundle_store import (
    MAX_ARCHIVE_BYTES, MAX_BUNDLE_BYTES, object_path, require_private_bucket,
    storage_settings, unpack_verified_bundle,
)


def publish(version, digest):
    path = object_path(version, digest)
    root = Path(config.MODEL_VERSIONS_ROOT).resolve()
    directory = root / version
    if directory.is_symlink() or directory.resolve().parent != root:
        raise ValueError("Model directory is outside the artifact store")
    manifest, _, _ = verify_artifacts(directory, digest)
    if manifest.get("version") != version:
        raise ValueError("Model version differs from its manifest")
    names = sorted(set(manifest["files"]) | {"manifest.json"})
    if sum((directory / name).stat().st_size for name in names) > MAX_BUNDLE_BYTES:
        raise ValueError("Model bundle exceeds the extraction limit")
    base, bucket, headers = storage_settings()
    with tempfile.TemporaryFile() as output:
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name in names:
                # Deterministic entries make an already-published object comparable.
                entry = zipfile.ZipInfo(name)
                entry.compress_type = zipfile.ZIP_DEFLATED
                with (directory / name).open("rb") as source, archive.open(entry, "w") as target:
                    while block := source.read(64 * 1024):
                        target.write(block)
        size = output.tell()
        if size > MAX_ARCHIVE_BYTES:
            raise ValueError("Model archive exceeds the download limit")
        output.seek(0)
        with tempfile.TemporaryDirectory(prefix=".publish-check-", dir=root) as staging:
            if Path(staging).resolve().parent != root:
                raise ValueError("Publication staging is outside the artifact store")
            unpack_verified_bundle(output, staging, version, digest)
        output.seek(0)
        with httpx.Client(base_url=f"{base}/", headers=headers,
                          timeout=httpx.Timeout(60.0, connect=5.0), follow_redirects=False) as client:
            response = client.get(f"bucket/{bucket}")
            if response.status_code == 404 or (response.status_code == 400 and str(response.json().get("statusCode")) == "404"):
                created = client.post("bucket", json={"id": bucket, "name": bucket, "public": False})
                if created.status_code not in (200, 201):
                    raise RuntimeError(f"Could not create private model bucket (HTTP {created.status_code})")
            require_private_bucket(client, bucket)
            response = client.post(f"object/{bucket}/{path}", content=output,
                                   headers={"Content-Type": "application/zip", "x-upsert": "false"})
            if response.status_code not in (200, 201):
                raise RuntimeError(f"Model publication failed without overwriting existing objects (HTTP {response.status_code})")
    return {"version": version, "bucket": bucket, "object": path, "archive_bytes": size,
            "private": True, "database_changed": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--manifest-sha256", required=True)
    arguments = parser.parse_args()
    print(json.dumps(publish(arguments.version, arguments.manifest_sha256)))
