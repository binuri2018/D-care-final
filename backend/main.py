from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes_face import router as face_router
from api.routes_memory import router as memory_router
from api.routes_mode import router as mode_router
from api.routes_reminders import router as reminders_router

app = FastAPI(
    title="Memory Aid + Reminder Backend",
    version="1.0.0",
    description="Indoor/outdoor reminders (mobile + web), voice/memory records, and face_recognition_subsystem.",
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
    return {"status": "ok"}


app.include_router(mode_router, prefix="/api")
app.include_router(reminders_router, prefix="/api")
app.include_router(face_router, prefix="/api")
app.include_router(memory_router, prefix="/api")
