"""Local development files or private Supabase objects, using stable filenames.

Only authenticated report handlers may request signed URLs. The application
database stores object names, never credentials or expiring links.
"""
import logging
from pathlib import Path
import re
from urllib.parse import quote, urlsplit

import httpx
from fastapi import HTTPException

import config


logger = logging.getLogger(__name__)


def _safe_name(file_name: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,254}", file_name) or ".." in file_name:
        raise ValueError("Invalid report photo filename.")
    return file_name


def _storage_settings():
    url = urlsplit(config.SUPABASE_URL)
    if (url.scheme != "https" or not url.hostname or url.username or url.password
            or url.path or url.query or url.fragment):
        raise ValueError("Supabase photo storage requires an HTTPS SUPABASE_URL without a path.")
    key = config.SUPABASE_SECRET_KEY
    if not key or key.startswith("sb_publishable_"):
        raise ValueError("Supabase photo storage requires a backend SUPABASE_SECRET_KEY.")
    bucket = config.SUPABASE_REPORT_PHOTO_BUCKET
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}", bucket):
        raise ValueError("Invalid SUPABASE_REPORT_PHOTO_BUCKET.")
    headers = {"apikey": key}
    # New secret keys are not JWTs. Legacy service_role JWTs need Bearer auth.
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {key}"
    return f"{config.SUPABASE_URL}/storage/v1", quote(bucket, safe=""), headers


def _storage_request(method: str, path: str, **kwargs) -> httpx.Response:
    base, _, headers = _storage_settings()
    headers.update(kwargs.pop("headers", {}))
    try:
        response = httpx.request(
            method, f"{base}/{path}", headers=headers,
            timeout=httpx.Timeout(30.0, connect=5.0), follow_redirects=False, **kwargs,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        # Do not log response bodies, credentials, or signed URLs.
        status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else "network"
        logger.warning("Report photo storage request failed (%s).", status)
        raise HTTPException(503, "Report photo storage is unavailable. Please try again.") from None
    return response


def _json(response):
    try:
        return response.json()
    except ValueError:
        raise HTTPException(503, "Report photo storage returned an invalid response.") from None


def check_report_photo_storage():
    """Fail startup if the configured remote bucket is missing or public."""
    if config.REPORT_PHOTO_STORAGE == "local":
        return
    _, bucket, _ = _storage_settings()
    details = _json(_storage_request("GET", f"bucket/{bucket}"))
    if not isinstance(details, dict) or details.get("public") is not False:
        raise ValueError("The Supabase report photo bucket must be private.")


def save_report_photo(file_name: str, data: bytes, content_type: str):
    file_name = _safe_name(file_name)
    if config.REPORT_PHOTO_STORAGE == "supabase":
        _, bucket, _ = _storage_settings()
        _storage_request(
            "POST", f"object/{bucket}/{quote(file_name, safe='')}",
            files={"file": (file_name, data, content_type)},
            headers={"x-upsert": "false"},
        )
        return
    destination = Path(config.REPORT_PHOTO_DIR) / file_name
    # Never overwrite an existing object, including during rollback cleanup.
    with destination.open("xb") as output:
        try:
            output.write(data)
        except BaseException:
            output.close()
            destination.unlink(missing_ok=True)
            raise


def delete_report_photos(file_names: list[str]):
    names = list(dict.fromkeys(_safe_name(name) for name in file_names))
    if not names:
        return
    if config.REPORT_PHOTO_STORAGE == "supabase":
        _, bucket, _ = _storage_settings()
        _storage_request("DELETE", f"object/{bucket}", json={"prefixes": names})
    else:
        for name in names:
            (Path(config.REPORT_PHOTO_DIR) / name).unlink(missing_ok=True)


def cleanup_report_photos(file_names: list[str]):
    """Best-effort compensation after rollback or a committed incident deletion."""
    try:
        delete_report_photos(file_names)
    except Exception:
        logger.warning("Could not clean up %s report photo(s); storage cleanup is required.", len(file_names))


def report_photo_urls(file_names: list[str]) -> list[str]:
    names = [_safe_name(name) for name in file_names]
    if not names:
        return []
    if config.REPORT_PHOTO_STORAGE == "local":
        return [f"{config.PUBLIC_BASE_URL}/uploads/report_photos/{quote(name, safe='')}" for name in names]
    _, bucket, _ = _storage_settings()
    rows = _json(_storage_request(
        "POST", f"object/sign/{bucket}",
        json={"paths": names, "expiresIn": config.REPORT_PHOTO_URL_TTL_SECONDS},
    ))
    try:
        by_name = {row["path"]: row for row in rows}
        urls = []
        for name in names:
            row = by_name[name]
            signed = row["signedURL"]
            if not isinstance(signed, str):
                raise ValueError("Missing signed photo URL.")
            parts = urlsplit(signed)
            if (row.get("error") or parts.scheme or parts.netloc
                    or not parts.path.startswith(f"/object/sign/{bucket}/") or not parts.query):
                raise ValueError("Invalid signed photo URL.")
            urls.append(f"{config.SUPABASE_URL}/storage/v1{signed}")
        return urls
    except (KeyError, TypeError, ValueError):
        raise HTTPException(503, "A report photo is unavailable in storage. Please try again.") from None
