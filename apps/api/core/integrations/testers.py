"""
Test connection for every integration. Each returns {"ok": bool, "checks": [{name, ok, message}], "message": str}.
Provider errors are surfaced verbatim so admins can act on them.
"""
from __future__ import annotations

import time
import uuid
from typing import Any

import httpx

from core import settings_service
from core.exceptions import ApiError


def _check(name: str, ok: bool, message: str = "", **extra: Any) -> dict[str, Any]:
    return {"name": name, "ok": ok, "message": message, **extra}


def _result(checks: list[dict]) -> dict[str, Any]:
    ok = all(c["ok"] for c in checks if not c.get("optional"))
    failed = [c for c in checks if not c["ok"] and not c.get("optional")]
    return {"ok": ok, "checks": checks, "message": "All checks passed" if ok else failed[0]["message"]}


def test_s3(params: dict) -> dict:
    from botocore.exceptions import BotoCoreError, ClientError

    from media import storage

    cfg = settings_service.get("storage.s3")
    if not storage.configured():
        return _result([_check("Credentials", False, "Not configured — enter bucket, region, access key and secret")])
    checks = []
    key = f"{storage.key_prefix()}/_healthcheck/{uuid.uuid4().hex}.txt"
    body = f"smartwear-test {time.time()}".encode()
    c = storage.client()
    try:
        c.put_object(Bucket=cfg.bucket, Key=key, Body=body, ContentType="text/plain")
        checks.append(_check("Put object", True, key))
        got = c.get_object(Bucket=cfg.bucket, Key=key)["Body"].read()
        checks.append(_check("Get object", got == body, "Read back matches" if got == body else "Content mismatch"))
        c.delete_object(Bucket=cfg.bucket, Key=key)
        checks.append(_check("Delete object", True))
    except (BotoCoreError, ClientError) as e:
        checks.append(_check("Bucket access", False, str(e)))
        return _result(checks)
    # CORS for direct browser uploads
    try:
        rules = c.get_bucket_cors(Bucket=cfg.bucket).get("CORSRules", [])
        methods = {m for r in rules for m in r.get("AllowedMethods", [])}
        origins = {o for r in rules for o in r.get("AllowedOrigins", [])}
        admin_origin = settings_service.get("branding").adminUrl.rstrip("/")
        ok = ("POST" in methods or "PUT" in methods) and ("*" in origins or admin_origin in origins)
        checks.append(_check("CORS for browser uploads", ok, "POST/PUT allowed for the admin origin" if ok else f"Add a CORS rule allowing POST and PUT from {admin_origin} (and ETag in ExposeHeaders for multipart)", rules=rules))
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code")
        checks.append(_check("CORS for browser uploads", False, "No CORS configuration on the bucket — browser uploads will fail" if code == "NoSuchCORSConfiguration" else str(e)))
    if cfg.cdnBaseUrl:
        try:
            r = httpx.head(cfg.cdnBaseUrl.rstrip("/") + "/", timeout=8, follow_redirects=True)
            checks.append(_check("CDN resolves", r.status_code < 500, f"HTTP {r.status_code} from {cfg.cdnBaseUrl}"))
        except httpx.HTTPError as e:
            checks.append(_check("CDN resolves", False, f"{cfg.cdnBaseUrl}: {e}"))
    else:
        checks.append(_check("CDN", True, "No CDN set — media is served with short-lived presigned URLs", optional=True))
    return _result(checks)


def test_beem(params: dict) -> dict:
    from core.integrations.beem import BeemClient

    client = BeemClient()
    cfg = client.cfg
    if not (cfg.apiKey and cfg.secretKey):
        return _result([_check("Credentials", False, "Not configured — enter the Beem API key and secret")])
    checks = []
    try:
        bal = client.balance()
        checks.append(_check("Account balance", True, f"{bal:,.0f} SMS credits", balance=bal))
        if bal <= 0:
            checks.append(_check("Credit", False, "Balance is zero — top up before sending codes"))
    except ApiError as e:
        checks.append(_check("Account balance", False, e.message))
        return _result(checks)
    checks.append(_check("Sender ID", bool(cfg.senderId), cfg.senderId or "Enter your approved Sender ID (source_addr)"))
    if cfg.otpMode == "beem_otp":
        checks.append(_check("OTP App ID", bool(cfg.otpAppId), cfg.otpAppId or "Enter the OTP App ID from the Beem OTP dashboard"))
    to = (params or {}).get("testPhone")
    if to:
        from accounts.phone import normalize_phone

        try:
            r = client.send_sms([normalize_phone(to)], "SmartWear test message — your SMS integration works.")
            checks.append(_check("Test SMS", r.ok, f"Accepted (request {r.request_id})" if r.ok else f"{r.message} (code {r.code})"))
        except ApiError as e:
            checks.append(_check("Test SMS", False, e.message))
    return _result(checks)


def test_google_auth(params: dict) -> dict:
    from accounts import google

    cfg = settings_service.get("auth")
    checks = []
    for label, cid in (("Web client ID", cfg.googleWebClientId), ("iOS client ID", cfg.googleIosClientId), ("Android client ID", cfg.googleAndroidClientId)):
        if cid:
            ok = google.validate_client_id_format(cid)
            checks.append(_check(label, ok, "Format looks right" if ok else "Expected <number>-<id>.apps.googleusercontent.com"))
        else:
            checks.append(_check(label, label != "Web client ID", "Not set" if label != "Web client ID" else "Required — the app passes it to GoogleSignin.configure()", optional=label != "Web client ID"))
    token = (params or {}).get("idToken")
    if token:
        try:
            claims = google.verify_id_token(token)
            checks.append(_check("Verify ID token", True, f"Signed in as {claims.get('email') or claims['sub']}"))
        except ApiError as e:
            checks.append(_check("Verify ID token", False, e.message))
    return _result(checks)


def test_maps(params: dict) -> dict:
    cfg = settings_service.get("maps.google")
    if not cfg.serverApiKey:
        return _result([_check("Server key", False, "Not configured — enter the server API key")])
    checks = []
    lat, lng = -6.7924, 39.2083  # Dar es Salaam city centre
    with httpx.Client(timeout=10) as c:
        try:
            r = c.get("https://maps.googleapis.com/maps/api/geocode/json", params={"latlng": f"{lat},{lng}", "key": cfg.serverApiKey})
            d = r.json()
            ok = d.get("status") == "OK"
            checks.append(_check("Geocoding API", ok, d.get("results", [{}])[0].get("formatted_address", "") if ok else f"{d.get('status')}: {d.get('error_message', '')}"))
        except (httpx.HTTPError, ValueError) as e:
            checks.append(_check("Geocoding API", False, str(e)))
        try:
            r = c.post("https://places.googleapis.com/v1/places:autocomplete", json={"input": "Mlimani City", "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 20000.0}}, "includedRegionCodes": [cfg.regionCode]}, headers={"X-Goog-Api-Key": cfg.serverApiKey, "X-Goog-FieldMask": "suggestions.placePrediction.text"})
            d = r.json()
            ok = r.is_success
            checks.append(_check("Places API (New) — Autocomplete", ok, f"{len(d.get('suggestions', []))} suggestions" if ok else (d.get("error", {}) or {}).get("message", f"HTTP {r.status_code}")))
        except (httpx.HTTPError, ValueError) as e:
            checks.append(_check("Places API (New) — Autocomplete", False, str(e)))
        try:
            r = c.post("https://routes.googleapis.com/directions/v2:computeRoutes", json={"origin": {"location": {"latLng": {"latitude": lat, "longitude": lng}}}, "destination": {"location": {"latLng": {"latitude": -6.7735, "longitude": 39.2695}}}, "travelMode": "DRIVE"}, headers={"X-Goog-Api-Key": cfg.serverApiKey, "X-Goog-FieldMask": "routes.duration,routes.distanceMeters"})
            d = r.json()
            ok = r.is_success and bool(d.get("routes"))
            checks.append(_check("Routes API", ok, f"{d['routes'][0].get('distanceMeters', 0)} m, {d['routes'][0].get('duration')}" if ok else (d.get("error", {}) or {}).get("message", f"HTTP {r.status_code}")))
        except (httpx.HTTPError, ValueError, KeyError, IndexError) as e:
            checks.append(_check("Routes API", False, str(e)))
    return _result(checks)


def test_push(params: dict, admin=None) -> dict:
    from notifications.push import send_to_admin

    cfg = settings_service.get("push")
    checks = [_check("Provider", True, cfg.provider)]
    if cfg.provider == "fcm_apns" and not (cfg.fcmServiceAccountJson or cfg.apnsKeyP8):
        return _result(checks + [_check("Credentials", False, "Not configured — add the FCM service account JSON and/or the APNs key")])
    if admin is None:
        return _result(checks + [_check("Test push", False, "Sign in as an admin to send a test push")])
    result = send_to_admin(admin, "SmartWear test", "Push notifications are working.")
    if result["sent"] == 0:
        checks.append(_check("Test push", False, result.get("message") or "No registered device for your admin account — open the SmartWear app signed in with Rider/Admin push enabled, or register a token below."))
    else:
        checks.append(_check("Test push", result["ok"] > 0, f"Delivered to {result['ok']}/{result['sent']} device(s)" + (f" — {result['errors'][0]}" if result.get("errors") else "")))
    return _result(checks)


def test_payments(params: dict) -> dict:
    cfg = settings_service.get("payments")
    checks = [_check("Cash on delivery", True, "Enabled" if cfg.cashOnDeliveryEnabled else "Disabled", optional=True)]
    if cfg.mobileMoneyProvider == "snippe":
        from commerce.services import snippe

        if not cfg.snippeApiKey:
            checks.append(_check("Snippe API key", False, "Not configured — create a key (collection:read, collection:create) in Snippe → Settings → API Keys"))
            return _result(checks)
        ok, msg, _bal = snippe.ping()
        checks.append(_check("Snippe API (balance)", ok, msg))
        checks.append(_check("Webhook secret", bool(cfg.snippeWebhookSecret), "Set — payment results are verified" if cfg.snippeWebhookSecret else "Copy Settings → Webhook Secret from the Snippe dashboard; unsigned results are rejected"))
        base = (cfg.publicApiBaseUrl or "").rstrip("/")
        checks.append(_check("Webhook URL", base.startswith("https://"), f"{base}/v1/webhooks/snippe" if base else "Set the public API URL (HTTPS) so Snippe can reach /v1/webhooks/snippe"))
    elif cfg.mobileMoneyProvider == "beem_checkout":
        if not (cfg.beemCheckoutApiKey and cfg.beemCheckoutSecretKey):
            checks.append(_check("Beem Checkout credentials", False, "Not configured — enter the Bpay API key and secret"))
            return _result(checks)
        from commerce.services.payments import beem_checkout_ping

        ok, msg = beem_checkout_ping()
        checks.append(_check("Beem Checkout", ok, msg))
        checks.append(_check("Callback secret", bool(cfg.beemCheckoutCallbackSecret), "Set" if cfg.beemCheckoutCallbackSecret else "Set the callback secure token so payment callbacks can be verified"))
    else:
        checks.append(_check("Mobile money", True, "No mobile-money provider selected", optional=True))
    if cfg.riderPayoutsProvider == "snippe":
        from commerce.services import snippe

        if not cfg.snippeApiKey:
            checks.append(_check("Rider payouts (Snippe)", False, "Enter the Snippe API key above — payouts use the same key"))
        else:
            try:
                fee = snippe.payout_fee(max(cfg.riderPayoutMinimum, 5000))
                checks.append(_check("Rider payouts (Snippe)", True, f"disbursement scope OK — fee on {max(cfg.riderPayoutMinimum, 5000):,} TZS is {int(fee.get('fee_amount') or 0):,} TZS"))
            except ApiError as e:
                checks.append(_check("Rider payouts (Snippe)", False, f"{e.message} — the key needs the disbursement:read and disbursement:create scopes"))
    else:
        checks.append(_check("Rider payouts", True, "Recorded manually (cash or bank) from Admin → Rider payouts", optional=True))
    return _result(checks)


TESTERS = {
    "storage.s3": test_s3,
    "sms.beem": test_beem,
    "auth": test_google_auth,
    "maps.google": test_maps,
    "push": test_push,
    "payments": test_payments,
}


def configured_state(group: str) -> bool:
    from core.settings_schema import INTEGRATIONS

    meta = next((i for i in INTEGRATIONS if i.group == group), None)
    data = settings_service.get(group).model_dump()
    if meta is None:
        return True
    if group == "payments":
        return data["cashOnDeliveryEnabled"] or data["mobileMoneyProvider"] != "none"
    if group == "push":
        return data["provider"] == "expo" or bool(data["fcmServiceAccountJson"] or data["apnsKeyP8"])
    return all(bool(data.get(f)) for f in meta.requiredFields)
