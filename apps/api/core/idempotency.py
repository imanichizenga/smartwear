"""Idempotency-Key support for order creation and payments: same key + same body → same response."""
from __future__ import annotations

import hashlib
import json
from collections.abc import Callable

from django.db import IntegrityError, transaction
from rest_framework.response import Response

from .exceptions import ApiError
from .models import IdempotencyKey


def idempotent(request, scope: str, owner: str, fn: Callable[[], Response]) -> Response:
    key = request.headers.get("Idempotency-Key")
    if not key:
        return fn()
    if len(key) > 128:
        raise ApiError.bad_request("Idempotency-Key is too long")
    body_hash = hashlib.sha256(json.dumps(request.data, sort_keys=True, default=str).encode()).hexdigest()
    try:
        with transaction.atomic():
            rec = IdempotencyKey.objects.create(key=key, scope=scope, owner=owner, request_hash=body_hash)
    except IntegrityError:
        rec = IdempotencyKey.objects.get(key=key, scope=scope, owner=owner)
        if rec.request_hash != body_hash:
            raise ApiError.conflict("idempotency_mismatch", "This Idempotency-Key was used with a different request.") from None
        if rec.status_code is None:
            raise ApiError.conflict("idempotency_in_progress", "The original request is still being processed.")
        resp = Response(rec.response, status=rec.status_code)
        resp["Idempotent-Replay"] = "true"
        return resp
    try:
        resp = fn()
    except Exception:
        rec.delete()
        raise
    if resp.status_code < 500:
        rec.status_code = resp.status_code
        rec.response = resp.data
        rec.save(update_fields=["status_code", "response"])
    else:
        rec.delete()
    return resp
