import asyncio
from contextlib import asynccontextmanager
from urllib.parse import parse_qs

import socketio
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import BACKEND_ROOT, Settings
from pymongo.errors import ConfigurationError, ServerSelectionTimeoutError

from .db import connect, disconnect, ping_database
from .deps import settings
from .jobs import run_stale_check
from .routers import alerts, auth, clinical, heartbeats, llm, mri, pairing, reports, risk
from .socket_manager import set_sio


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not (settings.mongo_uri or "").strip():
        raise RuntimeError(
            "MONGO_URI is not set. Add it to "
            f"{BACKEND_ROOT / '.env'} (copy from .env.example) or export MONGO_URI in your shell."
        )
    connect(settings.mongo_uri)
    try:
        await ping_database()
    except Exception as exc:
        await disconnect()
        hint = (
            "MongoDB is not reachable. In python_backend/.env set MONGO_URI to your real "
            "Atlas connection string (not the placeholder cluster.example.mongodb.net)."
        )
        raise RuntimeError(f"{hint}\nDetails: {exc}") from exc

    async def loop():
        while True:
            await asyncio.sleep(120)
            try:
                await run_stale_check(settings)
            except Exception:
                pass

    task = asyncio.create_task(loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    await disconnect()


def _build_fastapi() -> FastAPI:
    app = FastAPI(title="Dementia Guardian API", lifespan=lifespan)

    @app.exception_handler(StarletteHTTPException)
    async def http_exc(_: object, exc: StarletteHTTPException):
        detail = exc.detail
        if isinstance(detail, dict) and "message" in detail:
            msg = detail["message"]
        elif isinstance(detail, str):
            msg = detail
        else:
            msg = str(detail)
        return JSONResponse({"message": msg}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_exc(_: object, exc: RequestValidationError):
        return JSONResponse(
            {"message": "Invalid request body", "errors": exc.errors()},
            status_code=422,
        )

    @app.exception_handler(ConfigurationError)
    async def mongo_config_exc(_: object, exc: ConfigurationError):
        return JSONResponse(
            {
                "message": (
                    "MongoDB connection string is invalid or DNS failed (check MONGO_URI in .env; "
                    "replace example host with your real cluster hostname)."
                ),
                "detail": str(exc),
            },
            status_code=503,
        )

    @app.exception_handler(ServerSelectionTimeoutError)
    async def mongo_timeout_exc(_: object, exc: ServerSelectionTimeoutError):
        return JSONResponse(
            {"message": "Cannot reach MongoDB (timeout). Check MONGO_URI, network, and Atlas IP allowlist.", "detail": str(exc)},
            status_code=503,
        )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    api = "/api"
    app.include_router(auth.router, prefix=api)
    app.include_router(pairing.router, prefix=api)
    app.include_router(heartbeats.router, prefix=api)
    app.include_router(alerts.router, prefix=api)
    app.include_router(clinical.router, prefix=api)
    app.include_router(mri.router, prefix=api)
    app.include_router(risk.router, prefix=api)
    app.include_router(reports.router, prefix=api)
    app.include_router(llm.router, prefix=api)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app


fastapi_app = _build_fastapi()

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
set_sio(sio)


@sio.on("connect")
async def sio_connect(sid, environ, auth=None):
    qs = parse_qs(environ.get("QUERY_STRING", ""))
    uid = (qs.get("userId") or [""])[0]
    role = (qs.get("role") or [""])[0]
    if uid and role:
        await sio.enter_room(sid, f"{role}:{uid}")


@sio.on("join-patient-room")
async def sio_join_patient(sid, data):
    pid = data if isinstance(data, str) else (data or {}).get("patientId") or (data or {}).get("0")
    if pid:
        await sio.enter_room(sid, f"patient:{pid}")


socket_app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)
# Uvicorn default import path `app.main:app` (HTTP + Socket.IO on same port)
app = socket_app
