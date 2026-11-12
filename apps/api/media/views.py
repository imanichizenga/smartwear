from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from core import ratelimit, settings_service
from core.audit import audit
from core.exceptions import ApiError
from core.media_urls import media_out
from core.pagination import keyset, page_params

from . import storage
from .models import Media
from .pipeline import sniff

ALLOWED = {
    "IMAGE": {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"},
    "VIDEO": {"video/mp4", "video/quicktime", "video/webm"},
    "AUDIO": {"audio/webm", "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/aac", "audio/flac"},
}
CUSTOMER_PURPOSES = {"avatar", "review", "wholesale_licence", "chat"}
RIDER_PURPOSES = CUSTOMER_PURPOSES | {"proof", "rider_photo"}
MULTIPART_THRESHOLD = 50 * 1024 * 1024
PART_SIZE = 16 * 1024 * 1024


def _principal(request):
    p = request.user
    if p is None:
        raise ApiError.unauthorized("Sign in to upload")
    return p


def _safe_name(name: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", name or "file").strip("-.")[:80] or "file"
    return base


class PresignView(APIView):
    def post(self, request):
        p = _principal(request)
        d = request.data or {}
        mtype = d.get("type")
        ctype = (d.get("contentType") or "").lower().split(";")[0].strip()
        size = int(d.get("bytes") or 0)
        purpose = d.get("purpose") or "product"
        if mtype not in ALLOWED:
            raise ApiError.bad_request("type must be IMAGE, VIDEO or AUDIO")
        if ctype not in ALLOWED[mtype]:
            raise ApiError.bad_request(f"{ctype or 'This file type'} isn't supported for {mtype.lower()}", details={"allowed": sorted(ALLOWED[mtype])})
        if purpose not in dict(Media.PURPOSES):
            raise ApiError.bad_request("Unknown purpose")
        if p.kind == "customer" and purpose not in CUSTOMER_PURPOSES or p.kind == "rider" and purpose not in RIDER_PURPOSES:
            raise ApiError.forbidden("You can't upload that kind of file")
        if p.kind == "admin" and not p.admin.has_perm_key("products.manage") and purpose in ("product", "look", "story", "brand", "category", "collection"):
            raise ApiError.forbidden("Your role can't upload catalog media")
        if p.kind != "admin" and mtype == "VIDEO":
            raise ApiError.forbidden("Video uploads are for the SmartWear team")
        cfg = settings_service.get("storage.s3")
        limit = {"IMAGE": cfg.maxImageBytes, "VIDEO": cfg.maxVideoBytes, "AUDIO": cfg.maxAudioBytes}[mtype]
        if p.kind != "admin":
            limit = min(limit, 15 * 1024 * 1024)
        if size <= 0 or size > limit:
            raise ApiError.bad_request(f"Files up to {limit // (1024 * 1024)} MB", details={"maxBytes": limit})
        ratelimit.enforce("upload", p.id, 600 if p.kind == "admin" else 40, 3600)
        mid = uuid.uuid4()
        now = timezone.now()
        key = f"{storage.key_prefix()}/uploads/{purpose}/{now:%Y/%m}/{mid}/{_safe_name(d.get('fileName') or 'upload')}"
        opts = d.get("options") or {}
        clean_opts = {k: opts[k] for k in ("backgroundCleanup", "autoEnhance", "role") if k in opts}
        m = Media(
            id=mid, type=mtype, purpose=purpose, original_key=key, original_name=(d.get("fileName") or "")[:200], content_type=ctype, declared_bytes=size,
            options=clean_opts, focal_x=float(opts.get("focalX", 0.5)), focal_y=float(opts.get("focalY", 0.5)), alt=(d.get("alt") or "")[:200],
            owner_admin=p.admin if p.kind == "admin" else None, owner_user=p.user if p.kind != "admin" else None,
        )
        multipart = d.get("multipart") or size > MULTIPART_THRESHOLD
        body = {"mediaId": str(mid), "key": key, "single": None, "multipart": None}
        if multipart:
            upload_id = storage.create_multipart(key, ctype)
            m.multipart_upload_id = upload_id
            n = (size + PART_SIZE - 1) // PART_SIZE
            if n > 10000:
                raise ApiError.bad_request("File is too large")
            body["multipart"] = {"uploadId": upload_id, "partSizeBytes": PART_SIZE, "parts": [{"partNumber": i, "url": storage.presign_part(key, upload_id, i)} for i in range(1, n + 1)], "expiresAt": (now + timedelta(hours=1)).isoformat()}
        else:
            post = storage.presign_post(key, ctype, limit)
            body["single"] = {"method": "POST", "url": post["url"], "fields": post["fields"], "expiresAt": datetime.fromtimestamp(post["expiresAt"], tz=UTC).isoformat()}
        m.save()
        return Response(body, status=201)


def _owned(request, media_id) -> Media:
    p = _principal(request)
    m = Media.objects.filter(id=media_id, deleted_at__isnull=True).first()
    if m is None:
        raise ApiError.not_found("Media")
    if p.kind == "admin" or (m.owner_user_id and p.user and m.owner_user_id == p.user.id):
        return m
    raise ApiError.not_found("Media")


class CompleteUploadView(APIView):
    def post(self, request):
        m = _owned(request, (request.data or {}).get("mediaId"))
        if m.status not in ("UPLOADING", "FAILED"):
            return Response(media_out(m))
        if m.multipart_upload_id:
            parts = request.data.get("parts") or []
            if not parts:
                raise ApiError.bad_request("Send the uploaded part ETags")
            storage.complete_multipart(m.original_key, m.multipart_upload_id, parts)
        head = storage.head(m.original_key)
        if head is None:
            raise ApiError.bad_request("We couldn't find the uploaded file. Try uploading again.")
        size = int(head.get("ContentLength") or 0)
        cfg = settings_service.get("storage.s3")
        limit = {"IMAGE": cfg.maxImageBytes, "VIDEO": cfg.maxVideoBytes, "AUDIO": cfg.maxAudioBytes}[m.type]
        sniffed = sniff(storage.read_range(m.original_key, 0, 63))
        ok_type = sniffed is not None and (sniffed[0] == m.type or (m.type == "AUDIO" and sniffed[1] == "video/webm"))
        if size > limit or not ok_type:
            storage.delete([m.original_key])
            Media.objects.filter(id=m.id).update(status="FAILED", error="File is larger than allowed" if size > limit else "File contents don't match its type")
            raise ApiError.bad_request("That file isn't a supported " + m.type.lower() if not ok_type else "File is too large")
        m.bytes, m.status, m.multipart_upload_id = size, "UPLOADED", ""
        opts = (request.data or {}).get("options")
        if isinstance(opts, dict):
            # In-browser recordings send their trim with the upload so the first pass already cuts it.
            trim = opts.get("trim")
            if isinstance(trim, dict) and all(isinstance(trim.get(k, 0), (int, float)) and trim.get(k, 0) >= 0 for k in ("startMs", "endMs")):
                m.options = {**(m.options or {}), "trim": {k: int(trim[k]) for k in ("startMs", "endMs") if trim.get(k)}}
        m.save(update_fields=["bytes", "status", "multipart_upload_id", "options", "updated_at"])
        from .tasks import process_media

        process_media.delay(str(m.id))
        return Response(media_out(m) | {"originalName": m.original_name})


class MediaListView(APIView):
    def get(self, request):
        p = _principal(request)
        if p.kind != "admin":
            raise ApiError.forbidden()
        cursor, limit = page_params(request, 40, 100)
        qs = Media.objects.filter(deleted_at__isnull=True)
        q = request.query_params
        if q.get("type"):
            qs = qs.filter(type=q["type"])
        if q.get("purpose"):
            qs = qs.filter(purpose=q["purpose"])
        if q.get("status"):
            qs = qs.filter(status=q["status"])
        if q.get("q"):
            qs = qs.filter(Q(original_name__icontains=q["q"]) | Q(alt__icontains=q["q"]))
        rows, nxt = keyset(qs, ["-created_at", "-id"], cursor, limit)
        return Response({"items": [media_out(m) | {"originalName": m.original_name, "purpose": m.purpose, "bytes": m.bytes, "error": m.error or None, "quality": m.quality, "createdAt": m.created_at.isoformat()} for m in rows], "nextCursor": nxt})


class MediaDetailView(APIView):
    def get(self, request, media_id):
        m = _owned(request, media_id)
        return Response(media_out(m) | {"originalName": m.original_name, "purpose": m.purpose, "bytes": m.bytes, "error": m.error or None, "quality": m.quality, "options": m.options, "renditions": [{"label": v.get("label"), "format": v["format"], "width": v["width"], "height": v["height"], "bytes": v["bytes"]} for v in m.variants]})

    def patch(self, request, media_id):
        m = _owned(request, media_id)
        d = request.data or {}
        reprocess = bool(d.get("reprocess"))
        if "alt" in d:
            m.alt = (d["alt"] or "")[:200]
        for k in ("focalX", "focalY"):
            if k in d:
                v = float(d[k])
                if not 0 <= v <= 1:
                    raise ApiError.bad_request("Focal point must be between 0 and 1")
                setattr(m, "focal_x" if k == "focalX" else "focal_y", v)
                reprocess = reprocess or m.type == "IMAGE"
        opts = dict(m.options or {})
        for k in ("rotate", "crop", "posterAtMs", "trim", "backgroundCleanup", "autoEnhance"):
            if k in d:
                opts[k] = d[k]
                reprocess = True
        m.options = opts
        m.save()
        if reprocess and m.status in ("READY", "FAILED"):
            from .tasks import process_media

            Media.objects.filter(id=m.id).update(status="PROCESSING")
            process_media.delay(str(m.id))
            m.status = "PROCESSING"
        return Response(media_out(m))

    def delete(self, request, media_id):
        m = _owned(request, media_id)
        if m.product_links.exists():
            raise ApiError.conflict("in_use", "This file is used by a product. Remove it from the product first.")
        m.deleted_at = timezone.now()
        m.save(update_fields=["deleted_at"])
        audit("media.delete", "media", m.id, request=request)
        from .tasks import purge_media

        purge_media.delay(str(m.id))
        return Response({"ok": True})


class EnhancePreviewView(APIView):
    """Before/after preview of the light auto-enhance so admins can decide before applying."""

    def post(self, request, media_id):
        m = _owned(request, media_id)
        if m.type != "IMAGE" or m.status != "READY":
            raise ApiError.bad_request("Preview is available for processed images")
        import base64
        import tempfile

        import pyvips

        from .pipeline import _auto_enhance

        src = next((v for v in m.variants if v.get("label") == "w640" and v["format"] == "jpeg"), None) or next(v for v in m.variants if v["format"] == "jpeg")
        with tempfile.NamedTemporaryFile(suffix=".jpg") as f:
            storage.download(src["key"], f.name)
            img = pyvips.Image.new_from_file(f.name)
            out = _auto_enhance(img).write_to_buffer(".jpg", Q=82, strip=True)
        return Response({"before": media_out(m)["url"], "after": "data:image/jpeg;base64," + base64.b64encode(out).decode()})
