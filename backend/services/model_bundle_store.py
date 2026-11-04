"""Restore missing registered model bundles from private Supabase storage.

The database's manifest digest remains authoritative. Downloads are bounded,
verified in a staging directory, then published atomically into the local cache.
Existing model directories are never replaced. No model is deserialized here.
"""
import logging
from pathlib import Path
import re
import stat
import tempfile
from urllib.parse import quote, urlsplit
import zipfile

import httpx

import config
from services.model_artifacts import BASE_FILES, CANDIDATE_FILES, verify_artifacts


logger = logging.getLogger(__name__)
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_BUNDLE_BYTES = 128 * 1024 * 1024


def object_path(version, digest):
    if not re.fullmatch(r"v[1-9][0-9]*", version):
        raise ValueError("Invalid model version")
    if not re.fullmatch(r"[a-f0-9]{64}", digest or ""):
        raise ValueError("Invalid registered model manifest digest")
    return f"{version}/{digest}.zip"


def storage_settings():
    url = urlsplit(config.SUPABASE_URL)
    if (url.scheme != "https" or not url.hostname or url.username or url.password
            or url.path or url.query or url.fragment):
        raise ValueError("Model restoration requires the HTTPS Supabase project URL")
    key = config.SUPABASE_SECRET_KEY
    if not key or key.startswith("sb_publishable_"):
        raise ValueError("Model restoration requires a backend Supabase secret key")
    bucket = config.SUPABASE_MODEL_BUCKET
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}", bucket):
        raise ValueError("Invalid Supabase model bucket")
    headers = {"apikey": key}
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {key}"
    return f"{config.SUPABASE_URL}/storage/v1", quote(bucket, safe=""), headers


def require_private_bucket(client, bucket):
    response = client.get(f"bucket/{bucket}")
    if response.status_code != 200:
        raise RuntimeError(f"Private model bucket is unavailable (HTTP {response.status_code})")
    if response.json().get("public") is not False:
        raise ValueError("The Supabase model bucket must be private")


def unpack_verified_bundle(archive_path, destination, version, digest):
    """Extract only known regular bundle files, with byte and integrity limits."""
    destination = Path(destination).resolve()
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        names = {entry.filename for entry in entries}
        if (len(entries) != len(names)
                or names not in (BASE_FILES | {"manifest.json"}, CANDIDATE_FILES | {"manifest.json"})):
            raise ValueError("Model archive contains unexpected, missing, or duplicate files")
        if sum(entry.file_size for entry in entries) > MAX_BUNDLE_BYTES:
            raise ValueError("Model bundle exceeds the extraction limit")
        written = 0
        for entry in entries:
            target = destination / entry.filename
            if (entry.is_dir() or stat.S_ISLNK(entry.external_attr >> 16)
                    or target.resolve().parent != destination):
                raise ValueError("Model archive contains an unsafe entry")
            with archive.open(entry) as source, target.open("xb") as output:
                for block in iter(lambda: source.read(64 * 1024), b""):
                    written += len(block)
                    if written > MAX_BUNDLE_BYTES:
                        raise ValueError("Model bundle exceeds the extraction limit")
                    output.write(block)
    manifest, _, _ = verify_artifacts(destination, digest)
    if manifest.get("version") != version:
        raise ValueError("Downloaded model version differs from its registry entry")


def ensure_model_bundle(version, digest):
    """Restore only an absent version; normal routing verification checks caches."""
    path = object_path(version, digest)
    from services.model_registry import version_directory

    directory = version_directory(version)
    if directory.exists():
        return False
    base, bucket, headers = storage_settings()
    root = directory.parent
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".restore-{version}-", dir=root) as temporary:
        staging = Path(temporary).resolve()
        if staging.parent != root.resolve():
            raise ValueError("Model staging directory is outside the artifact cache")
        archive_path = staging / "download.zip"
        extracted = staging / "bundle"
        extracted.mkdir()
        try:
            with httpx.Client(base_url=f"{base}/", headers=headers,
                              timeout=httpx.Timeout(60.0, connect=5.0), follow_redirects=False) as client:
                require_private_bucket(client, bucket)
                with client.stream("GET", f"object/{bucket}/{path}") as response:
                    if response.status_code != 200:
                        raise RuntimeError(f"Registered model bundle is unavailable (HTTP {response.status_code})")
                    received = 0
                    with archive_path.open("xb") as output:
                        for block in response.iter_bytes(64 * 1024):
                            received += len(block)
                            if received > MAX_ARCHIVE_BYTES:
                                raise ValueError("Model archive exceeds the download limit")
                            output.write(block)
        except httpx.HTTPError:
            raise RuntimeError("Model artifact storage request failed") from None
        unpack_verified_bundle(archive_path, extracted, version, digest)
        if directory.exists():
            verify_artifacts(directory, digest)
            return False
        try:
            extracted.rename(directory)
        except OSError:
            if not directory.exists():
                raise
            verify_artifacts(directory, digest)
            return False
    logger.info("Restored verified model bundle %s from private storage", version)
    return True
