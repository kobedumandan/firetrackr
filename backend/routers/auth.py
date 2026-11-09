"""Login, logout, the current-user profile, and credential self-service."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from config import JWT_ALGORITHM, JWT_SECRET
from database import get_db
from models import LoginHistory, TokenBlacklist, Users
from schemas import LoginRequest, PasswordChange, ProfileUpdate
from security import (
    _bearer, _create_token, _hash_password, _home_station, _user_profile,
    _verify_password, get_current_user, ensure_account_enabled, require_admin,
)


router = APIRouter(tags=["auth"])

LOGIN_HISTORY_LIMIT = 10


def _client_ip(request: Request) -> "str | None":
    """The caller's address, preferring the proxy header.

    The dashboard is reached through an ngrok tunnel, so request.client.host is
    the tunnel agent on localhost for every user. X-Forwarded-For is a chain of
    "client, proxy1, proxy2"; the left-most entry is the original client.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first[:45]
    client = request.client
    return client.host[:45] if client else None


def _record_login(db: Session, user: Users, request: Request) -> None:
    """Append a sign-in row. Never let bookkeeping fail the login itself."""
    try:
        db.add(LoginHistory(
            user_id=user.user_id,
            ip_address=_client_ip(request),
            user_agent=(request.headers.get("user-agent") or None),
        ))
        db.commit()
    except Exception:
        db.rollback()


def _revoke(db: Session, token: str) -> None:
    """Blacklist a still-valid token's jti, so credential changes end old sessions."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return  # already unusable — nothing to revoke
    jti, exp = payload.get("jti"), payload.get("exp")
    if not (jti and exp):
        return
    if not db.query(TokenBlacklist).filter(TokenBlacklist.jti == jti).first():
        db.add(TokenBlacklist(
            jti=jti, expires_at=datetime.fromtimestamp(exp, tz=timezone.utc)))


@router.post("/api/auth/login")
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(Users).filter(Users.user_email == req.email).first()
    if not user or not _verify_password(req.password, user.user_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    # Dashboard sign-in. Personnel sign in through /login_user (the mobile app);
    # their token would 403 on nearly every dashboard route anyway.
    if user.user_role != "admin":
        raise HTTPException(status_code=403, detail="This account can't sign in to the dashboard.")
    ensure_account_enabled(user)
    _record_login(db, user, request)
    return {
        "access_token": _create_token(user),
        "token_type": "bearer",
        "user": _user_profile(user),
    }


@router.post("/login_user")
def login_user(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(Users).filter(Users.user_email == req.email).first()
    if not user or not _verify_password(req.password, user.user_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.user_role != "personnel":
        raise HTTPException(status_code=403, detail="Access denied")
    ensure_account_enabled(user)
    _record_login(db, user, request)
    return {
        "access_token": _create_token(user),
        "token_type": "bearer",
        "user": _user_profile(user),
        "station": _home_station(user),
    }


@router.get("/api/auth/me")
def me(current_user: Users = Depends(get_current_user)):
    return _user_profile(current_user)


# Profile fields live on whichever role table the account owns, under different
# column names. Mapping them here keeps the endpoint from branching per role.
_NAME_COLUMNS = {
    "admin":     {"first_name": "admin_firstname",
                  "last_name":  "admin_lastname",
                  "contact":    "admin_contact"},
    "personnel": {"first_name": "per_firstname",
                  "last_name":  "per_lastname",
                  "contact":    "per_contact"},
}


@router.patch("/api/auth/me")
def update_me(
    body: ProfileUpdate,
    credentials: HTTPAuthorizationCredentials = Security(_bearer),
    current_user: Users = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Patch the signed-in user's own profile: email, name, or contact number.

    Only the fields actually present in the request body are touched. Changing
    the email rotates the token, because "email" is a JWT claim and the caller's
    existing token would otherwise keep asserting the old address — the client
    must swap in the returned access_token when it is non-null.
    """
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    rotate = False

    if "email" in fields:
        new_email = (fields["email"] or "").strip()
        if new_email.lower() != current_user.user_email.lower():
            taken = db.query(Users).filter(
                Users.user_email.ilike(new_email),
                Users.user_id != current_user.user_id,
            ).first()
            if taken:
                raise HTTPException(
                    status_code=409, detail="That email is already in use")
            current_user.user_email = new_email
            # Only rotate on a real change; a no-op save shouldn't cost the
            # caller its session.
            rotate = True

    name_fields = {k: v for k, v in fields.items() if k in ("first_name", "last_name", "contact")}
    if name_fields:
        row = current_user.admin or current_user.personnel
        if row is None:
            # A Users row with no admin/personnel record has nowhere to store a
            # name; surfacing that beats silently dropping the edit.
            raise HTTPException(
                status_code=409,
                detail="This account has no personnel or admin record to update",
            )
        columns = _NAME_COLUMNS["admin" if current_user.admin else "personnel"]
        for key, value in name_fields.items():
            setattr(row, columns[key], (value or "").strip())

    if rotate:
        _revoke(db, credentials.credentials)
    db.commit()
    db.refresh(current_user)
    return {
        "user": _user_profile(current_user),
        "access_token": _create_token(current_user) if rotate else None,
    }


@router.post("/api/auth/change-password")
def change_password(
    body: PasswordChange,
    credentials: HTTPAuthorizationCredentials = Security(_bearer),
    current_user: Users = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replace the signed-in user's password, proving knowledge of the old one.

    Re-authenticating here is what makes the endpoint safe to expose with only a
    bearer token: a stolen token alone cannot take over the account. The old
    token is revoked so a leaked session dies with the password it was issued
    against.
    """
    if not _verify_password(body.current_password, current_user.user_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if _verify_password(body.new_password, current_user.user_password):
        raise HTTPException(
            status_code=400, detail="New password must differ from the current one")

    _revoke(db, credentials.credentials)
    current_user.user_password = _hash_password(body.new_password)
    current_user.password_changed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(current_user)
    return {
        "user": _user_profile(current_user),
        "access_token": _create_token(current_user),
    }


@router.get("/api/auth/login-history")
def login_history(
    limit: int = LOGIN_HISTORY_LIMIT,
    current_user: Users = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    limit = max(1, min(limit, 50))
    rows = (
        db.query(LoginHistory)
        .filter(LoginHistory.user_id == current_user.user_id)
        .order_by(LoginHistory.logged_in_at.desc(), LoginHistory.login_id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "login_id":     r.login_id,
            "logged_in_at": r.logged_in_at.isoformat() if r.logged_in_at else None,
            "ip_address":   r.ip_address,
            "user_agent":   r.user_agent,
        }
        for r in rows
    ]


@router.post("/api/auth/logout", status_code=204)
def logout(
    credentials: HTTPAuthorizationCredentials = Security(_bearer),
    db: Session = Depends(get_db),
):
    _revoke(db, credentials.credentials)
    db.commit()
