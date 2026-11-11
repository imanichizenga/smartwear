"""
Google Maps Platform — server-side only (the mobile binary holds just a display-restricted key).
Places Autocomplete (New) with session tokens + location bias, Place Details (closes the session),
reverse geocoding, Plus Code lookup, Routes API (cached, throttled; falls back to a geodesic estimate).
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from typing import Any

import httpx

from core import settings_service
from core.exceptions import ApiError

logger = logging.getLogger("smartwear.maps")
PLACES = "https://places.googleapis.com/v1"
GEOCODE = "https://maps.googleapis.com/maps/api/geocode/json"
ROUTES = "https://routes.googleapis.com/directions/v2:computeRoutes"
PLUS_CODE_RE = re.compile(r"^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{0,3}(\s.+)?$", re.I)
DETOUR_FACTOR = 1.32  # urban road distance vs straight line, Dar es Salaam average


def _cfg():
    return settings_service.get("maps.google")


def configured() -> bool:
    return bool(_cfg().serverApiKey)


def _require():
    if not configured():
        raise ApiError.not_configured("Google Maps", "Enter the server API key in Settings → Google Maps.")


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def _cache_get(key: str):
    try:
        v = settings_service.redis_client().get(key)
        return json.loads(v) if v else None
    except Exception:  # noqa: BLE001
        return None


def _cache_set(key: str, value: Any, ttl: int) -> None:
    try:
        settings_service.redis_client().set(key, json.dumps(value), ex=ttl)
    except Exception:  # noqa: BLE001
        pass


def autocomplete(text: str, *, session_token: str, lat: float | None, lng: float | None, language: str = "en") -> list[dict[str, Any]]:
    _require()
    cfg = _cfg()
    text = text.strip()[:120]
    if len(text) < 2:
        return []
    body: dict[str, Any] = {"input": text, "sessionToken": session_token, "languageCode": language or cfg.language, "includedRegionCodes": [cfg.regionCode]}
    if lat is not None and lng is not None:
        body["locationBias"] = {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": float(cfg.autocompleteRadiusMeters)}}
        body["origin"] = {"latitude": lat, "longitude": lng}
    try:
        r = httpx.post(f"{PLACES}/places:autocomplete", json=body, timeout=6, headers={
            "X-Goog-Api-Key": cfg.serverApiKey,
            "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.distanceMeters,suggestions.placePrediction.types",
        })
    except httpx.HTTPError as e:
        raise ApiError.upstream("Google Places", "search is unavailable right now") from e
    d = r.json() if r.content else {}
    if not r.is_success:
        raise ApiError.upstream("Google Places", (d.get("error") or {}).get("message", f"HTTP {r.status_code}"))
    out = []
    for s in d.get("suggestions", []):
        p = s.get("placePrediction")
        if not p:
            continue
        sf = p.get("structuredFormat") or {}
        main = sf.get("mainText") or p.get("text") or {}
        out.append({
            "placeId": p["placeId"], "primary": main.get("text", ""), "secondary": (sf.get("secondaryText") or {}).get("text", ""),
            "matches": [{"start": m.get("startOffset", 0), "end": m["endOffset"]} for m in main.get("matches", []) if "endOffset" in m],
            "distanceMeters": p.get("distanceMeters") or None, "types": p.get("types", [])[:3],
        })
    return out


def place_details(place_id: str, *, session_token: str | None, language: str = "en") -> dict[str, Any]:
    _require()
    cfg = _cfg()
    key = f"sw:maps:place:{place_id}:{language}"
    hit = _cache_get(key)
    if hit:
        return hit
    params = {"languageCode": language}
    if session_token:
        params["sessionToken"] = session_token
    try:
        r = httpx.get(f"{PLACES}/places/{place_id}", params=params, timeout=6, headers={"X-Goog-Api-Key": cfg.serverApiKey, "X-Goog-FieldMask": "id,displayName,formattedAddress,shortFormattedAddress,location,plusCode,addressComponents"})
    except httpx.HTTPError as e:
        raise ApiError.upstream("Google Places", "details are unavailable right now") from e
    d = r.json() if r.content else {}
    if not r.is_success:
        raise ApiError.upstream("Google Places", (d.get("error") or {}).get("message", f"HTTP {r.status_code}"))
    loc = d.get("location") or {}
    out = {
        "placeId": d.get("id", place_id), "name": (d.get("displayName") or {}).get("text", ""), "address": d.get("shortFormattedAddress") or d.get("formattedAddress", ""),
        "lat": loc.get("latitude"), "lng": loc.get("longitude"), "plusCode": (d.get("plusCode") or {}).get("globalCode", ""), "area": _area(d.get("addressComponents") or [], new_api=True),
    }
    _cache_set(key, out, 86400 * 7)
    return out


def _area(components: list[dict], new_api: bool = False) -> str:
    for want in ("sublocality_level_1", "sublocality", "neighborhood", "locality", "administrative_area_level_2"):
        for c in components:
            if want in c.get("types", []):
                return c.get("shortText" if new_api else "short_name") or c.get("longText" if new_api else "long_name", "")
    return ""


def reverse_geocode(lat: float, lng: float, language: str = "en") -> dict[str, Any]:
    """Readable label for a dropped pin. Cached on a ~11m grid."""
    _require()
    key = f"sw:maps:rev:{round(lat, 4)}:{round(lng, 4)}:{language}"
    hit = _cache_get(key)
    if hit:
        return hit
    try:
        r = httpx.get(GEOCODE, params={"latlng": f"{lat},{lng}", "key": _cfg().serverApiKey, "language": language, "result_type": "street_address|premise|point_of_interest|route|sublocality|neighborhood"}, timeout=6)
        d = r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise ApiError.upstream("Google Geocoding", "unavailable right now") from e
    if d.get("status") == "ZERO_RESULTS":
        r = httpx.get(GEOCODE, params={"latlng": f"{lat},{lng}", "key": _cfg().serverApiKey, "language": language}, timeout=6)
        d = r.json()
    if d.get("status") not in ("OK", "ZERO_RESULTS"):
        raise ApiError.upstream("Google Geocoding", f"{d.get('status')}: {d.get('error_message', '')}")
    results = d.get("results") or []
    best = results[0] if results else {}
    area = _area(best.get("address_components", []))
    label = best.get("formatted_address", "")
    if label:
        parts = [p.strip() for p in label.split(",")]
        label = ", ".join(p for p in parts[:2] if p and not p.isdigit())
    out = {"lat": lat, "lng": lng, "address": label or (d.get("plus_code") or {}).get("compound_code", "Dropped pin"), "area": area, "plusCode": (d.get("plus_code") or {}).get("global_code", ""), "placeId": best.get("place_id", "")}
    _cache_set(key, out, 86400 * 30)
    return out


def is_plus_code(text: str) -> bool:
    return bool(PLUS_CODE_RE.match(text.strip()))


def geocode_text(text: str, *, lat: float | None = None, lng: float | None = None, language: str = "en") -> dict[str, Any] | None:
    """Plus Codes ('6R2V+X5 Dar es Salaam') and free-text landmarks."""
    _require()
    params = {"address": text.strip(), "key": _cfg().serverApiKey, "language": language, "region": _cfg().regionCode}
    if lat is not None and lng is not None:
        params["bounds"] = f"{lat - 0.2},{lng - 0.2}|{lat + 0.2},{lng + 0.2}"
    try:
        d = httpx.get(GEOCODE, params=params, timeout=6).json()
    except (httpx.HTTPError, ValueError) as e:
        raise ApiError.upstream("Google Geocoding", "unavailable right now") from e
    res = (d.get("results") or [None])[0]
    if not res:
        return None
    loc = res["geometry"]["location"]
    return {"placeId": res.get("place_id", ""), "name": text.strip(), "address": res.get("formatted_address", ""), "lat": loc["lat"], "lng": loc["lng"], "area": _area(res.get("address_components", [])), "plusCode": (res.get("plus_code") or {}).get("global_code", "")}


def route(origin: tuple[float, float], dest: tuple[float, float], *, mode: str | None = None, cache: bool = True) -> dict[str, Any]:
    """Distance, duration and polyline. Cached per ~100m grid cell for `routeCacheSeconds`."""
    cfg = _cfg()
    mode = mode or cfg.routesTravelMode
    grid = lambda p: f"{round(p[0], 3)},{round(p[1], 3)}"  # noqa: E731
    key = "sw:maps:route:" + hashlib.sha1(f"{grid(origin)}>{grid(dest)}:{mode}".encode()).hexdigest()
    if cache:
        hit = _cache_get(key)
        if hit:
            return hit
    straight = haversine_m(origin, dest)
    fallback = {"distanceMeters": int(straight * DETOUR_FACTOR), "durationSeconds": int(straight * DETOUR_FACTOR / 6.5), "polyline": "", "source": "estimate"}
    if not configured():
        return fallback
    for m in ([mode, "DRIVE"] if mode != "DRIVE" else ["DRIVE"]):
        try:
            r = httpx.post(ROUTES, timeout=6, json={
                "origin": {"location": {"latLng": {"latitude": origin[0], "longitude": origin[1]}}},
                "destination": {"location": {"latLng": {"latitude": dest[0], "longitude": dest[1]}}},
                "travelMode": m, **({"routingPreference": "TRAFFIC_AWARE"} if m in ("DRIVE", "TWO_WHEELER") else {}),
            }, headers={"X-Goog-Api-Key": cfg.serverApiKey, "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline"})
            d = r.json()
            if r.is_success and d.get("routes"):
                rt = d["routes"][0]
                out = {"distanceMeters": int(rt.get("distanceMeters", 0)), "durationSeconds": int(str(rt.get("duration", "0s")).rstrip("s") or 0), "polyline": (rt.get("polyline") or {}).get("encodedPolyline", ""), "source": "routes", "mode": m}
                _cache_set(key, out, cfg.routeCacheSeconds)
                return out
            logger.info("routes %s failed: %s", m, (d.get("error") or {}).get("message"))
        except (httpx.HTTPError, ValueError) as e:
            logger.warning("routes error: %s", e)
    return fallback
