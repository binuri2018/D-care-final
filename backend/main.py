from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

app = FastAPI(
    title="Memory Aid + Reminder Backend",
    version="1.0.0",
    description=(
        "Indoor/outdoor reminders (mobile + web), memory/face, dementia_action_subsystem, "
        "and cognitive screening (backend/cognitive_screening) when dependencies import cleanly."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
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
    }


app.include_router(mode_router, prefix="/api")
app.include_router(reminders_router, prefix="/api")
app.include_router(face_router, prefix="/api")
app.include_router(memory_router, prefix="/api")
app.include_router(dementia_action_router, prefix="/api")

if _COGNITIVE_SCREENING_AVAILABLE:
    # Routers already use prefix="/api" (predict, session, mri, confusion).
    app.include_router(screening_predict.router)
    app.include_router(screening_session.router)
    app.include_router(screening_mri.router)
    app.include_router(screening_confusion.router)
