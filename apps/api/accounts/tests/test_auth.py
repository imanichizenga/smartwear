from __future__ import annotations

import re

import httpx
import pyotp
import pytest
import respx

from accounts import google
from accounts.models import AdminSession, AuthIdentity, OtpChallenge, Session, User
from conftest import user_client
from core import settings_service

pytestmark = pytest.mark.django_db
SMS = "https://apisms.beem.africa/v1/send"


def configure_beem(**extra):
    settings_service.update("sms.beem", {"apiKey": "key-123", "secretKey": "secret-3fA9", "senderId": "SMARTWEAR", "androidAppHash": "FA+9qCX9VSu", **extra})


@respx.mock
def test_phone_otp_signup_and_login(api):
    configure_beem()
    sent = {}

    def capture(request):
        sent["body"] = request.read().decode()
        sent["auth"] = request.headers["authorization"]
        return httpx.Response(200, json={"successful": True, "request_id": "991", "code": 100, "message": "Message Submitted Successfully", "valid": 1, "invalid": 0, "duplicates": 0})

    respx.post(SMS).mock(side_effect=capture)
    r = api.post("/v1/auth/otp/request", {"phone": "0712 345 678"}, format="json", HTTP_X_DEVICE_ID="dev-1")
    assert r.status_code == 200, r.json()
    assert r.json()["phone"] == "+255712345678" and r.json()["maskedPhone"].endswith("678")
    import json

    body = json.loads(sent["body"])
    assert body["source_addr"] == "SMARTWEAR" and body["recipients"][0]["dest_addr"] == "255712345678" and body["encoding"] == 0
    code = re.search(r"\b(\d{6})\b", body["message"]).group(1)
    assert "FA+9qCX9VSu" in body["message"] and sent["auth"].startswith("Basic ")
    ch = OtpChallenge.objects.get()
    assert code not in ch.code_hash and ch.code_hash.startswith("$argon2id$")
    bad = api.post("/v1/auth/otp/verify", {"phone": "+255712345678", "code": "000000" if code != "000000" else "111111"}, format="json")
    assert bad.status_code == 400 and bad.json()["details"]["attemptsRemaining"] == 4
    ok = api.post("/v1/auth/otp/verify", {"phone": "+255712345678", "code": code, "deviceId": "dev-1", "platform": "android"}, format="json", HTTP_X_DEVICE_ID="dev-1")
    assert ok.status_code == 200, ok.json()
    d = ok.json()
    assert d["isNewUser"] is True and d["next"] == "style_quiz" and d["user"]["phoneVerified"] is True
    assert User.objects.get(phone="+255712345678").identities.filter(provider="phone").exists()
    # Code can't be reused
    assert api.post("/v1/auth/otp/verify", {"phone": "+255712345678", "code": code}, format="json").status_code == 400


@respx.mock
def test_resend_cooldown_and_hourly_limit(api):
    configure_beem()
    respx.post(SMS).mock(return_value=httpx.Response(200, json={"successful": True, "request_id": "1", "code": 100, "message": "ok", "valid": 1}))
    assert api.post("/v1/auth/otp/request", {"phone": "+255712000001"}, format="json").status_code == 200
    r = api.post("/v1/auth/otp/request", {"phone": "+255712000001"}, format="json")
    assert r.status_code == 429 and r.json()["details"]["retryAfterSeconds"] > 0


def test_otp_not_configured_is_clear(api):
    r = api.post("/v1/auth/otp/request", {"phone": "+255712000002"}, format="json")
    assert r.status_code == 503 and r.json()["code"] == "not_configured"


def test_invalid_phone(api):
    r = api.post("/v1/auth/otp/request", {"phone": "12"}, format="json")
    assert r.status_code == 400 and r.json()["details"]["field"] == "phone"


@respx.mock
def test_beem_otp_mode(api):
    configure_beem(otpMode="beem_otp", otpAppId="1234")
    req = respx.post("https://apiotp.beem.africa/v1/request").mock(return_value=httpx.Response(200, json={"data": {"pinId": "e1c1a0a0-0000-4000-8000-000000000001", "message": {"code": 100, "message": "SMS sent successfully"}, "pinExpiryTimeInMinutes": 5, "expiresInSeconds": 300}}))
    respx.post("https://apiotp.beem.africa/v1/verify").mock(side_effect=lambda r: httpx.Response(200, json={"data": {"message": {"code": 117 if b'"pin": "4321"' in r.read() or b'"pin":"4321"' in r.read() else 114, "message": "x"}}}))
    assert api.post("/v1/auth/otp/request", {"phone": "+255712000003"}, format="json").status_code == 200
    assert req.calls.last.request.read() == b'{"appId":1234,"msisdn":"255712000003"}'
    assert api.post("/v1/auth/otp/verify", {"phone": "+255712000003", "code": "1111"}, format="json").status_code == 400
    assert api.post("/v1/auth/otp/verify", {"phone": "+255712000003", "code": "4321"}, format="json").status_code == 200


def test_google_sign_in_and_refresh_rotation(api):
    settings_service.update("auth", {"googleWebClientId": "1234567890-abc123.apps.googleusercontent.com"})
    google.set_verifier(lambda tok, auds: {"iss": "https://accounts.google.com", "aud": auds[0], "sub": "g-42", "email": "amani@example.com", "email_verified": True, "name": "Amani Kweka"})
    try:
        r = api.post("/v1/auth/google", {"idToken": "x" * 40, "deviceId": "dev-g"}, format="json", HTTP_X_DEVICE_ID="dev-g")
        assert r.status_code == 200, r.json()
        d = r.json()
        assert d["user"]["name"] == "Amani Kweka" and d["phoneRequiredAtCheckout"] is True
        again = api.post("/v1/auth/google", {"idToken": "x" * 40, "deviceId": "dev-g"}, format="json", HTTP_X_DEVICE_ID="dev-g").json()
        assert again["isNewUser"] is False and again["user"]["id"] == d["user"]["id"]
        r1 = api.post("/v1/auth/refresh", {"refreshToken": again["refreshToken"]}, format="json", HTTP_X_DEVICE_ID="dev-g")
        assert r1.status_code == 200
        # Reusing the old refresh token = theft signal → whole family revoked
        assert api.post("/v1/auth/refresh", {"refreshToken": again["refreshToken"]}, format="json", HTTP_X_DEVICE_ID="dev-g").status_code == 401
        assert api.post("/v1/auth/refresh", {"refreshToken": r1.json()["refreshToken"]}, format="json", HTTP_X_DEVICE_ID="dev-g").status_code == 401
        assert Session.objects.filter(revoke_reason="refresh_reuse").exists()
    finally:
        google.set_verifier(None)


def test_google_not_configured(api):
    r = api.post("/v1/auth/google", {"idToken": "x" * 40}, format="json")
    assert r.status_code == 503


def test_link_google_to_phone_account_merges(customer):
    settings_service.update("auth", {"googleWebClientId": "1234567890-abc123.apps.googleusercontent.com"})
    other = User.objects.create(email="neema@example.com", name="Neema", loyalty_points=40)
    AuthIdentity.objects.create(user=other, provider="google", subject="g-7")
    google.set_verifier(lambda tok, auds: {"iss": "accounts.google.com", "aud": auds[0], "sub": "g-7", "email": "neema@example.com", "email_verified": True})
    try:
        r = user_client(customer).post("/v1/me/link/google", {"idToken": "y" * 40}, format="json")
        assert r.status_code == 200 and r.json()["merged"] is True
        customer.refresh_from_db()
        other.refresh_from_db()
        assert other.deleted_at is not None and other.merged_into_id == customer.id
        assert customer.loyalty_points == 40 and set(customer.identities.values_list("provider", flat=True)) == {"phone", "google"}
    finally:
        google.set_verifier(None)


def test_logout_revokes_access_immediately(customer):
    c = user_client(customer)
    assert c.get("/v1/me").status_code == 200
    assert c.post("/v1/auth/logout", {}, format="json").status_code == 200
    assert c.get("/v1/me").status_code == 401


def test_admin_bootstrap_password_and_mandatory_totp(api):
    assert api.get("/v1/admin/auth/bootstrap").json()["needsBootstrap"] is True
    r = api.post("/v1/admin/auth/bootstrap", {"email": "Founder@SmartWear.co.tz", "name": "Founder", "password": "a-very-long-passphrase"}, format="json")
    assert r.status_code == 201 and r.json()["mfa"] == "setup"
    assert api.post("/v1/admin/auth/bootstrap", {"email": "x@smartwear.test", "name": "X", "password": "a-very-long-passphrase"}, format="json").status_code == 403
    # Before 2FA the session can't touch anything else
    assert api.get("/v1/admin/settings").status_code == 401
    setup = api.post("/v1/admin/auth/mfa/setup", {}, format="json", HTTP_X_REQUESTED_WITH="SmartWearAdmin").json()
    code = pyotp.TOTP(setup["secret"]).now()
    conf = api.post("/v1/admin/auth/mfa/confirm", {"code": code}, format="json", HTTP_X_REQUESTED_WITH="SmartWearAdmin")
    assert conf.status_code == 200 and len(conf.json()["recoveryCodes"]) == 10
    assert api.get("/v1/admin/settings").status_code == 200
    # Fresh login requires the TOTP step
    api.cookies.clear()
    login = api.post("/v1/admin/auth/login", {"email": "founder@smartwear.co.tz", "password": "a-very-long-passphrase"}, format="json")
    assert login.json()["mfa"] == "verify"
    assert api.get("/v1/admin/settings").status_code == 401
    rec = conf.json()["recoveryCodes"][0]
    assert api.post("/v1/admin/auth/mfa/verify", {"recoveryCode": rec}, format="json", HTTP_X_REQUESTED_WITH="SmartWearAdmin").status_code == 200
    assert api.get("/v1/admin/settings").status_code == 200
    # CSRF header required for cookie-authenticated writes
    assert api.post("/v1/admin/auth/logout", {}, format="json").status_code == 403
    assert AdminSession.objects.filter(mfa_passed=True).count() == 2


def test_admin_lockout(admin_user, api):
    for _ in range(5):
        api.post("/v1/admin/auth/login", {"email": admin_user.email, "password": "wrong"}, format="json")
    r = api.post("/v1/admin/auth/login", {"email": admin_user.email, "password": "correct horse battery"}, format="json")
    assert r.status_code == 429
