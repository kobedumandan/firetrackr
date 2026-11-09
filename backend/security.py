"""Password hashing, JWT issue/verify, and the authenticated-user dependency."""
import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from config import JWT_ALGORITHM, JWT_EXPIRE_HOURS, JWT_SECRET
from database import get_db
from models import TokenBlacklist, Users


_bearer = HTTPBearer()


def _verify_password(plain: str, stored: str) -> bool:
    try:
        _, params = stored.split("$", 1)
        salt, dk_hex = params.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt.encode(), 260_000)
        return dk.hex() == dk_hex
    except Exception:
        return False


def _hash_password(plain: str) -> str:
    import secrets
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt.encode(), 260_000)
    return f"pbkdf2:sha256:260000${salt}${dk.hex()}"


def _create_token(user: Users) -> str:
    import secrets
    # "iat" is what the client reads back to show how long the session has been
    # running; without it the dashboard can only time from when a component
    # mounted, which resets on every reload and tab switch.
    issued_at = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.user_id),
        "email": user.user_email,
        "role": user.user_role,
        "jti": secrets.token_hex(16),
        "iat": issued_at.timestamp(),
        "exp": issued_at + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(_bearer),
    db: Session = Depends(get_db),
) -> Users:
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        jti = payload.get("jti")
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if jti and db.query(TokenBlacklist).filter(TokenBlacklist.jti == jti).first():
        raise HTTPException(status_code=401, detail="Token has been revoked")
    user = db.get(Users, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    ensure_account_enabled(user)
    if user.sessions_revoked_at and float(payload.get('iat') or 0) <= user.sessions_revoked_at.timestamp():
        raise HTTPException(401, 'Session ended. Sign in again.')
    return user


def ensure_account_enabled(user):
    if user.disabled_at is not None or (user.personnel and user.personnel.archived_at is not None):
        raise HTTPException(401, 'This account is disabled. Contact an administrator.')


def require_admin(user: Users = Depends(get_current_user)) -> Users:
    """Dashboard-only routes. Personnel tokens are issued to the mobile app and
    are valid JWTs too, so authentication alone would let any responder edit the
    fleet, roster, stations or incidents — the role has to be checked as well."""
    if user.user_role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _user_profile(user: Users) -> dict:
    """Return a serialisable profile dict that includes name/contact from the related table."""
    profile = {
        "user_id":    user.user_id,
        "email":      user.user_email,
        "role":       user.user_role,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "password_changed_at": (
            user.password_changed_at.isoformat() if user.password_changed_at else None),
        "first_name": None,
        "last_name":  None,
        "contact":    None,
        "designation": None,
        "rank":        None,
        # The station this account reports to. Admins are city-wide rather than
        # station-bound, so None here means "not station-assigned", which the
        # dashboard renders differently per role.
        "station":     None,
    }
    if user.admin:
        profile["first_name"] = user.admin.admin_firstname
        profile["last_name"]  = user.admin.admin_lastname
        profile["contact"]    = user.admin.admin_contact
    elif user.personnel:
        profile["first_name"]  = user.personnel.per_firstname
        profile["last_name"]   = user.personnel.per_lastname
        profile["contact"]     = user.personnel.per_contact
        profile["designation"] = user.personnel.per_designation
        profile["rank"]        = user.personnel.per_rank
        station = user.personnel.station
        if station:
            profile["station"] = {
                "station_id":   station.station_id,
                "station_name": station.station_name,
            }
    return profile


def _home_station(user: Users) -> "dict | None":
    """The station a responder is dispatched from, for the mobile map's origin
    marker. Static per personnel, so it rides the login response rather than the
    10s status poll. Resolved from Personnel.station_id — team, truck and member
    station assignments agree by convention, though nothing enforces it.
    """
    per = getattr(user, "personnel", None)
    st  = getattr(per, "station", None) if per else None
    if not st or st.station_latitude is None or st.station_longitude is None:
        return None
    return {
        "station_id":        st.station_id,
        "station_name":      st.station_name,
        "station_latitude":  st.station_latitude,
        "station_longitude": st.station_longitude,
    }
