"""
Online / last-seen presence in Redis, fed by the realtime socket (connect, ping heartbeat, disconnect).

    sw:presence:user      zset  userId  → expiry (unix seconds)      customer apps online
    sw:presence:staff     zset  adminId → expiry                     support staff online
    sw:presence:seen      hash  "user:<id>" / "staff:<id>" → last seen (unix seconds)
    sw:viewing:<threadId> zset  "<side>:<id>" → expiry               who has the thread open (no push for them)

An entry is online while its expiry is in the future; every heartbeat pushes it forward, so a dropped
connection disappears on its own within TTL seconds even if disconnect never runs.
"""
from __future__ import annotations

import logging
import time
from datetime import UTC, datetime

from core.settings_service import redis_client

logger = logging.getLogger("smartwear.presence")
TTL = 70  # seconds; the app pings every 25 s
USER, STAFF, SEEN = "sw:presence:user", "sw:presence:staff", "sw:presence:seen"
VIEWING = "sw:viewing:{tid}"


def _now() -> float:
    return time.time()


def _iso(ts: float | None) -> str | None:
    return datetime.fromtimestamp(ts, UTC).isoformat() if ts else None


def touch(side: str, ident: str) -> bool:
    """Mark online (connect / heartbeat). Returns True when this made them come online."""
    key = STAFF if side == "staff" else USER
    try:
        r = redis_client()
        prev = r.zscore(key, ident)
        r.zadd(key, {ident: _now() + TTL})
        r.hset(SEEN, f"{side}:{ident}", int(_now()))
        return prev is None or prev < _now()
    except Exception as e:  # noqa: BLE001 - presence is best-effort
        logger.debug("presence touch failed: %s", e)
        return False


def leave(side: str, ident: str, *, still_connected: bool = False) -> bool:
    """Disconnect. Returns True when they went offline (no other socket of theirs is still open)."""
    if still_connected:
        return False
    key = STAFF if side == "staff" else USER
    try:
        r = redis_client()
        r.hset(SEEN, f"{side}:{ident}", int(_now()))
        return bool(r.zrem(key, ident))
    except Exception as e:  # noqa: BLE001
        logger.debug("presence leave failed: %s", e)
        return False


def is_online(side: str, ident: str) -> bool:
    try:
        exp = redis_client().zscore(STAFF if side == "staff" else USER, ident)
        return exp is not None and exp > _now()
    except Exception:  # noqa: BLE001
        return False


def staff_online() -> bool:
    try:
        return bool(redis_client().zcount(STAFF, _now(), "+inf"))
    except Exception:  # noqa: BLE001
        return False


def last_seen(side: str, ident: str | None = None) -> str | None:
    """Last seen time; for staff without an id, the most recent of any support agent."""
    try:
        r = redis_client()
        if side == "staff" and ident is None:
            best = max((float(v) for k, v in r.hgetall(SEEN).items() if k.startswith("staff:")), default=None)
            return _iso(best)
        v = r.hget(SEEN, f"{side}:{ident}")
        return _iso(float(v)) if v else None
    except Exception:  # noqa: BLE001
        return None


def presence_for(viewer: str, user_id) -> dict:
    """What the viewer sees about the other side: customers see SmartWear support, staff see the customer."""
    if viewer == "customer":
        online = staff_online()
        return {"online": online, "lastSeenAt": None if online else last_seen("staff")}
    online = is_online("user", str(user_id))
    return {"online": online, "lastSeenAt": None if online else last_seen("user", str(user_id))}


def set_viewing(thread_id: str, side: str, ident: str, on: bool) -> None:
    key = VIEWING.format(tid=thread_id)
    try:
        r = redis_client()
        if on:
            r.zadd(key, {f"{side}:{ident}": _now() + TTL})
            r.expire(key, TTL * 4)
        else:
            r.zrem(key, f"{side}:{ident}")
    except Exception as e:  # noqa: BLE001
        logger.debug("viewing update failed: %s", e)


def is_viewing(thread_id: str, side: str, ident: str | None = None) -> bool:
    """Is someone of this side looking at the thread right now (any staff when ident is None)?"""
    try:
        r = redis_client()
        key = VIEWING.format(tid=thread_id)
        if ident is not None:
            exp = r.zscore(key, f"{side}:{ident}")
            return exp is not None and exp > _now()
        return any(m.startswith(f"{side}:") for m in r.zrangebyscore(key, _now(), "+inf"))
    except Exception:  # noqa: BLE001
        return False
