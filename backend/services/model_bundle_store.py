"""Publish and restore immutable model bundles in private Supabase storage.

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


class BundleStoreUnavailable(RuntimeError):
    """A storage failure that can be retried without discarding trained results."""


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
        raise BundleStoreUnavailable(f"Private model bucket is unavailable (HTTP {response.status_code})")
    if response.json().get("public") is not False:
        raise ValueError("The Supabase model bucket must be private")


def check_model_storage():
    """Check existing private storage before spending time on cloud training."""
    base, bucket, headers = storage_settings()
    try:
        with httpx.Client(base_url=f"{base}/", headers=headers,
                          timeout=httpx.Timeout(30.0, connect=5.0), follow_redirects=False) as client:
            require_private_bucket(client, bucket)
    except httpx.HTTPError:
        raise BundleStoreUnavailable("Model artifact storage request failed") from None


def _download_archive(client, path, destination):
    with client.stream("GET", f"object/{path}") as response:
        if response.status_code != 200:
            raise BundleStoreUnavailable(f"Registered model bundle is unavailable (HTTP {response.status_code})")
        received = 0
        with Path(destination).open("xb") as output:
            for block in response.iter_bytes(64 * 1024):
                received += len(block)
                if received > MAX_ARCHIVE_BYTES:
                    raise ValueError("Model archive exceeds the download limit")
                output.write(block)


def publish_model_bundle(version, digest, *, create_bucket=False, allow_existing=True):
    """Archive verified results before review; retries never overwrite objects.

    Automatic publication requires an existing private bucket. Only the explicit
    operator CLI can create one. A duplicate upload is accepted only after the
    stored archive passes the registered digest and every artifact hash check.
    """
    path = object_path(version, digest)
    from services.model_registry import version_directory

    directory = version_directory(version)
    manifest, _, _ = verify_artifacts(directory, digest)
    if manifest.get("version") != version:
        raise ValueError("Model version differs from its manifest")
    names = sorted(set(manifest["files"]) | {"manifest.json"})
    if sum((directory / name).stat().st_size for name in names) > MAX_BUNDLE_BYTES:
        raise ValueError("Model bundle exceeds the extraction limit")
    base, bucket, headers = storage_settings()
    root = directory.parent
    with tempfile.TemporaryFile() as output:
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name in names:
                entry = zipfile.ZipInfo(name)
                entry.compress_type = zipfile.ZIP_DEFLATED
                with (directory / name).open("rb") as source, archive.open(entry, "w") as target:
                    for block in iter(lambda: source.read(64 * 1024), b""):
                        target.write(block)
        size = output.tell()
        if size > MAX_ARCHIVE_BYTES:
            raise ValueError("Model archive exceeds the download limit")
        output.seek(0)
        with tempfile.TemporaryDirectory(prefix=".publish-check-", dir=root) as staging:
            unpack_verified_bundle(output, staging, version, digest)
        output.seek(0)
        try:
            with httpx.Client(base_url=f"{base}/", headers=headers,
                              timeout=httpx.Timeout(60.0, connect=5.0), follow_redirects=False) as client:
                if create_bucket:
                    response = client.get(f"bucket/{bucket}")
                    missing = response.status_code == 404 or (
                        response.status_code == 400 and str(response.json().get("statusCode")) == "404")
                    if missing:
                        created = client.post("bucket", json={"id": bucket, "name": bucket, "public": False})
                        if created.status_code not in (200, 201):
                            raise BundleStoreUnavailable(f"Could not create private model bucket (HTTP {created.status_code})")
                require_private_bucket(client, bucket)
                response = client.post(f"object/{bucket}/{path}", content=output,
                                       headers={"Content-Type": "application/zip", "x-upsert": "false"})
                if response.status_code not in (200, 201):
                    duplicate = response.status_code == 409
                    if response.status_code == 400:
                        try:
                            payload = response.json()
                        except ValueError:
                            payload = {}
                        duplicate = str(payload.get("statusCode")) == "409" or payload.get("error") == "Duplicate"
                    if not allow_existing or not duplicate:
                        raise BundleStoreUnavailable(f"Model publication failed without overwriting existing objects (HTTP {response.status_code})")
                    with tempfile.TemporaryDirectory(prefix=".published-check-", dir=root) as staging:
                        staging = Path(staging)
                        archive_path = staging / "existing.zip"
                        _download_archive(client, f"{bucket}/{path}", archive_path)
                        extracted = staging / "bundle"
                        extracted.mkdir()
                        unpack_verified_bundle(archive_path, extracted, version, digest)
        except httpx.HTTPError:
            raise BundleStoreUnavailable("Model artifact publication request failed") from None
    return {"version": version, "bucket": bucket, "object": path, "archive_bytes": size,
            "private": True, "database_changed": False}


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
                _download_archive(client, f"{bucket}/{path}", archive_path)
        except httpx.HTTPError:
            raise BundleStoreUnavailable("Model artifact storage request failed") from None
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
