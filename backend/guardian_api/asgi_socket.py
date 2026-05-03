"""Socket.IO ASGI wrapper (real-time guardian alerts)."""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs

import socketio
from fastapi import FastAPI

from .socket_manager import set_sio


def wrap_with_socketio(fastapi_app: FastAPI) -> Any:
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

    return socketio.ASGIApp(sio, other_asgi_app=fastapi_app)
