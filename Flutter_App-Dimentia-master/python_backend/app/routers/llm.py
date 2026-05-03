from typing import Annotated

import httpx
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status

from ..config import Settings
from ..db import get_db
from ..deps import get_current_user, get_settings
from ..util import now_utc

router = APIRouter(prefix="/llm", tags=["llm"])


async def _patient_context(db, patient_oid: ObjectId) -> str:
    lines = []
    risk = await db.risk_events.find_one({"patientId": patient_oid}, sort=[("createdAt", -1)])
    if risk:
        lines.append(f"Latest hybrid risk: {risk.get('hybridRisk')} (score {risk.get('weightedScore')})")
    n_alerts = await db.alerts.count_documents({"patientId": patient_oid})
    lines.append(f"Total alerts on file: {n_alerts}")
    clin = await db.clinical_submissions.find_one({"patientId": patient_oid}, sort=[("createdAt", -1)])
    if clin:
        lines.append(f"Latest clinical probability: {clin.get('modelProbability')}")
    return "\n".join(lines) if lines else "No structured records yet."


@router.get("/chat-history")
async def chat_history(
    user: Annotated[dict, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
    patientId: str = Query(...),
    limit: int = Query(100, ge=1, le=200),
):
    _ = settings
    if user["role"] != "guardian":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only guardians can use clinical chat")
    try:
        pid = ObjectId(patientId)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid patientId")
    db = get_db()
    pairing = await db.pairings.find_one({"guardianId": user["_id"], "patientId": pid})
    if not pairing:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not paired with this patient")

    cursor = (
        db.chat_messages.find({"patientId": pid, "guardianId": user["_id"]})
        .sort("createdAt", 1)
        .limit(limit)
    )
    out = []
    async for m in cursor:
        out.append(
            {
                "query": m.get("query"),
                "response": m.get("response"),
                "source": m.get("source"),
                "createdAt": m.get("createdAt").isoformat() if m.get("createdAt") else None,
            }
        )
    return out


@router.post("/query-records")
async def query_records(
    body: Annotated[dict, Body()],
    user: Annotated[dict, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    if user["role"] != "guardian":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only guardians can query records")
    q = (body.get("query") or "").strip()
    pid_raw = (body.get("patientId") or "").strip()
    if len(q) < 5:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query too short")
    try:
        pid = ObjectId(pid_raw)
    except InvalidId:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid patientId")

    db = get_db()
    pairing = await db.pairings.find_one({"guardianId": user["_id"], "patientId": pid})
    if not pairing:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not paired with this patient")

    ctx = await _patient_context(db, pid)
    source = "cloud"
    response_text = ""

    if settings.ollama_api_key:
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.post(
                    f"{settings.ollama_base_url.rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {settings.ollama_api_key}"},
                    json={
                        "model": settings.ollama_model,
                        "messages": [
                            {
                                "role": "system",
                                "content": "You are a clinical assistant. Answer using only the context provided. Be concise.",
                            },
                            {
                                "role": "user",
                                "content": f"Context:\n{ctx}\n\nQuestion: {q}",
                            },
                        ],
                    },
                )
                r.raise_for_status()
                data = r.json()
                response_text = (
                    data.get("choices", [{}])[0].get("message", {}).get("content")
                    or "No response text."
                )
        except Exception:
            source = "fallback"
            response_text = (
                f"[Offline summary]\n{ctx}\n\nRegarding your question \"{q}\": "
                "configure OLLAMA_API_KEY and OLLAMA_BASE_URL for full LLM answers."
            )
    else:
        source = "fallback"
        response_text = (
            f"[Local summary]\n{ctx}\n\nQ: {q}\n\n"
            "Set OLLAMA_API_KEY in the API .env to enable cloud LLM responses."
        )

    await db.chat_messages.insert_one(
        {
            "patientId": pid,
            "guardianId": user["_id"],
            "query": q,
            "response": response_text,
            "source": source,
            "createdAt": now_utc(),
        }
    )
    return {"message": "ok"}
