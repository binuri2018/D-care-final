from datetime import timedelta

from .config import Settings
from .db import get_db
from .socket_manager import emit_alert_new
from .util import now_utc, serialize_alert


async def run_stale_check(settings: Settings) -> None:
    db = get_db()
    now = now_utc()
    stale_before = now - timedelta(minutes=settings.heartbeat_stale_minutes)

    cursor = db.pairings.find(
        {
            "$or": [
                {"trackingStatus": "approved"},
                {"tracking_status": "approved"},
            ],
        }
    )
    async for pairing in cursor:
        pid = pairing["patientId"]
        gid = pairing["guardianId"]
        hb = await db.heartbeats.find_one({"patientId": pid}, sort=[("createdAt", -1)])
        if hb and hb.get("createdAt") and hb["createdAt"] > stale_before:
            continue
        recent = await db.alerts.find_one(
            {
                "patientId": pid,
                "type": "heartbeat_stale",
                "createdAt": {"$gte": now - timedelta(hours=24)},
            }
        )
        if recent:
            continue

        doc = {
            "type": "heartbeat_stale",
            "severity": "warning",
            "message": "No recent heartbeat from patient (possible connectivity or safety issue).",
            "patientId": pid,
            "guardianId": gid,
            "acknowledged": False,
            "metadata": {},
            "createdAt": now,
        }
        res = await db.alerts.insert_one(doc)
        doc["_id"] = res.inserted_id
        await emit_alert_new(str(gid), serialize_alert(doc))
