from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("smartwear.audit")


def client_ip(request) -> str | None:
    if request is None:
        return None
    req = getattr(request, "_request", request)
    fwd = req.META.get("HTTP_X_FORWARDED_FOR")
    return (fwd.split(",")[0].strip() if fwd else req.META.get("REMOTE_ADDR")) or None


def audit(action: str, entity_type: str, entity_id: Any = "", *, request=None, admin=None, user=None, before=None, after=None, meta: dict | None = None, actor_type: str | None = None):
    from .models import AuditLog

    if request is not None and admin is None and user is None:
        principal = getattr(request, "principal", None)
        if principal is not None:
            if principal.kind == "admin":
                admin = principal.admin
            else:
                user = principal.user
    kind = actor_type or ("admin" if admin else ("rider" if user is not None and getattr(user, "is_rider", False) else ("customer" if user else "system")))
    return AuditLog.objects.create(
        actor_type=kind,
        actor_admin=admin,
        actor_user=user,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id or ""),
        before=before,
        after=after,
        meta=meta or {},
        ip=client_ip(request),
        request_id=getattr(getattr(request, "_request", request), "request_id", "") or "",
    )
