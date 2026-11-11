from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from rest_framework.authentication import BaseAuthentication

from core.crypto import sha256
from core.exceptions import ApiError

from .principal import Principal

ADMIN_COOKIE = "sw_admin"


class BearerJWTAuthentication(BaseAuthentication):
    """Customer and rider apps: `Authorization: Bearer <access JWT>`."""

    def authenticate(self, request):
        header = request.headers.get("Authorization") or ""
        if not header.startswith("Bearer "):
            return None
        from .models import User
        from .tokens import decode_access, is_session_revoked

        claims = decode_access(header[7:].strip())
        if is_session_revoked(claims["sid"]):
            raise ApiError("Please sign in again", status_code=401, code="session_revoked")
        user = User.objects.select_related("rider").filter(id=claims["sub"], deleted_at__isnull=True).first()
        if user is None:
            raise ApiError.unauthorized("Account not found")
        if user.is_blocked:
            raise ApiError.forbidden("This account has been blocked. Contact support for help.")
        principal = Principal(kind="rider" if user.is_rider else "customer", user=user, session_id=claims["sid"])
        request._request.principal = principal
        return (principal, claims)

    def authenticate_header(self, request):
        return 'Bearer realm="smartwear"'


class AdminCookieAuthentication(BaseAuthentication):
    """Admin web: opaque session token in an httpOnly cookie (or `X-Admin-Session` for server-to-server calls from Next.js)."""

    SAFE = {"GET", "HEAD", "OPTIONS"}

    def authenticate(self, request):
        token = request.COOKIES.get(ADMIN_COOKIE) or request.headers.get("X-Admin-Session")
        if not token:
            return None
        from .models import AdminSession

        s = AdminSession.objects.select_related("admin", "admin__role").filter(token_hash=sha256(token)).first()
        if s is None or not s.active or not s.admin.is_active:
            raise ApiError("Your admin session has ended. Please sign in again.", status_code=401, code="admin_session_invalid")
        # CSRF: cookie-authenticated unsafe requests must carry the custom header (SameSite=Lax + header check).
        if request.method not in self.SAFE and request.COOKIES.get(ADMIN_COOKIE) and request.headers.get("X-Requested-With") != "SmartWearAdmin":
            raise ApiError.forbidden("Missing CSRF header")
        now = timezone.now()
        if now - s.last_seen_at > timedelta(seconds=60):
            AdminSession.objects.filter(pk=s.pk).update(last_seen_at=now)
        principal = Principal(kind="admin", admin=s.admin, session_id=str(s.id), mfa_passed=s.mfa_passed)
        request._request.principal = principal
        request._request.admin_session = s
        return (principal, s)
