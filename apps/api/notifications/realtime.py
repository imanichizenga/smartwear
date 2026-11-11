"""
Realtime fan-out over Django Channels (Redis layer, horizontally scalable).
Groups: order.<id> · rider.<riderId> · user.<userId> · dispatch · media · thread.<id>
"""
from __future__ import annotations

import logging
import re

from asgiref.sync import async_to_sync

logger = logging.getLogger("smartwear.realtime")
_SAFE = re.compile(r"[^A-Za-z0-9._-]")


def group_name(name: str) -> str:
    return _SAFE.sub("-", name)[:99]


def broadcast(group: str, event: dict) -> None:
    try:
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(group_name(group), {"type": "sw.event", "event": event})
    except Exception as e:  # noqa: BLE001 - realtime is best-effort; state lives in the DB
        logger.warning("broadcast to %s failed: %s", group, e)
