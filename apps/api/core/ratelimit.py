"""Redis fixed-window rate limiting. Fails open (logged) if Redis is unavailable — auth endpoints also have DB-backed limits."""
from __future__ import annotations

import logging

from .exceptions import ApiError
from .settings_service import redis_client

logger = logging.getLogger("smartwear.ratelimit")


def hit(bucket: str, identity: str, limit: int, window_seconds: int) -> tuple[bool, int, int]:
    """Returns (allowed, remaining, retry_after_seconds)."""
    if not identity:
        return True, limit, 0
    key = f"sw:rl:{bucket}:{identity}"
    try:
        r = redis_client()
        pipe = r.pipeline()
        pipe.incr(key)
        pipe.ttl(key)
        count, ttl = pipe.execute()
        if ttl < 0:
            r.expire(key, window_seconds)
            ttl = window_seconds
        return count <= limit, max(0, limit - count), ttl if count > limit else 0
    except Exception as e:  # noqa: BLE001
        logger.warning("rate limit check failed open: %s", e)
        return True, limit, 0


def enforce(bucket: str, identity: str, limit: int, window_seconds: int, message: str | None = None) -> None:
    ok, _remaining, retry = hit(bucket, identity, limit, window_seconds)
    if not ok:
        raise ApiError.too_many(message or "Too many requests. Please slow down.", details={"retryAfterSeconds": retry})


def reset(bucket: str, identity: str) -> None:
    try:
        redis_client().delete(f"sw:rl:{bucket}:{identity}")
    except Exception:  # noqa: BLE001
        pass
