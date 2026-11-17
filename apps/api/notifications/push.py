"""Push delivery from DB credentials: FCM HTTP v1 (Android + iOS, the Flutter apps), plus Expo and direct APNs for older tokens."""
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


def _fcm_message(t: PushToken, title: str, body: str, data: dict, channel: str, image: str | None, priority: str) -> dict:
    """One FCM v1 message. iOS devices get their APNs fields through FCM (sound, rich image via mutable-content)."""
    note: dict[str, Any] = {"title": title, "body": body}
    if image:
        note["image"] = image
    android: dict[str, Any] = {"priority": "HIGH" if priority == "high" else "NORMAL", "notification": {"channel_id": channel, "sound": "default", "default_vibrate_timings": True}}
    if image:
        android["notification"]["image"] = image
    apns = {"headers": {"apns-priority": "10" if priority == "high" else "5"}, "payload": {"aps": {"sound": "default", "mutable-content": 1}}, **({"fcm_options": {"image": image}} if image else {})}
    return {"message": {"token": t.token, "notification": note, "data": {k: v if isinstance(v, str) else json.dumps(v) for k, v in data.items()}, "android": android, "apns": apns}}


def _fcm(tokens: list[PushToken], title: str, body: str, data: dict, channel: str, image: str | None = None, priority: str = "high") -> dict[str, Any]:
    cfg = settings_service.get("push")
    if not cfg.fcmServiceAccountJson:
        return {"sent": len(tokens), "ok": 0, "errors": ["FCM not configured"], "okTokens": []}
    from concurrent.futures import ThreadPoolExecutor

    import urllib3
    from google.auth.transport.urllib3 import Request  # urllib3 is installed; the `requests` transport is not

    try:
        creds, project = _fcm_credentials(cfg.fcmServiceAccountJson)
        if not creds.valid:
            creds.refresh(Request(urllib3.PoolManager()))
    except Exception as e:  # noqa: BLE001 — bad JSON / revoked key: report it, never crash the caller
        logger.warning("FCM credentials rejected: %s", e)
        return {"sent": len(tokens), "ok": 0, "errors": [f"FCM credentials rejected — check Settings → Push ({str(e)[:60]})"], "okTokens": []}
    url = f"https://fcm.googleapis.com/v1/projects/{project}/messages:send"
    ok_tokens: list[int] = []
    errors: list[str] = []
    with httpx.Client(timeout=10, headers={"Authorization": f"Bearer {creds.token}"}, limits=httpx.Limits(max_connections=8)) as c:

        def one(t: PushToken) -> tuple[PushToken, str | None]:
            try:
                r = c.post(url, json=_fcm_message(t, title, body, data, channel, image, priority))
            except httpx.HTTPError as e:
                return t, str(e)[:80]
            if r.is_success:
                return t, None
            return t, ((r.json() if r.content else {}).get("error") or {}).get("status", f"HTTP {r.status_code}")

        with ThreadPoolExecutor(max_workers=8) as pool:
            for t, err in pool.map(one, tokens):
                if err is None:
                    ok_tokens.append(t.pk)
                else:
                    errors.append(err)
                    if err in ("NOT_FOUND", "UNREGISTERED", "INVALID_ARGUMENT"):
                        PushToken.objects.filter(pk=t.pk).update(disabled_at=_now())
    return {"sent": len(tokens), "ok": len(ok_tokens), "errors": errors[:5], "okTokens": ok_tokens}


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


def send(tokens: list[PushToken], title: str, body: str, data: dict | None = None, *, sound: str | None = "default", channel: str = "default", priority: str = "high", image: str | None = None) -> dict[str, Any]:
    """Delivers to every live token through the service that issued it (FCM for the Flutter apps; Expo / direct
    APNs tokens from older builds still work). `okTokens` lists the token ids that were accepted."""
    data = data or {}
    tokens = [t for t in tokens if t.disabled_at is None]
    if not tokens:
        return {"sent": 0, "ok": 0, "errors": [], "okTokens": [], "message": "No registered devices"}
    groups = {p: [t for t in tokens if t.provider == p] for p in ("fcm", "expo", "apns")}
    results = []
    if groups["fcm"]:
        results.append(_fcm(groups["fcm"], title, body, data, channel, image, priority))
    if groups["expo"]:
        r = _expo(groups["expo"], title, body, data, sound=sound, channel=channel, priority=priority)
        r.setdefault("okTokens", [t.pk for t in groups["expo"]] if r["ok"] == len(groups["expo"]) else [])
        results.append(r)
    if groups["apns"]:
        r = _apns(groups["apns"], title, body, data, sound)
        r.setdefault("okTokens", [t.pk for t in groups["apns"]] if r["ok"] == len(groups["apns"]) else [])
        results.append(r)
    return {"sent": sum(r["sent"] for r in results), "ok": sum(r["ok"] for r in results), "errors": [e for r in results for e in r["errors"]][:5], "okTokens": [i for r in results for i in r.get("okTokens", [])]}


def send_to_user(user, title: str, body: str, data: dict | None = None, **kw) -> dict[str, Any]:
    return send(list(PushToken.objects.filter(user=user, disabled_at__isnull=True)), title, body, data, **kw)


def send_to_admin(admin, title: str, body: str, data: dict | None = None) -> dict[str, Any]:
    return send(list(PushToken.objects.filter(admin=admin, disabled_at__isnull=True)), title, body, data)
