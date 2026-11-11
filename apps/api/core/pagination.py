"""Keyset (cursor) pagination: stable under inserts, O(1) per page, no OFFSET scans."""
from __future__ import annotations

import base64
import json
from collections.abc import Callable, Iterable
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from django.db.models import Q, QuerySet

from .exceptions import ApiError


def _enc(v: Any) -> Any:
    if isinstance(v, datetime):
        return {"t": v.isoformat()}
    if isinstance(v, UUID):
        return str(v)
    if isinstance(v, Decimal):
        return str(v)
    return v


def _dec(v: Any) -> Any:
    if isinstance(v, dict) and "t" in v:
        return datetime.fromisoformat(v["t"])
    return v


def encode_cursor(values: list[Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps([_enc(v) for v in values]).encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> list[Any]:
    try:
        pad = "=" * (-len(cursor) % 4)
        return [_dec(v) for v in json.loads(base64.urlsafe_b64decode(cursor + pad))]
    except Exception as e:  # noqa: BLE001
        raise ApiError.bad_request("Invalid cursor") from e


def _field_value(obj: Any, field: str) -> Any:
    cur = obj
    for part in field.split("__"):
        cur = getattr(cur, part)
    return cur


def keyset(qs: QuerySet, ordering: Iterable[str], cursor: str | None, limit: int) -> tuple[list[Any], str | None]:
    order = list(ordering)
    if not any(o.lstrip("-") in ("id", "pk") for o in order):
        order.append("-id" if order and order[0].startswith("-") else "id")
    qs = qs.order_by(*order)
    if cursor:
        values = decode_cursor(cursor)
        if len(values) != len(order):
            raise ApiError.bad_request("Invalid cursor")
        cond = Q()
        for i, o in enumerate(order):
            field = o.lstrip("-")
            op = "lt" if o.startswith("-") else "gt"
            part = Q(**{f"{field}__{op}": values[i]})
            for j in range(i):
                part &= Q(**{order[j].lstrip("-"): values[j]})
            cond |= part
        qs = qs.filter(cond)
    rows = list(qs[: limit + 1])
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = encode_cursor([_field_value(rows[-1], o.lstrip("-")) for o in order]) if has_more and rows else None
    return rows, next_cursor


def page_params(request, default: int = 24, maximum: int = 100) -> tuple[str | None, int]:
    q = request.query_params
    try:
        limit = int(q.get("limit", default))
    except ValueError as e:
        raise ApiError.bad_request("limit must be a number") from e
    return q.get("cursor") or None, max(1, min(maximum, limit))


def page(items: list[Any], next_cursor: str | None, render: Callable[[Any], Any], **extra: Any) -> dict[str, Any]:
    return {"items": [render(i) for i in items], "nextCursor": next_cursor, **extra}
