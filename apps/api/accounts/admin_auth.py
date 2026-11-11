"""Admin authentication: argon2id password → mandatory TOTP (enrol on first login) → opaque cookie session."""
from __future__ import annotations

import secrets
from datetime import timedelta

import pyotp
from django.utils import timezone

from core import settings_service
from core.audit import audit, client_ip
from core.crypto import decrypt_secret, encrypt_secret, random_token, sha256
from core.exceptions import ApiError

from .models import AdminSession, AdminUser

MAX_FAILED = 5
LOCK_MINUTES = 15
REAUTH_WINDOW = timedelta(minutes=5)
ISSUER = "SmartWear Admin"


def create_session(admin: AdminUser, request, *, mfa_passed: bool) -> tuple[AdminSession, str]:
    hours = settings_service.get("auth").adminSessionHours
    token = random_token(32)
    s = AdminSession.objects.create(
        admin=admin, token_hash=sha256(token), mfa_passed=mfa_passed, ip=client_ip(request),
        user_agent=(request.headers.get("User-Agent") or "")[:300], expires_at=timezone.now() + timedelta(hours=hours),
    )
    return s, token


def password_login(email: str, password: str, request) -> tuple[AdminUser, AdminSession, str]:
    admin = AdminUser.objects.select_related("role").filter(email__iexact=(email or "").strip()).first()
    now = timezone.now()
    if admin and admin.locked_until and admin.locked_until > now:
        mins = int((admin.locked_until - now).total_seconds() // 60) + 1
        raise ApiError.too_many(f"Too many failed attempts. Try again in {mins} min.")
    if admin is None or not admin.is_active or not admin.check_password(password or ""):
        if admin:
            admin.failed_logins += 1
            if admin.failed_logins >= MAX_FAILED:
                admin.locked_until = now + timedelta(minutes=LOCK_MINUTES)
                admin.failed_logins = 0
            admin.save(update_fields=["failed_logins", "locked_until"])
            audit("admin.login.failed", "admin", admin.id, request=request, admin=admin)
        raise ApiError("Email or password is incorrect", status_code=401, code="invalid_credentials")
    admin.failed_logins = 0
    admin.locked_until = None
    admin.last_login = now
    admin.save(update_fields=["failed_logins", "locked_until", "last_login"])
    session, token = create_session(admin, request, mfa_passed=False)
    audit("admin.login.password", "admin", admin.id, request=request, admin=admin)
    return admin, session, token


def _secret(admin: AdminUser) -> str:
    return decrypt_secret(admin.totp_secret, settings_service.key_ring()) if admin.totp_secret else ""


def begin_enrolment(admin: AdminUser) -> dict:
    if admin.mfa_enabled:
        raise ApiError.conflict("mfa_enabled", "Two-factor authentication is already set up.")
    secret = pyotp.random_base32()
    admin.totp_secret = encrypt_secret(secret, settings_service.key_ring())
    admin.save(update_fields=["totp_secret"])
    uri = pyotp.TOTP(secret).provisioning_uri(name=admin.email, issuer_name=ISSUER)
    return {"secret": secret, "otpauthUrl": uri}


def _check_totp(admin: AdminUser, code: str) -> bool:
    secret = _secret(admin)
    if not secret:
        return False
    code = "".join(c for c in (code or "") if c.isdigit())
    if len(code) != 6:
        return False
    # Replay protection: each time-step can be used once.
    step = int(timezone.now().timestamp()) // 30
    key = f"sw:totp-used:{admin.id}:{code}"
    ok = pyotp.TOTP(secret).verify(code, valid_window=1)
    if ok:
        try:
            if not settings_service.redis_client().set(key, step, nx=True, ex=120):
                return False
        except Exception:  # noqa: BLE001
            pass
    return ok


def confirm_enrolment(admin: AdminUser, session: AdminSession, code: str, request) -> list[str]:
    if admin.mfa_enabled:
        raise ApiError.conflict("mfa_enabled", "Two-factor authentication is already set up.")
    if not _check_totp(admin, code):
        raise ApiError("That code isn't right. Check your authenticator app.", status_code=400, code="mfa_invalid")
    codes = [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(10)]
    admin.recovery_codes = [sha256(c) for c in codes]
    admin.totp_confirmed_at = timezone.now()
    admin.save(update_fields=["recovery_codes", "totp_confirmed_at"])
    session.mfa_passed = True
    session.reauth_at = timezone.now()
    session.save(update_fields=["mfa_passed", "reauth_at"])
    audit("admin.mfa.enrolled", "admin", admin.id, request=request, admin=admin)
    return codes


def verify_mfa(admin: AdminUser, session: AdminSession, code: str | None, recovery_code: str | None, request) -> None:
    from core import ratelimit

    ratelimit.enforce("admin:mfa", str(admin.id), 10, 900, "Too many attempts. Wait a few minutes.")
    if not admin.mfa_enabled:
        raise ApiError("Set up two-factor authentication first", status_code=400, code="mfa_setup_required")
    ok = False
    if recovery_code:
        h = sha256(recovery_code.strip().lower())
        if h in admin.recovery_codes:
            admin.recovery_codes = [c for c in admin.recovery_codes if c != h]
            admin.save(update_fields=["recovery_codes"])
            ok = True
    elif code:
        ok = _check_totp(admin, code)
    if not ok:
        audit("admin.mfa.failed", "admin", admin.id, request=request, admin=admin)
        raise ApiError("That code isn't right. Check your authenticator app.", status_code=400, code="mfa_invalid")
    session.mfa_passed = True
    session.reauth_at = timezone.now()
    session.save(update_fields=["mfa_passed", "reauth_at"])
    audit("admin.login.mfa", "admin", admin.id, request=request, admin=admin, meta={"recovery": bool(recovery_code)})


def reauthenticate(admin: AdminUser, session: AdminSession, *, password: str | None, code: str | None, request) -> None:
    ok = (password and admin.check_password(password)) or (code and _check_totp(admin, code))
    if not ok:
        raise ApiError("Confirmation failed", status_code=400, code="reauth_failed")
    session.reauth_at = timezone.now()
    session.save(update_fields=["reauth_at"])


def require_recent_reauth(session: AdminSession) -> None:
    if not session.reauth_at or timezone.now() - session.reauth_at > REAUTH_WINDOW:
        raise ApiError("Confirm your password or 2FA code to continue", status_code=403, code="reauth_required")
