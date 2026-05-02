from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from dementia_action_subsystem import config as dac_config
from dementia_action_subsystem.live_session import live_session_count
from api.routes_dementia_action import router as dementia_action_router
from api.routes_face import router as face_router
from api.routes_memory import router as memory_router
from api.routes_mode import router as mode_router
from api.routes_reminders import router as reminders_router

app = FastAPI(
    title="Memory Aid + Reminder Backend",
    version="1.0.0",
    description="Indoor/outdoor reminders (mobile + web), memory/face, and dementia_action_subsystem.",
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
    }


app.include_router(mode_router, prefix="/api")
app.include_router(reminders_router, prefix="/api")
app.include_router(face_router, prefix="/api")
app.include_router(memory_router, prefix="/api")
app.include_router(dementia_action_router, prefix="/api")
