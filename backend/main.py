from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI

_BACKEND_ROOT = Path(__file__).resolve().parent
load_dotenv(_BACKEND_ROOT / ".env")
from starlette.middleware.cors import CORSMiddleware

from dementia_action_subsystem import config as dac_config
from dementia_action_subsystem.live_session import live_session_count
from api.routes_dementia_action import router as dementia_action_router
from api.routes_face import router as face_router
from api.routes_memory import router as memory_router
from api.routes_mode import router as mode_router
from api.routes_reminders import router as reminders_router

_COGNITIVE_SCREENING_DIR = Path(__file__).resolve().parent / "cognitive_screening"
_COGNITIVE_SCREENING_AVAILABLE = False
try:
    from cognitive_screening.routers import confusion as screening_confusion
    from cognitive_screening.routers import mri as screening_mri
    from cognitive_screening.routers import predict as screening_predict
    from cognitive_screening.routers import session as screening_session

    _COGNITIVE_SCREENING_AVAILABLE = True
except ImportError:
    screening_confusion = None  # type: ignore[assignment,misc]
    screening_mri = None  # type: ignore[assignment,misc]
    screening_predict = None  # type: ignore[assignment,misc]
    screening_session = None  # type: ignore[assignment,misc]

_LOG = logging.getLogger(__name__)

ENABLE_GUARDIAN_API = os.getenv("ENABLE_GUARDIAN_API", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)

_guardian_state: dict = {"mongo_connected": False, "detail": ""}


@asynccontextmanager
async def _lifespan(app: FastAPI):
    stale_task: asyncio.Task | None = None
    mongo_ok = False
    _guardian_state["mongo_connected"] = False
    _guardian_state["detail"] = ""
    if ENABLE_GUARDIAN_API:
        try:
            from guardian_api.config import Settings as GuardianSettings
            from guardian_api.db import connect, disconnect, ping_database
            from guardian_api.jobs import run_stale_check

            gs = GuardianSettings()
            uri = (gs.mongo_uri or os.environ.get("MONGO_URI") or "").strip()
            if not uri and os.getenv("GUARDIAN_USE_LOCAL_MONGO_DEV", "").strip().lower() in (
                "1",
                "true",
                "yes",
            ):
                uri = "mongodb://127.0.0.1:27017"
                _LOG.info("Dementia Guardian: GUARDIAN_USE_LOCAL_MONGO_DEV=1 → %s", uri)
            if not uri:
                _guardian_state["detail"] = (
                    "MONGO_URI is not set. Add it to backend/.env, or run MongoDB locally and set "
                    "GUARDIAN_USE_LOCAL_MONGO_DEV=1 for mongodb://127.0.0.1:27017 (database ticketdb). "
                    "Restart the server after changing .env."
                )
                _LOG.warning("Dementia Guardian: no MongoDB URI — auth returns 503 until configured")
            else:
                connect(uri)
                await ping_database()
                mongo_ok = True
                _guardian_state["mongo_connected"] = True

                async def _stale_loop() -> None:
                    while True:
                        await asyncio.sleep(120)
                        try:
                            await run_stale_check(gs)
                        except Exception:
                            pass

                stale_task = asyncio.create_task(_stale_loop())
        except Exception as exc:
            _guardian_state["detail"] = str(exc)
            _LOG.warning("Dementia Guardian MongoDB not connected: %s", exc)
    yield
    if stale_task:
        stale_task.cancel()
        try:
            await stale_task
        except asyncio.CancelledError:
            pass
    if mongo_ok:
        from guardian_api.db import disconnect

        await disconnect()
    _guardian_state["mongo_connected"] = False


fastapi_app = FastAPI(
    title="Memory Aid + Reminder Backend",
    version="1.0.0",
    description=(
        "Indoor/outdoor reminders (mobile + web), memory/face, dementia_action_subsystem, "
        "cognitive screening when dependencies import cleanly, and Dementia Guardian APIs "
        "(MongoDB) when ENABLE_GUARDIAN_API=1 and MONGO_URI is set."
    ),
    lifespan=_lifespan,
)

# `allow_origins=["*"]` + `allow_credentials=True` is invalid per CORS spec — browsers block it.
# CRA (`localhost:3000`) and guardian Vite dev must be listed explicitly (or set CORS_ALLOW_ORIGINS).
_cors_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
_cors_env = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
if _cors_env:
    _cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]

@fastapi_app.get("/health")
def health_check():
    """Single entry-point status for ops, load balancers, and mobile/web clients."""
    return {
        "status": "ok",
        "dementia_action": {
            "enabled": True,
            "incident_dir": dac_config.ACTION_INCIDENT_DIR,
            "model_root": str(dac_config.DEMENTIA_ACTION_MODEL_ROOT),
            "live_sessions_active": live_session_count(),
        },
        "cognitive_screening": {
            "enabled": _COGNITIVE_SCREENING_AVAILABLE,
            "package_path": str(_COGNITIVE_SCREENING_DIR) if _COGNITIVE_SCREENING_DIR.is_dir() else None,
        },
        "dementia_guardian": {
            "enabled": ENABLE_GUARDIAN_API,
            "mongo_connected": _guardian_state.get("mongo_connected", False),
            "detail": _guardian_state.get("detail") or None,
        },
    }


fastapi_app.include_router(mode_router, prefix="/api")
fastapi_app.include_router(reminders_router, prefix="/api")
fastapi_app.include_router(face_router, prefix="/api")
fastapi_app.include_router(memory_router, prefix="/api")
fastapi_app.include_router(dementia_action_router, prefix="/api")

if ENABLE_GUARDIAN_API:
    from guardian_api.integration import mount_guardian_routers

    mount_guardian_routers(fastapi_app)

if _COGNITIVE_SCREENING_AVAILABLE:
    fastapi_app.include_router(screening_predict.router)
    fastapi_app.include_router(screening_session.router)
    fastapi_app.include_router(screening_mri.router)
    fastapi_app.include_router(screening_confusion.router)

# CORS must wrap the *outermost* ASGI app. Socket.IO's ASGIApp can bypass FastAPI middleware,
# so applying CORSMiddleware only on fastapi_app breaks browser requests (e.g. /api/pairing/join).
if ENABLE_GUARDIAN_API:
    from guardian_api.asgi_socket import wrap_with_socketio

    _asgi_inner = wrap_with_socketio(fastapi_app)
else:
    _asgi_inner = fastapi_app

app = CORSMiddleware(
    _asgi_inner,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
