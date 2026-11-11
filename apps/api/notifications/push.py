"""Push delivery: Expo Push Service (default) or FCM v1 + APNs (HTTP/2, token auth) from DB credentials."""
from __future__ import annotations

import json
import logging
import time
from functools import lru_cache
from typing import Any

import httpx
import jwt

from core import settings_service

from .models import PushToken

logger = logging.getLogger("smartwear.push")
EXPO_URL = "https://exp.host/--/api/v2/push/send"


def _expo(tokens: list[PushToken], title: str, body: str, data: dict, *, sound: str | None, channel: str, priority: str) -> dict[str, Any]:
    cfg = settings_service.get("push")
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if cfg.expoAccessToken:
        headers["Authorization"] = f"Bearer {cfg.expoAccessToken}"
    ok, errors = 0, []
    for i in range(0, len(tokens), 100):
        batch = tokens[i : i + 100]
        msgs = [{"to": t.token, "title": title, "body": body, "data": data, "sound": sound, "channelId": channel, "priority": priority, "mutableContent": True} for t in batch]
        try:
            r = httpx.post(EXPO_URL, json=msgs, headers=headers, timeout=15)
            res = r.json().get("data", []) if r.content else []
        except (httpx.HTTPError, ValueError) as e:
            errors.append(str(e))
            continue
        if not r.is_success:
            errors.append((r.json().get("errors") or [{}])[0].get("message", f"HTTP {r.status_code}"))
            continue
        for t, item in zip(batch, res, strict=False):
            if item.get("status") == "ok":
                ok += 1
            else:
                err = (item.get("details") or {}).get("error") or item.get("message")
                errors.append(err)
                if err == "DeviceNotRegistered":
                    PushToken.objects.filter(pk=t.pk).update(disabled_at=_now())
    return {"sent": len(tokens), "ok": ok, "errors": errors[:5]}


def _now():
    from django.utils import timezone

    return timezone.now()


@lru_cache(maxsize=2)
def _fcm_credentials(sa_json: str):
    from google.oauth2 import service_account

    info = json.loads(sa_json)
    return service_account.Credentials.from_service_account_info(info, scopes=["https://www.googleapis.com/auth/firebase.messaging"]), info["project_id"]


def _fcm(tokens: list[PushToken], title: str, body: str, data: dict, channel: str) -> dict[str, Any]:
    cfg = settings_service.get("push")
    if not cfg.fcmServiceAccountJson:
        return {"sent": len(tokens), "ok": 0, "errors": ["FCM not configured"]}
    from google.auth.transport.requests import Request

    creds, project = _fcm_credentials(cfg.fcmServiceAccountJson)
    if not creds.valid:
        creds.refresh(Request())
    ok, errors = 0, []
    with httpx.Client(timeout=10, headers={"Authorization": f"Bearer {creds.token}"}) as c:
        for t in tokens:
            msg = {"message": {"token": t.token, "notification": {"title": title, "body": body}, "data": {k: str(v) for k, v in data.items()}, "android": {"priority": "HIGH", "notification": {"channel_id": channel}}}}
            r = c.post(f"https://fcm.googleapis.com/v1/projects/{project}/messages:send", json=msg)
            if r.is_success:
                ok += 1
            else:
                err = (r.json().get("error") or {}).get("status", f"HTTP {r.status_code}")
                errors.append(err)
                if err in ("NOT_FOUND", "UNREGISTERED"):
                    PushToken.objects.filter(pk=t.pk).update(disabled_at=_now())
    return {"sent": len(tokens), "ok": ok, "errors": errors[:5]}


_apns_jwt: dict[str, Any] = {}


def _apns(tokens: list[PushToken], title: str, body: str, data: dict, sound: str | None) -> dict[str, Any]:
    cfg = settings_service.get("push")
    if not (cfg.apnsKeyP8 and cfg.apnsKeyId and cfg.apnsTeamId):
        return {"sent": len(tokens), "ok": 0, "errors": ["APNs not configured"]}
    now = int(time.time())
    if not _apns_jwt or now - _apns_jwt.get("iat", 0) > 3000:
        _apns_jwt.update({"iat": now, "token": jwt.encode({"iss": cfg.apnsTeamId, "iat": now}, cfg.apnsKeyP8, algorithm="ES256", headers={"kid": cfg.apnsKeyId})})
    host = "https://api.sandbox.push.apple.com" if cfg.apnsSandbox else "https://api.push.apple.com"
    ok, errors = 0, []
    with httpx.Client(http2=True, timeout=10, headers={"authorization": f"bearer {_apns_jwt['token']}", "apns-topic": cfg.apnsBundleId, "apns-push-type": "alert"}) as c:
        for t in tokens:
            r = c.post(f"{host}/3/device/{t.token}", json={"aps": {"alert": {"title": title, "body": body}, "sound": sound or "default"}, **data})
            if r.status_code == 200:
                ok += 1
            else:
                reason = (r.json() if r.content else {}).get("reason", f"HTTP {r.status_code}")
                errors.append(reason)
                if reason in ("BadDeviceToken", "Unregistered"):
                    PushToken.objects.filter(pk=t.pk).update(disabled_at=_now())
    return {"sent": len(tokens), "ok": ok, "errors": errors[:5]}


def send(tokens: list[PushToken], title: str, body: str, data: dict | None = None, *, sound: str | None = "default", channel: str = "default", priority: str = "high") -> dict[str, Any]:
    data = data or {}
    tokens = [t for t in tokens if t.disabled_at is None]
    if not tokens:
        return {"sent": 0, "ok": 0, "errors": [], "message": "No registered devices"}
    cfg = settings_service.get("push")
    if cfg.provider == "expo":
        return _expo(tokens, title, body, data, sound=sound, channel=channel, priority=priority)
    results = [_fcm([t for t in tokens if t.provider == "fcm"], title, body, data, channel) if any(t.provider == "fcm" for t in tokens) else None,
               _apns([t for t in tokens if t.provider == "apns"], title, body, data, sound) if any(t.provider == "apns" for t in tokens) else None]
    results = [r for r in results if r]
    return {"sent": sum(r["sent"] for r in results), "ok": sum(r["ok"] for r in results), "errors": [e for r in results for e in r["errors"]][:5]}


def send_to_user(user, title: str, body: str, data: dict | None = None, **kw) -> dict[str, Any]:
    return send(list(PushToken.objects.filter(user=user, disabled_at__isnull=True)), title, body, data, **kw)


def send_to_admin(admin, title: str, body: str, data: dict | None = None) -> dict[str, Any]:
    return send(list(PushToken.objects.filter(admin=admin, disabled_at__isnull=True)), title, body, data)
