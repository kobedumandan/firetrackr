"""Liveness endpoints and the dashboard WebSocket."""
import asyncio
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials
from jose import JWTError, jwt

from config import JWT_ALGORITHM, JWT_SECRET
from database import SessionLocal, check_connection
from security import get_current_user, require_admin
from state import manager


router = APIRouter(tags=["system"])


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, token: str = Query(...),
                      notifications: bool = False, notification_cursor: str | None = Query(None, max_length=100)):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        await websocket.close(code=4001)
        return

    def authorize():
        with SessionLocal() as db:
            user = get_current_user(HTTPAuthorizationCredentials(scheme='Bearer', credentials=token), db)
            if notifications:
                require_admin(user)
    try:
        await run_in_threadpool(authorize)
    except HTTPException as error:
        await websocket.close(code=4001 if error.status_code == 401 else 4003)
        return
    await manager.connect(websocket, notifications=notifications, cursor=notification_cursor)
    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=15)
            except asyncio.TimeoutError:
                data = None
            try:
                await run_in_threadpool(authorize)
            except HTTPException as error:
                await websocket.close(code=4001 if error.status_code == 401 else 4003)
                break
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)


@router.get("/")
def root():
    return {"message": "BFP Capstone API is running"}


@router.get("/health")
def health():
    db_ok = check_connection()
    return {"api": "ok", "database": "ok" if db_ok else "unavailable"}


@router.get("/health/live")
async def liveness():
    """Check the serving event loop without waiting on the DB or thread pool."""
    return {"api": "ok"}
