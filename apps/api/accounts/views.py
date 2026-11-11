from __future__ import annotations

from datetime import timedelta

from django.conf import settings as dj
from django.db import transaction
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core import ratelimit, settings_service
from core.audit import audit, client_ip
from core.crypto import random_token, sha256
from core.exceptions import ApiError

from . import admin_auth, google, otp, services, tokens
from .authentication import ADMIN_COOKIE
from .models import AdminInvite, AdminSession, AdminUser, Role, Session, User
from .permissions import AdminPerm, IsAdmin, IsAppUser
from .serializers import (
    AcceptInviteIn, AdminBootstrapIn, AdminCodeIn, AdminLoginIn, AdminReauthIn, GoogleIn, InviteIn, ProfileIn, RefreshIn,
    RequestOtpIn, StyleProfileIn, VerifyOtpIn, admin_out, user_out,
)


def _valid(serializer_cls, request):
    s = serializer_cls(data=request.data)
    s.is_valid(raise_exception=True)
    return s.validated_data


def _session_payload(user: User, request, data: dict, is_new: bool) -> dict:
    tok = tokens.start_session(user, request, device_id=data.get("deviceId") or "", platform=data.get("platform") or "", app_version=data.get("appVersion") or "")
    user.last_seen_at = timezone.now()
    user.save(update_fields=["last_seen_at"])
    cfg = settings_service.get("features")
    return {
        **tok,
        "user": user_out(user),
        "isNewUser": is_new,
        "next": "style_quiz" if (is_new and cfg.styleQuiz and not user.quiz_completed_at and not user.is_rider) else ("rider_home" if user.is_rider else "home"),
    }


# ---------------------------------------------------------------- customer / rider auth
class OtpRequestView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        d = _valid(RequestOtpIn, request)
        return Response(otp.request_code(d["phone"], request))


class OtpVerifyView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        d = _valid(VerifyOtpIn, request)
        ch = otp.verify_code(d["phone"], d["code"], request)
        user, is_new = services.login_with_phone(ch.phone)
        if user.is_blocked:
            raise ApiError.forbidden("This account has been blocked. Contact support for help.")
        audit("auth.login.phone", "user", user.id, request=request, user=user, meta={"new": is_new})
        return Response(_session_payload(user, request, d, is_new))


class GoogleLoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        d = _valid(GoogleIn, request)
        ratelimit.enforce("auth:google:ip", client_ip(request) or "", 30, 600)
        claims = google.verify_id_token(d["idToken"])
        user, is_new = services.login_with_google(claims)
        if user.is_blocked:
            raise ApiError.forbidden("This account has been blocked. Contact support for help.")
        audit("auth.login.google", "user", user.id, request=request, user=user, meta={"new": is_new})
        payload = _session_payload(user, request, d, is_new)
        payload["phoneRequiredAtCheckout"] = settings_service.get("auth").requirePhoneForCheckout and not user.phone_verified_at
        return Response(payload)


class RefreshView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        d = _valid(RefreshIn, request)
        ratelimit.enforce("auth:refresh:ip", client_ip(request) or "", 120, 600)
        user, tok = tokens.rotate_refresh(d["refreshToken"], request)
        return Response({**tok, "user": user_out(user)})


class LogoutView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request):
        if request.data.get("all"):
            tokens.revoke_all(request.user.user)
        else:
            tokens.revoke_session(request.user.session_id)
        return Response({"ok": True})


class MeView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request):
        return Response(user_out(request.user.user))

    def patch(self, request):
        d = _valid(ProfileIn, request)
        u: User = request.user.user
        m = {"name": "name", "email": "email", "locale": "locale", "theme": "theme", "notificationPrefs": "notification_prefs"}
        for k, field in m.items():
            if k in d:
                setattr(u, field, d[k])
        for k, field in (("avatarMediaId", "avatar_id"), ("coverMediaId", "cover_id")):
            if k in d:
                if d[k] is not None:
                    from media.models import Media

                    if not Media.objects.filter(id=d[k], owner_user=u).exists():
                        raise ApiError.bad_request("Upload the image first")
                setattr(u, field, d[k])
        u.save()
        return Response(user_out(u))

    def delete(self, request):
        services.delete_account(request.user.user, request)
        return Response({"ok": True})


class StyleProfileView(APIView):
    permission_classes = [IsAppUser]

    def put(self, request):
        d = _valid(StyleProfileIn, request)
        u: User = request.user.user
        done = d.pop("quizCompleted", None)
        u.style_profile = {**(u.style_profile or {}), **d}
        if done and not u.quiz_completed_at:
            u.quiz_completed_at = timezone.now()
        u.save(update_fields=["style_profile", "quiz_completed_at"])
        return Response(user_out(u))


class SessionsView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request):
        rows = Session.objects.filter(user=request.user.user, revoked_at__isnull=True, expires_at__gt=timezone.now()).order_by("-last_used_at")
        return Response({"items": [{"id": str(s.id), "platform": s.platform, "appVersion": s.app_version, "lastUsedAt": s.last_used_at.isoformat(), "createdAt": s.created_at.isoformat(), "current": str(s.id) == request.user.session_id} for s in rows]})

    def delete(self, request, session_id=None):
        if not Session.objects.filter(id=session_id, user=request.user.user).exists():
            raise ApiError.not_found("Session")
        tokens.revoke_session(str(session_id), "user_revoked")
        return Response({"ok": True})


class LinkPhoneRequestView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request):
        d = _valid(RequestOtpIn, request)
        return Response(otp.request_code(d["phone"], request, purpose="link_phone", for_user=request.user.user))


class LinkPhoneVerifyView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request):
        d = _valid(VerifyOtpIn, request)
        ch = otp.verify_code(d["phone"], d["code"], request, purpose="link_phone")
        if ch.for_user_id and ch.for_user_id != request.user.user.id:
            raise ApiError.forbidden("This code was requested by another account")
        result = services.link_identity(request.user.user, "phone", ch.phone, request=request)
        user = User.objects.get(id=result.get("userId") or request.user.user.id)
        return Response({**result, "user": user_out(user)})


class LinkGoogleView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request):
        d = _valid(GoogleIn, request)
        claims = google.verify_id_token(d["idToken"])
        result = services.link_identity(request.user.user, "google", claims["sub"], email=claims.get("email"), request=request)
        user = User.objects.get(id=result.get("userId") or request.user.user.id)
        return Response({**result, "user": user_out(user)})


class DataExportView(APIView):
    """GDPR-style export of everything we hold about the signed-in user."""

    permission_classes = [IsAppUser]

    def get(self, request):
        from .export import export_user

        ratelimit.enforce("export", str(request.user.user.id), 3, 3600)
        return Response(export_user(request.user.user))


# ---------------------------------------------------------------- admin auth
def _set_admin_cookie(resp: Response, token: str, hours: int) -> None:
    resp.set_cookie(ADMIN_COOKIE, token, max_age=hours * 3600, httponly=True, secure=not dj.DEBUG, samesite="Lax", path="/")


class AdminLoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request):
        d = _valid(AdminLoginIn, request)
        ratelimit.enforce("admin:login:ip", client_ip(request) or "", 20, 900, "Too many sign-in attempts. Wait a few minutes.")
        admin, _session, token = admin_auth.password_login(d["email"], d["password"], request)
        resp = Response({"admin": admin_out(admin), "mfa": "verify" if admin.mfa_enabled else "setup", "sessionToken": token})
        _set_admin_cookie(resp, token, settings_service.get("auth").adminSessionHours)
        return resp


class AdminBootstrapView(APIView):
    """First run only: create the Super Admin when no admin exists yet."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        return Response({"needsBootstrap": not AdminUser.objects.exists()})

    def post(self, request):
        d = _valid(AdminBootstrapIn, request)
        ratelimit.enforce("admin:bootstrap", client_ip(request) or "", 5, 3600)
        from .rbac import ensure_roles

        with transaction.atomic():
            if AdminUser.objects.select_for_update().exists():
                raise ApiError.forbidden("Setup is already complete. Sign in instead.")
            ensure_roles()
            admin = AdminUser.objects.create_user(d["email"], d["password"], name=d["name"], role=Role.objects.get(key="SUPER_ADMIN"), password_changed_at=timezone.now())
        _s, token = admin_auth.create_session(admin, request, mfa_passed=False)
        audit("admin.bootstrap", "admin", admin.id, request=request, admin=admin)
        resp = Response({"admin": admin_out(admin), "mfa": "setup", "sessionToken": token}, status=201)
        _set_admin_cookie(resp, token, settings_service.get("auth").adminSessionHours)
        return resp


class AdminAcceptInviteView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        inv = AdminInvite.objects.select_related("role").filter(token_hash=sha256(request.query_params.get("token", "")), accepted_at__isnull=True, revoked_at__isnull=True, expires_at__gt=timezone.now()).first()
        if not inv:
            raise ApiError.not_found("Invite")
        return Response({"email": inv.email, "name": inv.name, "role": inv.role.name})

    def post(self, request):
        d = _valid(AcceptInviteIn, request)
        with transaction.atomic():
            inv = AdminInvite.objects.select_for_update().select_related("role").filter(token_hash=sha256(d["token"]), accepted_at__isnull=True, revoked_at__isnull=True, expires_at__gt=timezone.now()).first()
            if not inv:
                raise ApiError.not_found("Invite")
            if AdminUser.objects.filter(email__iexact=inv.email).exists():
                raise ApiError.conflict("admin_exists", "An admin with this email already exists.")
            admin = AdminUser.objects.create_user(inv.email, d["password"], name=d["name"], role=inv.role, password_changed_at=timezone.now())
            inv.accepted_at = timezone.now()
            inv.save(update_fields=["accepted_at"])
        _s, token = admin_auth.create_session(admin, request, mfa_passed=False)
        audit("admin.invite.accepted", "admin", admin.id, request=request, admin=admin)
        resp = Response({"admin": admin_out(admin), "mfa": "setup", "sessionToken": token}, status=201)
        _set_admin_cookie(resp, token, settings_service.get("auth").adminSessionHours)
        return resp


class AdminMfaSetupView(APIView):
    permission_classes = [IsAdmin]
    allow_pending_mfa = True

    def post(self, request):
        return Response(admin_auth.begin_enrolment(request.user.admin))


class AdminMfaConfirmView(APIView):
    permission_classes = [IsAdmin]
    allow_pending_mfa = True

    def post(self, request):
        d = _valid(AdminCodeIn, request)
        codes = admin_auth.confirm_enrolment(request.user.admin, request._request.admin_session, d.get("code") or "", request)
        return Response({"recoveryCodes": codes, "admin": admin_out(request.user.admin)})


class AdminMfaVerifyView(APIView):
    permission_classes = [IsAdmin]
    allow_pending_mfa = True

    def post(self, request):
        d = _valid(AdminCodeIn, request)
        admin_auth.verify_mfa(request.user.admin, request._request.admin_session, d.get("code"), d.get("recoveryCode"), request)
        return Response({"ok": True, "admin": admin_out(request.user.admin)})


class AdminReauthView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request):
        d = _valid(AdminReauthIn, request)
        admin_auth.reauthenticate(request.user.admin, request._request.admin_session, password=d.get("password"), code=d.get("code"), request=request)
        return Response({"ok": True, "validForSeconds": int(admin_auth.REAUTH_WINDOW.total_seconds())})


class AdminMeView(APIView):
    permission_classes = [IsAdmin]
    allow_pending_mfa = True

    def get(self, request):
        s = request._request.admin_session
        return Response({"admin": admin_out(request.user.admin), "mfaPassed": s.mfa_passed, "sessionExpiresAt": s.expires_at.isoformat()})


class AdminLogoutView(APIView):
    permission_classes = [IsAdmin]
    allow_pending_mfa = True

    def post(self, request):
        s = request._request.admin_session
        s.revoked_at = timezone.now()
        s.save(update_fields=["revoked_at"])
        resp = Response({"ok": True})
        resp.delete_cookie(ADMIN_COOKIE, path="/")
        return resp


class AdminSessionsView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        current = request._request.admin_session.id
        rows = AdminSession.objects.filter(admin=request.user.admin, revoked_at__isnull=True, expires_at__gt=timezone.now()).order_by("-last_seen_at")
        return Response({"items": [{"id": str(s.id), "ip": s.ip, "userAgent": s.user_agent, "createdAt": s.created_at.isoformat(), "lastSeenAt": s.last_seen_at.isoformat(), "current": s.id == current} for s in rows]})

    def delete(self, request, session_id=None):
        n = AdminSession.objects.filter(admin=request.user.admin, id=session_id, revoked_at__isnull=True).update(revoked_at=timezone.now())
        if not n:
            raise ApiError.not_found("Session")
        return Response({"ok": True})


# ---------------------------------------------------------------- team & roles
class TeamView(APIView):
    permission_classes = [AdminPerm("team.manage")]

    def get(self, request):
        admins = AdminUser.objects.select_related("role").order_by("name", "email")
        invites = AdminInvite.objects.select_related("role").filter(accepted_at__isnull=True, revoked_at__isnull=True, expires_at__gt=timezone.now())
        roles = Role.objects.order_by("id")
        return Response({
            "admins": [admin_out(a) for a in admins],
            "invites": [{"id": i.id, "email": i.email, "name": i.name, "role": i.role.name, "expiresAt": i.expires_at.isoformat()} for i in invites],
            "roles": [{"key": r.key, "name": r.name, "description": r.description, "permissions": r.permissions} for r in roles],
        })


class TeamInviteView(APIView):
    permission_classes = [AdminPerm("team.manage")]

    def post(self, request):
        d = _valid(InviteIn, request)
        role = Role.objects.filter(key=d["roleKey"]).first()
        if not role:
            raise ApiError.bad_request("Unknown role")
        if AdminUser.objects.filter(email__iexact=d["email"]).exists():
            raise ApiError.conflict("admin_exists", "That person already has an admin account.")
        token = random_token(32)
        inv = AdminInvite.objects.create(email=d["email"].lower(), name=d.get("name", ""), role=role, token_hash=sha256(token), invited_by=request.user.admin, expires_at=timezone.now() + timedelta(days=7))
        audit("team.invite", "admin_invite", inv.id, request=request, after={"email": inv.email, "role": role.key})
        base = (settings_service.get("branding").adminUrl or "").rstrip("/")
        return Response({"id": inv.id, "inviteUrl": f"{base}/accept-invite?token={token}", "token": token, "expiresAt": inv.expires_at.isoformat()}, status=201)


class TeamMemberView(APIView):
    permission_classes = [AdminPerm("team.manage")]

    def patch(self, request, admin_id=None):
        a = AdminUser.objects.select_related("role").filter(id=admin_id).first()
        if not a:
            raise ApiError.not_found("Admin")
        before = admin_out(a)
        if "roleKey" in request.data:
            role = Role.objects.filter(key=request.data["roleKey"]).first()
            if not role:
                raise ApiError.bad_request("Unknown role")
            if a.is_super_admin and role.key != "SUPER_ADMIN" and AdminUser.objects.filter(role__key="SUPER_ADMIN", is_active=True).count() <= 1:
                raise ApiError.conflict("last_super_admin", "Keep at least one active Super Admin.")
            a.role = role
        if "isActive" in request.data:
            if a.id == request.user.admin.id and not request.data["isActive"]:
                raise ApiError.bad_request("You cannot deactivate yourself")
            a.is_active = bool(request.data["isActive"])
            if not a.is_active:
                AdminSession.objects.filter(admin=a, revoked_at__isnull=True).update(revoked_at=timezone.now())
        if request.data.get("resetMfa"):
            a.totp_secret, a.totp_confirmed_at, a.recovery_codes = "", None, []
            AdminSession.objects.filter(admin=a, revoked_at__isnull=True).update(revoked_at=timezone.now())
        a.save()
        audit("team.update", "admin", a.id, request=request, before=before, after=admin_out(a))
        return Response(admin_out(a))
