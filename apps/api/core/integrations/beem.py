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

import re
import unicodedata
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


# Beem plain-text SMS (encoding 0) rejects anything it considers Unicode, so we send printable ASCII + newlines only.
_GSM = set(chr(c) for c in range(32, 127)) | {"\n"}
# Common "smart" punctuation that sneaks in from phones, Word and copy-paste.
_PUNCT = {
    "\u2014": "-", "\u2013": "-", "\u2012": "-", "\u2011": "-", "\u2010": "-", "\u2212": "-",
    "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'", "\u2032": "'",
    "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u201f": '"', "\u2033": '"', "\u00ab": '"', "\u00bb": '"',
    "\u2026": "...", "\u2022": "*", "\u00b7": "*", "\u00a0": " ", "\u2009": " ", "\u200a": " ", "\u202f": " ",
    "\u200b": "", "\u200c": "", "\u200d": "", "\ufeff": "", "\u2122": "TM", "\u00ae": "(R)", "\u00a9": "(C)",
    "\t": " ", "\r": "\n", "\u00a3": "GBP", "\u20ac": "EUR",
}


def to_gsm(text: str) -> str:
    """Make any text safe for Beem plain-text SMS (encoding 0), which rejects Unicode outright.
    Smart punctuation → ASCII, accents stripped (é → e), anything else (emoji, symbols) dropped."""
    out = []
    for ch in text.replace("\r\n", "\n"):
        ch = _PUNCT.get(ch, ch)
        if all(c in _GSM for c in ch):
            out.append(ch)
            continue
        base = "".join(c for c in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(c))
        out.append("".join(c for c in base if c in _GSM))
    return re.sub(r"[ ]{2,}", " ", "".join(out)).strip()


def _plain(msg: str) -> str:
    """Beem error messages can contain HTML (e.g. <strong>); show them as plain text."""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", msg or "")).strip()


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
        message = to_gsm(message)
        if not message:
            raise ApiError("The SMS has no text left after removing unsupported characters.", status_code=400, code="sms_empty")
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
        return SmsResult(ok=ok, request_id=str(d.get("request_id") or "") or None, code=d.get("code"), message=_plain(str(d.get("message") or r.reason_phrase)), valid=int(d.get("valid") or 0), invalid=int(d.get("invalid") or 0))

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


_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}|\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}")


def render_template(template: str, **values: Any) -> str:
    """Fill {{name}} placeholders. Admins also write {name}, {{ name }} or {NAME}, so all of those work too.
    Names are matched case-insensitively; placeholders with no value are left as typed (so mistakes stay visible)."""
    lookup = {k.lower(): v for k, v in values.items()}

    def sub(m: re.Match) -> str:
        key = (m.group(1) or m.group(2)).lower()
        return str(lookup[key]) if key in lookup else m.group(0)

    return _PLACEHOLDER.sub(sub, template or "").replace("\n\n", "\n").strip()
