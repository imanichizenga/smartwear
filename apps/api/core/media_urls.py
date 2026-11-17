"""Render a Media row into the MediaOut shape shared with the apps (packages/shared/src/schemas/common.ts)."""
from __future__ import annotations

from typing import Any


def media_out(m, *, role: str | None = None, alt: str | None = None) -> dict[str, Any] | None:
    if m is None:
        return None
    from media.storage import public_url

    variants = m.variants or []
    sources: dict[str, list[dict[str, Any]]] = {}
    url = ""
    poster = preview = hls = None
    if m.type == "IMAGE":
        for v in variants:
            if v.get("format") in ("avif", "webp", "jpeg") and v.get("label") != "master":
                sources.setdefault(v["format"], []).append({"width": v["width"], "url": public_url(v["key"])})
        for fmt in sources:
            sources[fmt].sort(key=lambda s: s["width"])
        jpeg = sources.get("jpeg") or sources.get("webp") or []
        mid = [s for s in jpeg if s["width"] >= 960]
        url = (mid[0] if mid else (jpeg[-1] if jpeg else {"url": ""}))["url"]
    elif m.type == "VIDEO":
        mp4s = sorted([v for v in variants if v.get("format") == "mp4" and v.get("label") not in ("preview",)], key=lambda v: v["height"])
        # Progressive fallback (players without HLS, older app builds): the 540p rung streams smoothly on
        # mobile networks; the adaptive playlist below is preferred and climbs to 720p/1080p when bandwidth allows.
        short = [v for v in mp4s if min(v["width"], v["height"]) <= 540] or mp4s
        url = public_url(short[-1]["key"]) if short else ""
        sources["mp4"] = [{"width": v["width"], "url": public_url(v["key"])} for v in mp4s]
        for v in variants:
            if v.get("label") == "poster":
                poster = public_url(v["key"])
            elif v.get("label") == "preview":
                preview = public_url(v["key"])
        if m.status == "READY" and any(str(v.get("label", "")).startswith("hls-") for v in variants):
            from django.conf import settings

            hls = f"{settings.PUBLIC_API_URL.rstrip('/')}/v1/media/{m.id}/hls.m3u8"
    else:
        m4a = [v for v in variants if v.get("format") == "m4a"]
        url = public_url(m4a[0]["key"]) if m4a else ""
    if not url and m.status != "READY":
        url = ""
    return {
        "id": str(m.id),
        "type": m.type,
        "status": m.status,
        "url": url,
        "sources": sources or None,
        "posterUrl": poster,
        "previewUrl": preview,
        "hlsUrl": hls,
        "blurhash": m.blurhash or None,
        "thumbhash": m.thumbhash or None,
        "dominantColor": m.dominant_color or None,
        "width": m.width,
        "height": m.height,
        "durationMs": m.duration_ms,
        "waveform": m.waveform,
        "alt": alt if alt is not None else (m.alt or None),
        "focalX": m.focal_x,
        "focalY": m.focal_y,
        "role": role,
    }
