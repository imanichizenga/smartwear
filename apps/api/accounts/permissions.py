from __future__ import annotations

from rest_framework.permissions import BasePermission

from core.exceptions import ApiError


def _principal(request):
    p = getattr(request, "user", None)
    return p if p is not None and getattr(p, "kind", None) else None


class IsAppUser(BasePermission):
    """Any signed-in customer or rider."""

    def has_permission(self, request, view):
        p = _principal(request)
        if p is None or p.kind not in ("customer", "rider"):
            raise ApiError.unauthorized("Sign in to continue")
        return True


class IsRider(BasePermission):
    def has_permission(self, request, view):
        p = _principal(request)
        if p is None or p.kind not in ("customer", "rider"):
            raise ApiError.unauthorized("Sign in to continue")
        if p.kind != "rider":
            raise ApiError.forbidden("Rider Mode is only for registered riders")
        return True


class IsAdmin(BasePermission):
    """Signed-in admin who has passed 2FA. Views may set `allow_pending_mfa = True` for the 2FA endpoints."""

    def has_permission(self, request, view):
        p = _principal(request)
        if p is None or p.kind != "admin":
            raise ApiError.unauthorized("Admin sign-in required")
        if not p.mfa_passed and not getattr(view, "allow_pending_mfa", False):
            raise ApiError("Two-factor verification required", status_code=401, code="mfa_required")
        return True


def AdminPerm(*perms: str) -> type[BasePermission]:  # noqa: N802 - reads like a class at call sites
    """`permission_classes = [AdminPerm("orders.manage")]` — every listed permission is required."""

    class _P(IsAdmin):
        def has_permission(self, request, view):
            super().has_permission(request, view)
            admin = request.user.admin
            missing = [x for x in perms if not admin.has_perm_key(x)]
            if missing:
                raise ApiError.forbidden(f"Your role does not allow this ({', '.join(missing)})")
            return True

    _P.__name__ = "AdminPerm_" + "_".join(p.replace(".", "_") for p in perms)
    return _P


def require_perm(request, perm: str) -> None:
    p = _principal(request)
    if p is None or p.kind != "admin" or not p.admin.has_perm_key(perm):
        raise ApiError.forbidden(f"Your role does not allow this ({perm})")
