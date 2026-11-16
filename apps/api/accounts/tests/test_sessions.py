"""Persistent sign-in: rotation grace window, theft detection, sliding expiry, admin block / revoke."""
from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone
from freezegun import freeze_time

from accounts.models import Session
from accounts.tokens import start_session
from conftest import admin_client
from core import settings_service

pytestmark = pytest.mark.django_db


class _Req:
    headers = {"User-Agent": "pytest"}
    META = {"REMOTE_ADDR": "127.0.0.1"}
    device_id = "dev-1"


def _login(user):
    return start_session(user, _Req(), device_id="dev-1")


def _refresh(api, token, device="dev-1"):
    return api.post("/v1/auth/refresh", {"refreshToken": token}, format="json", HTTP_X_DEVICE_ID=device)


def test_previous_token_inside_grace_window_rotates_again(api, customer):
    t0 = _login(customer)["refreshToken"]
    r1 = _refresh(api, t0)
    assert r1.status_code == 200
    # The app was killed before it stored r1's token and presents t0 again a minute later: still signed in.
    with freeze_time(timezone.now() + timedelta(minutes=1)):
        r2 = _refresh(api, t0)
        assert r2.status_code == 200, r2.json()
        assert r2.json()["sessionId"] == r1.json()["sessionId"]
        # The freshly issued token keeps working and nothing was revoked.
        assert _refresh(api, r2.json()["refreshToken"]).status_code == 200
    assert not Session.objects.filter(revoke_reason="refresh_reuse").exists()


def test_previous_token_outside_grace_window_revokes_family(api, customer):
    t0 = _login(customer)["refreshToken"]
    r1 = _refresh(api, t0).json()
    with freeze_time(timezone.now() + timedelta(minutes=3)):
        r = _refresh(api, t0)
        assert r.status_code == 401 and r.json()["code"] == "refresh_invalid"
        assert _refresh(api, r1["refreshToken"]).status_code == 401
    assert Session.objects.get(id=r1["sessionId"]).revoke_reason == "refresh_reuse"


def test_previous_token_from_another_device_is_not_graced(api, customer):
    t0 = _login(customer)["refreshToken"]
    assert _refresh(api, t0).status_code == 200
    assert _refresh(api, t0, device="dev-evil").status_code == 401
    assert Session.objects.filter(revoke_reason="refresh_reuse").exists()


def test_expiry_slides_on_every_refresh(api, customer):
    assert settings_service.get("auth").refreshTokenTtlDays == 180
    tok = _login(customer)
    s = Session.objects.get(id=tok["sessionId"])
    first_expiry = s.expires_at
    later = timezone.now() + timedelta(days=150)
    with freeze_time(later):
        r = _refresh(api, tok["refreshToken"])
        assert r.status_code == 200
    s.refresh_from_db()
    assert s.expires_at > first_expiry + timedelta(days=149)
    # An idle session still ends at its expiry.
    with freeze_time(s.expires_at + timedelta(minutes=1)):
        assert _refresh(api, r.json()["refreshToken"]).status_code == 401


def test_blocked_user_refresh_returns_403_and_access_is_rejected(api, customer, admin_user):
    tok = _login(customer)
    a = admin_client(admin_user)
    assert a.patch(f"/v1/admin/customers/{customer.id}", {"blocked": True, "reason": "fraud"}, format="json").status_code == 200
    r = _refresh(api, tok["refreshToken"])
    assert r.status_code == 403
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {tok['accessToken']}", HTTP_X_DEVICE_ID="dev-1")
    assert api.get("/v1/me").status_code in (401, 403)


def test_admin_revokes_sessions(api, customer, admin_user):
    tok = _login(customer)
    a = admin_client(admin_user)
    detail = a.get(f"/v1/admin/customers/{customer.id}").json()
    assert [s["id"] for s in detail["sessions"]] == [tok["sessionId"]]
    r = a.delete(f"/v1/admin/customers/{customer.id}/sessions/{tok['sessionId']}")
    assert r.status_code == 200 and r.json()["items"] == []
    resp = _refresh(api, tok["refreshToken"])
    assert resp.status_code == 401 and resp.json()["code"] == "session_revoked"
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {tok['accessToken']}", HTTP_X_DEVICE_ID="dev-1")
    me = api.get("/v1/me")
    assert me.status_code == 401 and me.json()["code"] == "session_revoked"


def test_revocation_pushes_realtime_event(customer, admin_user, monkeypatch, django_capture_on_commit_callbacks):
    sent = []
    monkeypatch.setattr("notifications.realtime.broadcast", lambda group, event: sent.append((group, event)))
    tok = _login(customer)
    with django_capture_on_commit_callbacks(execute=True):
        admin_client(admin_user).delete(f"/v1/admin/customers/{customer.id}/sessions")
    assert (f"user.{customer.id}", {"type": "session.revoked", "sessionIds": [tok["sessionId"]], "reason": "admin_revoked"}) in sent


def test_refresh_works_with_an_expired_access_token_in_the_header(api, customer):
    """The app may still send its old (expired) bearer token on /auth/refresh; that must not block the refresh."""
    tok = _login(customer)
    with freeze_time(timezone.now() + timedelta(hours=2)):
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {tok['accessToken']}", HTTP_X_DEVICE_ID="dev-1")
        r = api.post("/v1/auth/refresh", {"refreshToken": tok["refreshToken"]}, format="json")
        assert r.status_code == 200, r.json()
