"""WebSocket auth: `?token=<access JWT>` (apps) or the admin session cookie / `?admin=<session>` (Admin)."""
from __future__ import annotations

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware


@database_sync_to_async
def _principal(token: str | None, admin_token: str | None):
    from accounts.models import AdminSession, User
    from accounts.principal import Principal
    from accounts.tokens import decode_access, is_session_revoked
    from core.crypto import sha256

    if token:
        try:
            claims = decode_access(token)
        except Exception:  # noqa: BLE001
            return None
        if is_session_revoked(claims["sid"]):
            return None
        u = User.objects.select_related("rider").filter(id=claims["sub"], deleted_at__isnull=True, is_blocked=False).first()
        return Principal(kind="rider" if u and u.is_rider else "customer", user=u) if u else None
    if admin_token:
        s = AdminSession.objects.select_related("admin__role").filter(token_hash=sha256(admin_token)).first()
        if s and s.active and s.mfa_passed and s.admin.is_active:
            return Principal(kind="admin", admin=s.admin)
    return None


class TokenAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        qs = parse_qs(scope.get("query_string", b"").decode())
        cookies = {}
        for k, v in scope.get("headers", []):
            if k == b"cookie":
                for part in v.decode().split(";"):
                    if "=" in part:
                        a, b = part.strip().split("=", 1)
                        cookies[a] = b
        scope["principal"] = await _principal((qs.get("token") or [None])[0], (qs.get("admin") or [None])[0] or cookies.get("sw_admin"))
        return await super().__call__(scope, receive, send)
