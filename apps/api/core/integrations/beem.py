"""
Beem Africa client — SMS (https://apisms.beem.africa) and OTP (https://apiotp.beem.africa/v1).
Verified against docs.beem.africa (Nov 2026):
  POST /v1/send                     {source_addr, message, encoding:0, recipients:[{recipient_id, dest_addr}], schedule_time}
                                    → {successful, request_id, code (100 = ok), message, valid, invalid, duplicates}
  GET  /public/v1/vendors/balance   → {data: {credit_balance}}
  POST /v1/request (OTP)            {appId, msisdn} → {data: {pinId, message: {code: 100}}}
  POST /v1/verify  (OTP)            {pinId, pin}    → {data: {message: {code: 117 = valid}}}
Auth: HTTP Basic (API key : secret). Numbers are international format without '+'.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from core import settings_service
from core.exceptions import ApiError

SMS_PROD, SMS_STAGING = "https://apisms.beem.africa", "https://dev-sms.beem.africa"
OTP_PROD, OTP_STAGING = "https://apiotp.beem.africa/v1", "https://dev-otp.beem.africa/v1"

OTP_ERRORS = {
    101: "Beem failed to send the code", 102: "Invalid phone number", 103: "Phone number missing", 104: "OTP App ID missing",
    106: "OTP application not found", 107: "OTP application is inactive", 108: "No channel set for the OTP application",
    109: "OTP template has no placeholder", 110: "OTP sending credentials missing", 111: "PIN missing", 112: "pinId missing",
    113: "Code not found or no longer active", 114: "Incorrect code", 115: "Code expired", 116: "Too many attempts", 118: "Code already used",
}


@dataclass
class SmsResult:
    ok: bool
    request_id: str | None
    code: int | None
    message: str
    valid: int = 0
    invalid: int = 0


def to_msisdn(e164: str) -> str:
    return e164.lstrip("+")


class BeemClient:
    def __init__(self, cfg=None, transport: httpx.BaseTransport | None = None):
        self.cfg = cfg or settings_service.get("sms.beem")
        self.transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.cfg.apiKey and self.cfg.secretKey and self.cfg.senderId)

    def _require(self, need_sender: bool = True) -> None:
        if not (self.cfg.apiKey and self.cfg.secretKey) or (need_sender and not self.cfg.senderId):
            raise ApiError.not_configured("SMS (Beem)", "Enter the Beem API key, secret and an approved Sender ID in Settings → SMS.")

    def _client(self, base: str) -> httpx.Client:
        return httpx.Client(base_url=base, auth=(self.cfg.apiKey, self.cfg.secretKey), timeout=15, transport=self.transport, headers={"Accept": "application/json"})

    @staticmethod
    def _json(r: httpx.Response) -> dict[str, Any]:
        try:
            return r.json()
        except ValueError:
            return {"message": r.text[:300]}

    def send_sms(self, recipients: list[str], message: str, *, schedule_time: str = "") -> SmsResult:
        self._require()
        body = {
            "source_addr": self.cfg.senderId,
            "schedule_time": schedule_time,
            "encoding": 0,
            "message": message,
            "recipients": [{"recipient_id": i + 1, "dest_addr": to_msisdn(n)} for i, n in enumerate(recipients)],
        }
        try:
            with self._client(SMS_STAGING if self.cfg.useStaging else SMS_PROD) as c:
                r = c.post("/v1/send", json=body)
        except httpx.HTTPError as e:
            raise ApiError.upstream("Beem", f"could not reach SMS API ({e.__class__.__name__})") from e
        d = self._json(r)
        if r.status_code == 401 or d.get("code") == 120:
            raise ApiError.upstream("Beem", "invalid API key or secret (code 120)")
        ok = r.is_success and bool(d.get("successful")) and d.get("code") in (100, None)
        return SmsResult(ok=ok, request_id=str(d.get("request_id") or "") or None, code=d.get("code"), message=str(d.get("message") or r.reason_phrase), valid=int(d.get("valid") or 0), invalid=int(d.get("invalid") or 0))

    def balance(self) -> float:
        self._require(need_sender=False)
        try:
            with self._client(SMS_STAGING if self.cfg.useStaging else SMS_PROD) as c:
                r = c.get("/public/v1/vendors/balance")
        except httpx.HTTPError as e:
            raise ApiError.upstream("Beem", f"could not reach SMS API ({e.__class__.__name__})") from e
        d = self._json(r)
        if r.status_code == 401 or d.get("code") == 120:
            raise ApiError.upstream("Beem", "invalid API key or secret (code 120)")
        if not r.is_success or "data" not in d:
            raise ApiError.upstream("Beem", str(d.get("message") or f"HTTP {r.status_code}"))
        return float(d["data"].get("credit_balance") or 0)

    # ---- Dedicated OTP API ----
    def otp_request(self, e164: str) -> str:
        self._require(need_sender=False)
        if not self.cfg.otpAppId:
            raise ApiError.not_configured("Beem OTP", "Enter the OTP App ID in Settings → SMS, or switch the OTP mode to SMS.")
        try:
            with self._client(OTP_STAGING if self.cfg.useStaging else OTP_PROD) as c:
                r = c.post("/request", json={"appId": int(self.cfg.otpAppId) if str(self.cfg.otpAppId).isdigit() else self.cfg.otpAppId, "msisdn": to_msisdn(e164)})
        except httpx.HTTPError as e:
            raise ApiError.upstream("Beem", f"could not reach OTP API ({e.__class__.__name__})") from e
        d = self._json(r)
        msg = (d.get("data") or {}).get("message") or {}
        if r.status_code == 401 or d.get("code") == 120:
            raise ApiError.upstream("Beem", "invalid API key or secret (code 120)")
        if msg.get("code") != 100 or not (d.get("data") or {}).get("pinId"):
            code = msg.get("code")
            raise ApiError.upstream("Beem", OTP_ERRORS.get(code, str(msg.get("message") or f"HTTP {r.status_code}")), details={"code": code})
        return str(d["data"]["pinId"])

    def otp_verify(self, pin_id: str, pin: str) -> tuple[bool, int | None]:
        self._require(need_sender=False)
        try:
            with self._client(OTP_STAGING if self.cfg.useStaging else OTP_PROD) as c:
                r = c.post("/verify", json={"pinId": pin_id, "pin": pin})
        except httpx.HTTPError as e:
            raise ApiError.upstream("Beem", f"could not reach OTP API ({e.__class__.__name__})") from e
        d = self._json(r)
        code = ((d.get("data") or {}).get("message") or {}).get("code")
        return code == 117, code


def render_template(template: str, **values: Any) -> str:
    out = template
    for k, v in values.items():
        out = out.replace("{{" + k + "}}", str(v))
    return out.replace("\n\n", "\n").strip()
