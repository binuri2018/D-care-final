import re
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from jwt.exceptions import InvalidTokenError

from .config import Settings


def hash_password(settings: Settings, plain: str) -> str:
    salt = bcrypt.gensalt(rounds=settings.bcrypt_rounds)
    return bcrypt.hashpw(plain.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def _expires_delta(expires_in: str) -> timedelta:
    m = re.match(r"^(\d+)([dhms])$", expires_in.strip().lower())
    if not m:
        return timedelta(days=7)
    n, u = int(m.group(1)), m.group(2)
    if u == "d":
        return timedelta(days=n)
    if u == "h":
        return timedelta(hours=n)
    if u == "m":
        return timedelta(minutes=n)
    return timedelta(seconds=n)


def create_token(settings: Settings, user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    exp = now + _expires_delta(settings.jwt_expires_in)
    payload = {"sub": user_id, "role": role, "iat": now, "exp": exp}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(settings: Settings, token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


def safe_decode(settings: Settings, token: str) -> dict | None:
    try:
        return decode_token(settings, token)
    except InvalidTokenError:
        return None
