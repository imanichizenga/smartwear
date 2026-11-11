"""
Phone OTP via Beem — two modes:
  beem_sms  code generated here, argon2id-hashed, sent with the SMS API using the DB template (+ Android app hash)
  beem_otp  Beem's OTP API generates/verifies; we keep only the pinId
Limits: per phone / device / IP per hour, resend cooldown, max attempts per code, automatic temporary block for abuse.
"""
from __future__ import annotations

import logging
import secrets
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from core import ratelimit, settings_service
from core.audit import audit, client_ip
from core.exceptions import ApiError
from core.integrations.beem import BeemClient, render_template

from .models import BlockedPhone, OtpChallenge
from .phone import mask_phone, normalize_phone

logger = logging.getLogger("smartwear.otp")
# Codes are short-lived and attempt-limited, so moderate argon2id cost keeps verification fast.
_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
AUTO_BLOCK_AFTER_FAILED_CODES = 4  # codes that hit max attempts within 24h
AUTO_BLOCK_HOURS = 24


def _is_blocked(phone: str) -> bool:
    now = timezone.now()
    return BlockedPhone.objects.filter(phone=phone).filter(Q(until__isnull=True) | Q(until__gt=now)).exists()


def request_code(raw_phone: str, request, purpose: str = "login", for_user=None) -> dict:
    cfg = settings_service.get("auth")
    beem_cfg = settings_service.get("sms.beem")
    phone = normalize_phone(raw_phone)
    ip = client_ip(request) or ""
    device = getattr(request, "device_id", None) or ""
    if _is_blocked(phone):
        raise ApiError.forbidden("This number can't receive codes right now. Contact support if you need help.")

    last = OtpChallenge.objects.filter(phone=phone).order_by("-created_at").first()
    now = timezone.now()
    if last and (now - last.created_at).total_seconds() < cfg.otpResendCooldownSeconds:
        wait = cfg.otpResendCooldownSeconds - int((now - last.created_at).total_seconds())
        raise ApiError.too_many(f"Please wait {wait}s before requesting another code.", details={"retryAfterSeconds": wait})
    ratelimit.enforce("otp:phone", phone, cfg.otpMaxPerPhonePerHour, 3600, "Too many codes for this number. Try again later.")
    ratelimit.enforce("otp:ip", ip, cfg.otpMaxPerIpPerHour, 3600)
    ratelimit.enforce("otp:device", device, cfg.otpMaxPerDevicePerHour, 3600)
    # DB-backed limit too, so a Redis outage never opens the floodgates.
    hour_ago = now - timedelta(hours=1)
    if OtpChallenge.objects.filter(phone=phone, created_at__gte=hour_ago).count() >= cfg.otpMaxPerPhonePerHour:
        raise ApiError.too_many("Too many codes for this number. Try again later.")

    client = BeemClient(beem_cfg)
    mode = beem_cfg.otpMode
    expires = now + timedelta(minutes=cfg.otpExpiryMinutes)
    with transaction.atomic():
        OtpChallenge.objects.filter(phone=phone, verified_at__isnull=True, invalidated_at__isnull=True).update(invalidated_at=now)
        ch = OtpChallenge(phone=phone, purpose=purpose, mode=mode, attempts=0, max_attempts=cfg.otpMaxAttempts, expires_at=expires, ip=ip or None, device_id=device[:128], for_user=for_user)
        if mode == "beem_otp":
            ch.provider_ref = client.otp_request(phone)
        else:
            code = "".join(str(secrets.randbelow(10)) for _ in range(cfg.otpLength))
            ch.code_hash = _hasher.hash(code)
            message = render_template(beem_cfg.otpTemplate, code=code, minutes=cfg.otpExpiryMinutes, appHash=beem_cfg.androidAppHash or "")
            result = client.send_sms([phone], message)
            if not result.ok:
                raise ApiError.upstream("Beem", f"SMS not accepted: {result.message}", details={"code": result.code})
            ch.sms_request_id = result.request_id or ""
        ch.save()
    audit("auth.otp.request", "otp", ch.id, request=request, meta={"phone": mask_phone(phone), "mode": mode, "purpose": purpose}, actor_type="system")
    return {
        "challengeId": str(ch.id),
        "phone": phone,
        "maskedPhone": mask_phone(phone),
        "expiresAt": expires.isoformat(),
        "resendInSeconds": cfg.otpResendCooldownSeconds,
        "codeLength": cfg.otpLength if mode == "beem_sms" else None,
    }


def verify_code(raw_phone: str, code: str, request, purpose: str = "login") -> OtpChallenge:
    phone = normalize_phone(raw_phone)
    code = "".join(ch for ch in (code or "") if ch.isdigit())
    if not code:
        raise ApiError.bad_request("Enter the code we sent you", details={"field": "code"})
    ratelimit.enforce("otp:verify:ip", client_ip(request) or "", 60, 3600)
    now = timezone.now()
    with transaction.atomic():
        ch = (
            OtpChallenge.objects.select_for_update()
            .filter(phone=phone, purpose=purpose, verified_at__isnull=True, invalidated_at__isnull=True)
            .order_by("-created_at")
            .first()
        )
        if ch is None:
            raise ApiError("Request a new code to continue", status_code=400, code="otp_not_found")
        if ch.expires_at <= now:
            ch.invalidated_at = now
            ch.save(update_fields=["invalidated_at"])
            raise ApiError("That code has expired. Request a new one.", status_code=400, code="otp_expired")
        if ch.attempts >= ch.max_attempts:
            raise ApiError("Too many attempts. Request a new code.", status_code=429, code="otp_attempts")
        ch.attempts += 1
        if ch.mode == "beem_otp":
            ok, beem_code = BeemClient().otp_verify(ch.provider_ref, code)
            if beem_code in (115, 116, 118, 113):
                ch.invalidated_at = now
        else:
            try:
                ok = _hasher.verify(ch.code_hash, code)
            except VerifyMismatchError:
                ok = False
        if ok:
            ch.verified_at = now
            ch.save(update_fields=["attempts", "verified_at"])
            return ch
        exhausted = ch.attempts >= ch.max_attempts
        if exhausted:
            ch.invalidated_at = now
        ch.save(update_fields=["attempts", "invalidated_at"])
    if exhausted:
        _maybe_auto_block(phone)
        raise ApiError("Too many attempts. Request a new code.", status_code=429, code="otp_attempts")
    remaining = ch.max_attempts - ch.attempts
    raise ApiError("That code isn't right. Check the SMS and try again.", status_code=400, code="otp_invalid", details={"attemptsRemaining": remaining})


def _maybe_auto_block(phone: str) -> None:
    since = timezone.now() - timedelta(hours=24)
    burned = OtpChallenge.objects.filter(phone=phone, created_at__gte=since).exclude(verified_at__isnull=False).filter(attempts__gte=models_max_attempts()).count()
    if burned >= AUTO_BLOCK_AFTER_FAILED_CODES:
        BlockedPhone.objects.update_or_create(phone=phone, defaults={"reason": "Automatic: repeated failed codes", "until": timezone.now() + timedelta(hours=AUTO_BLOCK_HOURS), "automatic": True})
        logger.warning("auto-blocked %s for repeated OTP failures", mask_phone(phone))


def models_max_attempts() -> int:
    return settings_service.get("auth").otpMaxAttempts
