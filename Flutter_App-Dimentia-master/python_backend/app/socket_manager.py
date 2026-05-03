from __future__ import annotations

from typing import Any

_sio: Any = None


def set_sio(sio: Any) -> None:
    global _sio
    _sio = sio


def get_sio() -> Any:
    return _sio


async def emit_alert_new(guardian_id: str, payload: dict) -> None:
    sio = _sio
    if sio is None:
        return
    await sio.emit("alert:new", payload, room=f"guardian:{guardian_id}")
