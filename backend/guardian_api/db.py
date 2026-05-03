from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


def connect(uri: str) -> AsyncIOMotorDatabase:
    global _client, _db
    if not uri:
        raise RuntimeError("MONGO_URI is required")
    _client = AsyncIOMotorClient(uri)
    _db = _client.get_default_database()
    if _db is None:
        _db = _client["ticketdb"]
    return _db


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Dementia Guardian database is not connected. "
                "Set MONGO_URI in backend/.env (MongoDB Atlas or local) and restart the server."
            ),
        )
    return _db


async def ping_database() -> None:
    """Runs on startup; triggers SRV/DNS and server selection so bad MONGO_URI fails immediately."""
    if _db is None:
        return
    await _db.command("ping")


async def disconnect() -> None:
    global _client, _db
    if _client:
        _client.close()
    _client = None
    _db = None
