"""Access JWTs (HS256, 15 min default) + opaque rotating refresh tokens."""
from __future__ import annotations

from datetime import timedelta

import jwt
from django.db import transaction
from django.utils import timezone

from core import settings_service
from core.audit import client_ip
from core.crypto import random_token, sha256
from core.exceptions import ApiError

from .models import Session, User

ISSUER = "smartwear"
AUDIENCE = "smartwear-app"
REVOKED_KEY = "sw:revoked-sid:{sid}"


def _secret() -> str:
    return settings_service.get("auth").jwtSecret


def issue_access(user: User, session: Session) -> tuple[str, int]:
    cfg = settings_service.get("auth")
    ttl = cfg.accessTokenTtlMinutes * 60
    now = timezone.now()
    role = "rider" if user.is_rider else "customer"
    token = jwt.encode(
        {"iss": ISSUER, "aud": AUDIENCE, "sub": str(user.id), "sid": str(session.id), "role": role, "iat": int(now.timestamp()), "exp": int(now.timestamp()) + ttl},
        _secret(),
        algorithm="HS256",
    )
    return token, ttl


def decode_access(token: str) -> dict:
    try:
        return jwt.decode(token, _secret(), algorithms=["HS256"], audience=AUDIENCE, issuer=ISSUER, options={"require": ["exp", "sub", "sid"]})
    except jwt.ExpiredSignatureError as e:
        raise ApiError("Session expired", status_code=401, code="token_expired") from e
    except jwt.InvalidTokenError as e:
        raise ApiError.unauthorized("Invalid access token") from e


def is_session_revoked(sid: str) -> bool:
    try:
        return bool(settings_service.redis_client().exists(REVOKED_KEY.format(sid=sid)))
    except Exception:  # noqa: BLE001
        return Session.objects.filter(id=sid, revoked_at__isnull=False).exists()


def _mark_revoked(session_ids: list[str]) -> None:
    ttl = settings_service.get("auth").accessTokenTtlMinutes * 60 + 60
    try:
        pipe = settings_service.redis_client().pipeline()
        for sid in session_ids:
            pipe.set(REVOKED_KEY.format(sid=sid), "1", ex=ttl)
        pipe.execute()
    except Exception:  # noqa: BLE001
        pass


def start_session(user: User, request, *, device_id: str = "", platform: str = "", app_version: str = "") -> dict:
    cfg = settings_service.get("auth")
    device_id = device_id or (getattr(request, "device_id", None) or "")
    # One live session per device: signing in again on the same device replaces the old one.
    if device_id:
        old = list(Session.objects.filter(user=user, device_id=device_id, revoked_at__isnull=True).values_list("id", flat=True))
        if old:
            Session.objects.filter(id__in=old).update(revoked_at=timezone.now(), revoke_reason="replaced")
            _mark_revoked([str(s) for s in old])
    refresh = random_token(32)
    session = Session.objects.create(
        user=user, refresh_hash=sha256(refresh), device_id=device_id[:128], platform=platform[:16], app_version=app_version[:24],
        ip=client_ip(request), user_agent=(request.headers.get("User-Agent") or "")[:300] if request else "",
        expires_at=timezone.now() + timedelta(days=cfg.refreshTokenTtlDays),
    )
    access, ttl = issue_access(user, session)
    return {"accessToken": access, "refreshToken": refresh, "expiresIn": ttl, "sessionId": str(session.id)}


ROTATION_GRACE = timedelta(minutes=2)


def _rotate(session: Session, user: User, request, *, keep_previous: bool = False) -> dict:
    """Issue a new refresh token for `session`. Expiry slides: active users never hit the absolute limit."""
    now = timezone.now()
    new_refresh = random_token(32)
    if not keep_previous:
        session.previous_hash = session.refresh_hash
        session.rotated_at = now
    session.refresh_hash = sha256(new_refresh)
    session.last_used_at = now
    session.expires_at = now + timedelta(days=settings_service.get("auth").refreshTokenTtlDays)
    session.ip = client_ip(request)
    session.save(update_fields=["previous_hash", "rotated_at", "refresh_hash", "last_used_at", "expires_at", "ip"])
    access, ttl = issue_access(user, session)
    return {"accessToken": access, "refreshToken": new_refresh, "expiresIn": ttl, "sessionId": str(session.id)}


def _check_usable(session: Session, request) -> User:
    user = session.user
    if user.is_blocked or user.deleted_at:
        raise ApiError("This account is not available", status_code=403, code="account_blocked")
    if not session.active:
        raise ApiError("Please sign in again", status_code=401, code="session_revoked" if session.revoked_at else "refresh_invalid")
    device = getattr(request, "device_id", None)
    if session.device_id and device and device != session.device_id:
        raise ApiError("Please sign in again", status_code=401, code="refresh_device_mismatch")
    return user


def rotate_refresh(refresh: str, request) -> tuple[User, dict]:
    """
    Rotate a refresh token. Outcomes the app relies on:
      200            new pair (expiry slides forward)
      401 refresh_invalid / session_revoked / refresh_device_mismatch   → the app signs out
      403            account blocked or deleted                         → the app signs out
    Re-presenting the *previous* token is accepted once more inside ROTATION_GRACE (app killed before it saved the
    new token); outside the window it is treated as theft and the whole family is revoked.
    """
    h = sha256(refresh)
    reused_family = None
    with transaction.atomic():
        session = Session.objects.select_for_update(of=("self",)).select_related("user").filter(refresh_hash=h).first()
        if session is not None:
            user = _check_usable(session, request)
            return user, _rotate(session, user, request)
        previous = Session.objects.select_for_update(of=("self",)).select_related("user").filter(previous_hash=h).first()
        if previous is not None:
            device = getattr(request, "device_id", None)
            in_grace = (
                previous.active
                and previous.rotated_at is not None
                and timezone.now() - previous.rotated_at <= ROTATION_GRACE
                and (not previous.device_id or not device or device == previous.device_id)
            )
            if in_grace:
                user = _check_usable(previous, request)
                return user, _rotate(previous, user, request, keep_previous=True)
            reused_family = previous.family
    if reused_family is not None:
        # A rotated-away token came back outside the grace window: assume it was stolen and end the whole family.
        ids = list(Session.objects.filter(family=reused_family, revoked_at__isnull=True).values_list("id", flat=True))
        Session.objects.filter(id__in=ids).update(revoked_at=timezone.now(), revoke_reason="refresh_reuse")
        _mark_revoked([str(i) for i in ids])
    raise ApiError("Please sign in again", status_code=401, code="refresh_invalid")


def _notify_revoked(user_id, session_ids: list[str], reason: str) -> None:
    """Tell the user's open apps at once (they re-check and sign out); sockets of those sessions are closed."""
    if not session_ids:
        return
    from notifications.realtime import broadcast

    def send():
        broadcast(f"user.{user_id}", {"type": "session.revoked", "sessionIds": session_ids, "reason": reason})

    transaction.on_commit(send)


def revoke_session(session_id: str, reason: str = "logout") -> None:
    user_id = Session.objects.filter(id=session_id, revoked_at__isnull=True).values_list("user_id", flat=True).first()
    Session.objects.filter(id=session_id, revoked_at__isnull=True).update(revoked_at=timezone.now(), revoke_reason=reason)
    _mark_revoked([session_id])
    if user_id and reason != "logout":  # the device that logged itself out already knows
        _notify_revoked(user_id, [str(session_id)], reason)


def revoke_all(user: User, reason: str = "logout_all", except_id: str | None = None) -> int:
    qs = Session.objects.filter(user=user, revoked_at__isnull=True)
    if except_id:
        qs = qs.exclude(id=except_id)
    ids = [str(i) for i in qs.values_list("id", flat=True)]
    qs.update(revoked_at=timezone.now(), revoke_reason=reason)
    _mark_revoked(ids)
    _notify_revoked(user.id, ids, reason)
    return len(ids)
