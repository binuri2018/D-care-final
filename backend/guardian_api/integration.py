"""Mount Dementia Guardian REST routers on the main FastAPI app (single process)."""

from __future__ import annotations

from fastapi import FastAPI

_guardian_routers_mounted = False


def mount_guardian_routers(app: FastAPI) -> None:
    global _guardian_routers_mounted
    if _guardian_routers_mounted:
        return
    from .routers import alerts, auth, clinical, heartbeats, llm, mri, pairing, reports, risk

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
    _guardian_routers_mounted = True
