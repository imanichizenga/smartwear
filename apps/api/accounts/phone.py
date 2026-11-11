from __future__ import annotations

import phonenumbers

from core import settings_service
from core.exceptions import ApiError


def normalize_phone(raw: str, default_country: str | None = None) -> str:
    country = (default_country or settings_service.get("auth").defaultCountry or "TZ").upper()
    cleaned = "".join(ch for ch in (raw or "") if ch.isdigit() or ch == "+")
    try:
        p = phonenumbers.parse(cleaned, country)
    except phonenumbers.NumberParseException as e:
        raise ApiError.bad_request("Enter a valid phone number", details={"field": "phone"}) from e
    if not phonenumbers.is_valid_number(p):
        raise ApiError.bad_request("Enter a valid phone number", details={"field": "phone"})
    if phonenumbers.number_type(p) not in (phonenumbers.PhoneNumberType.MOBILE, phonenumbers.PhoneNumberType.FIXED_LINE_OR_MOBILE):
        raise ApiError.bad_request("Use a mobile number that can receive SMS", details={"field": "phone"})
    return phonenumbers.format_number(p, phonenumbers.PhoneNumberFormat.E164)


def mask_phone(e164: str) -> str:
    return e164[:4] + " ••• ••• " + e164[-3:] if len(e164) > 8 else "•••"
