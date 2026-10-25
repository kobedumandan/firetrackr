"""Environment-driven settings and tuning constants for the API.

Pure values only — importing this module must never pull in the database, the
routing engine, or FastAPI, so every other module can depend on it freely.

Every value below is read at import time, and this module is imported long
before anything touches the database, so it cannot rely on database.py's
load_dotenv() side effect to have populated the environment first. Without the
explicit load here, a populated .env is silently ignored and every setting
falls back to its default.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Training is opt-in through the admin API; no job starts during startup.
_RETRAIN_REPO_ROOT = Path(__file__).resolve().parent.parent
RETRAIN_RUNNER = os.getenv("RETRAIN_RUNNER", "local")
RETRAIN_PYTHON = Path(os.getenv("RETRAIN_PYTHON", str(
    _RETRAIN_REPO_ROOT / ".venv-training" / ("Scripts/python.exe" if os.name == "nt" else "bin/python"))))
RETRAIN_TIMEOUT_MIN = float(os.getenv("RETRAIN_TIMEOUT_MIN", "60"))
RETRAIN_MODAL_APP = os.getenv("RETRAIN_MODAL_APP", "firetrackr-training")
RETRAIN_MODAL_VOLUME = os.getenv("RETRAIN_MODAL_VOLUME", "firetrackr-training-jobs")
RETRAIN_MODAL_ENVIRONMENT = os.getenv("RETRAIN_MODAL_ENVIRONMENT", "main")
RETRAIN_POLL_SECONDS = 10
MODEL_VERSIONS_ROOT = _RETRAIN_REPO_ROOT / "backend/ai/models/versions"
RETRAIN_WORK_ROOT = _RETRAIN_REPO_ROOT / "backend/data/retraining/registry"


JWT_SECRET      = os.getenv("JWT_SECRET", "change-me")
JWT_ALGORITHM   = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "8"))


# ── PhilSMS / reporter location requests ──────────────────────────────────────
# Public base URL (ngrok tunnel to this backend) the reporter's phone reaches.
PUBLIC_BASE_URL   = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
PHILSMS_API_TOKEN = (os.getenv("PHILSMS_API_TOKEN", "") or "").strip()
PHILSMS_SENDER_ID = os.getenv("PHILSMS_SENDER_ID", "PhilSMS")
SEND_SMS          = os.getenv("SEND_SMS", "false").lower() == "true"
PHILSMS_SEND_URL  = "https://dashboard.philsms.com/api/v3/sms/send"


# ── Dispatch alerts to responders' phones ─────────────────────────────────────
# Pushes go through Expo's push service, which holds the FCM credentials (set
# up with `eas credentials`). EXPO_ACCESS_TOKEN is only needed if "enhanced push
# security" is turned on for the Expo project.
EXPO_PUSH_URL     = "https://exp.host/--/api/v2/push/send"
EXPO_ACCESS_TOKEN = (os.getenv("EXPO_ACCESS_TOKEN", "") or "").strip()
# Text a dispatched member who has no registered phone. Still gated by
# SEND_SMS above, so development never spends SMS credits by accident.
DISPATCH_SMS_FALLBACK = os.getenv("DISPATCH_SMS_FALLBACK", "true").lower() == "true"


# ── Uploaded report photos ────────────────────────────────────────────────────
# Scene photographs personnel attach to an incident report are written here and
# served back over the public tunnel at /uploads/report_photos/<file>.
UPLOAD_ROOT       = os.path.join(os.path.dirname(__file__), "uploads")
REPORT_PHOTO_DIR  = os.path.join(UPLOAD_ROOT, "report_photos")
MAX_REPORT_PHOTOS = 8
MAX_PHOTO_BYTES   = 10 * 1024 * 1024  # 10 MB per photo
ALLOWED_PHOTO_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"}
_PHOTO_EXT = {
    "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png",
    "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heif",
}


os.makedirs(REPORT_PHOTO_DIR, exist_ok=True)


# ── Routing process pool ──────────────────────────────────────────────────────
# CPU-bound route computation (connector builds, full rebuilds) is offloaded to
# a pool of worker processes so it runs with real parallelism instead of
# serializing behind this process's GIL. Each worker loads its own graph copy.
# ROUTING_POOL_SIZE=0 disables the pool (falls back to in-process compute).
ROUTING_POOL_SIZE    = int(os.getenv("ROUTING_POOL_SIZE", "2"))
ROUTING_POOL_TIMEOUT = float(os.getenv("ROUTING_POOL_TIMEOUT", "30"))


# Postgres advisory-lock key so that, when the API runs with multiple worker
# processes, exactly ONE worker runs the stale-driver watchdog (otherwise every
# worker would scan and reroute the same dispatches). The lock is held for the
# lifetime of the winning worker via a dedicated raw connection.
_WATCHDOG_LOCK_KEY = 912736
_SOURCE_PRIORITY = {"mobile_app": 2, "iot_sms": 1}
DEVIATION_THRESHOLD_M = 280
REJOIN_THRESHOLD_M    = 50
STALE_MINUTES         = 15
RACE_WINDOW_SECONDS   = 30


# Watchdog: if a route is currently origin="driver_location" but the driver's
# last reported position is older than STALE_MINUTES + STATION_FALLBACK_GRACE_MINUTES,
# revert the route back to station-origin.
STATION_FALLBACK_GRACE_MINUTES = 2
WATCHDOG_INTERVAL_SECONDS      = 15


# ── Token-blacklist reaper ────────────────────────────────────────────────────
# Logout parks a token's jti in `token_blacklist` so the remainder of its life
# can be refused. Once the token's own "exp" has passed, jwt.decode rejects it
# on signature-expiry alone and the row stops carrying any information — it is
# dead weight that would otherwise accumulate one row per logout, forever.
# A second advisory lock keeps the reaper single-worker, same as the watchdog.
_BLACKLIST_REAPER_LOCK_KEY        = 912737
BLACKLIST_REAPER_INTERVAL_SECONDS = int(os.getenv("BLACKLIST_REAPER_INTERVAL", "3600"))
# Keep rows a little past expiry: clock skew between the API and anything else
# validating the token shouldn't let a just-expired jti slip back through.
BLACKLIST_REAPER_GRACE_MINUTES    = 5


# ── Off-request-thread routing ────────────────────────────────────────────────
# Operational switch: when true, the deviation-triggered routing runs INLINE in
# the request (blocking it — the pre-optimisation behaviour, useful for A/B
# comparison). Default false = deferred to a background task.
_REROUTE_INLINE = os.getenv("LOCATION_REROUTE_INLINE", "false").lower() == "true"
OPERATIONAL_GPS_AUTOMATION = os.getenv("OPERATIONAL_GPS_AUTOMATION", "false").lower() == "true"
CONNECTOR_MERGE_TOLERANCE_M = 20
