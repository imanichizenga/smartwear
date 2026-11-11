"""Google Sign-In: verify the ID token from the native SDK against the client IDs stored in settings."""
from __future__ import annotations

import re
from collections.abc import Callable

from core import settings_service
from core.exceptions import ApiError

CLIENT_ID_RE = re.compile(r"^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$")
ISSUERS = {"accounts.google.com", "https://accounts.google.com"}

# Tests swap this for a fake verifier; production uses google-auth (fetches and caches Google's certs).
_verifier: Callable[[str, list[str]], dict] | None = None


def set_verifier(fn: Callable[[str, list[str]], dict] | None) -> None:
    global _verifier
    _verifier = fn


def audiences() -> list[str]:
    cfg = settings_service.get("auth")
    return [a for a in (cfg.googleWebClientId, cfg.googleIosClientId, cfg.googleAndroidClientId) if a]


def _google_verify(token: str, auds: list[str]) -> dict:
    from google.auth.transport import requests as g_requests
    from google.oauth2 import id_token

    req = g_requests.Request()
    last: Exception | None = None
    for aud in auds:
        try:
            return id_token.verify_oauth2_token(token, req, audience=aud, clock_skew_in_seconds=10)
        except ValueError as e:
            last = e
    raise ValueError(str(last) if last else "audience mismatch")


def verify_id_token(token: str) -> dict:
    auds = audiences()
    if not auds:
        raise ApiError.not_configured("Google Sign-In", "Enter the Google OAuth client IDs in Settings → Google Sign-In.")
    try:
        claims = (_verifier or _google_verify)(token, auds)
    except ValueError as e:
        raise ApiError.unauthorized(f"Google sign-in could not be verified: {e}") from e
    if claims.get("iss") not in ISSUERS:
        raise ApiError.unauthorized("Google sign-in could not be verified (issuer)")
    if claims.get("aud") not in auds and claims.get("azp") not in auds:
        raise ApiError.unauthorized("Google sign-in could not be verified (audience)")
    if not claims.get("sub"):
        raise ApiError.unauthorized("Google sign-in could not be verified (subject)")
    return claims


def validate_client_id_format(cid: str) -> bool:
    return bool(CLIENT_ID_RE.match(cid or ""))
