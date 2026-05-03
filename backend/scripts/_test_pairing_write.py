"""One-off: verify pairings upsert works with current MongoDB (run from backend/)."""
import asyncio
import os
import secrets
from pathlib import Path

from bson import ObjectId
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

from guardian_api.util import now_utc

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


async def main() -> None:
    uri = (os.environ.get("MONGO_URI") or "").strip()
    if not uri:
        print("NO MONGO_URI")
        return
    c = AsyncIOMotorClient(uri)
    db = c.get_default_database()
    if db is None:
        db = c["ticketdb"]
    g = ObjectId()
    p = ObjectId()
    # Match join(): unique index pairKey_1 requires a non-null pairKey on insert.
    test_key = f"TEST{secrets.token_hex(4).upper()}"
    r = await db.pairings.update_one(
        {"guardianId": g, "patientId": p},
        {
            "$set": {
                "guardianId": g,
                "patientId": p,
                "pairKey": test_key,
                "trackingStatus": "not_requested",
                "updatedAt": now_utc(),
            }
        },
        upsert=True,
    )
    print("ok", r.upserted_id, r.modified_count, r.matched_count)
    await db.pairings.delete_many({"guardianId": g})
    c.close()


if __name__ == "__main__":
    asyncio.run(main())
