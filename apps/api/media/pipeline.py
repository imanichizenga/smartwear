"""
Media processing (runs in the Celery `media` queue).

Images  libvips: autorotate, sRGB, strip all metadata (EXIF/GPS), master ≤ 2400px, focal-point crop to 4:5 for
        product imagery, AVIF + WebP + JPEG at 320/640/960/1280/1920, BlurHash + ThumbHash, dominant colour,
        sharpness (variance of Laplacian) for the blur hint. Never composites text/badges onto pixels.
Video   ffmpeg: H.264/AAC MP4 at 720p/1080p (capped bitrate, faststart, no metadata), HLS for long clips,
        poster frame, short muted preview loop for the feed.
Audio   ffmpeg: denoise + gate + EBU R128 loudness → AAC .m4a, waveform peaks JSON.
Keys    content-hashed and immutable: media/<yyyy>/<mm>/<sha12>/<label>.<ext>
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import pyvips
from django.utils import timezone

from core import settings_service

from . import storage
from .models import Media
from .thumbhash import encode_b64 as thumbhash_b64

logger = logging.getLogger("smartwear.media")

PRODUCT_PURPOSES = {"product", "look", "review"}
CROP_45_PURPOSES = {"product"}
SQUARE_PURPOSES = {"avatar", "rider_photo", "brand"}


class PipelineError(Exception):
    pass


# ---------------------------------------------------------------- magic bytes
def sniff(head: bytes) -> tuple[str, str] | None:
    """(type, mime) from the first bytes — never trust the client's Content-Type."""
    if head[:3] == b"\xff\xd8\xff":
        return "IMAGE", "image/jpeg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "IMAGE", "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "IMAGE", "image/webp"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "AUDIO", "audio/wav"
    if head[:4] == b"OggS":
        return "AUDIO", "audio/ogg"
    if head[:3] == b"ID3" or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "AUDIO", "audio/mpeg"
    if head[:4] == b"fLaC":
        return "AUDIO", "audio/flac"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "VIDEO", "video/webm"  # also audio-only webm from MediaRecorder; resolved by ffprobe
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in (b"avif", b"avis"):
            return "IMAGE", "image/avif"
        if brand in (b"heic", b"heix", b"mif1", b"msf1", b"hevc"):
            return "IMAGE", "image/heic"
        if brand in (b"M4A ", b"M4B "):
            return "AUDIO", "audio/mp4"
        return "VIDEO", "video/mp4" if brand != b"qt  " else "video/quicktime"
    return None


def _hash_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _key(m: Media, sha: str, label: str, ext: str) -> str:
    d = m.created_at or timezone.now()
    return f"{storage.key_prefix()}/{d:%Y/%m}/{sha[:12]}{str(m.id)[:4]}/{label}.{ext}"


# ---------------------------------------------------------------- images
def _focal_crop(img: pyvips.Image, aspect: float, fx: float, fy: float) -> pyvips.Image:
    w, h = img.width, img.height
    if abs(w / h - aspect) < 0.005:
        return img
    if w / h > aspect:
        cw, ch = round(h * aspect), h
    else:
        cw, ch = w, round(w / aspect)
    left = min(max(0, round(fx * w - cw / 2)), w - cw)
    top = min(max(0, round(fy * h - ch / 2)), h - ch)
    return img.crop(left, top, cw, ch)


def _sharpness(img: pyvips.Image) -> float:
    """Variance of the Laplacian on a 512px greyscale copy — low values mean soft/blurry."""
    g = img.colourspace("b-w").thumbnail_image(512) if img.width > 512 else img.colourspace("b-w")
    if g.bands > 1:
        g = g[0]
    lap = pyvips.Image.new_from_array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], scale=1)
    return float(g.cast("float").conv(lap, precision="float").deviate() ** 2)


def _auto_enhance(img: pyvips.Image) -> pyvips.Image:
    """Gentle exposure + grey-world white balance; never stylises."""
    lab = img.colourspace("lab")
    l_, a, b = lab[0], lab[1], lab[2]
    mean_l = l_.avg()
    gain = max(0.92, min(1.1, 58 / max(mean_l, 1)))
    a = a - a.avg() * 0.6
    b = b - b.avg() * 0.6
    out = (l_ * gain).bandjoin([a, b]).copy(interpretation="lab").colourspace("srgb")
    return out.cast("uchar")


def _background_cleanup(path: str, opts: dict) -> str | None:
    cfg = settings_service.get("media").backgroundCleanup
    if cfg.provider == "none":
        return None
    import httpx

    with open(path, "rb") as f:
        data = f.read()
    try:
        if cfg.provider == "removebg":
            r = httpx.post("https://api.remove.bg/v1.0/removebg", headers={"X-Api-Key": cfg.apiKey}, files={"image_file": ("in.jpg", data)}, data={"size": "auto", "bg_color": cfg.studioBackground.lstrip("#"), "format": "png"}, timeout=60)
        else:
            r = httpx.post(cfg.endpoint, files={"image": ("in.jpg", data)}, data={"background": cfg.studioBackground}, timeout=90)
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise PipelineError(f"Background clean-up failed: {e}") from e
    out = path + ".clean.png"
    Path(out).write_bytes(r.content)
    return out


def process_image(m: Media, src: str, work: str) -> dict[str, Any]:
    ms = settings_service.get("media")
    opts = m.options or {}
    if opts.get("backgroundCleanup"):
        cleaned = _background_cleanup(src, opts)
        if cleaned:
            src = cleaned
    try:
        img = pyvips.Image.new_from_file(src, access="sequential" if not opts.get("crop") and not opts.get("rotate") else "random")
    except pyvips.Error as e:
        raise PipelineError(f"Not a readable image: {str(e).splitlines()[0]}") from e
    img = img.autorot()
    if img.interpretation not in ("srgb", "b-w"):
        try:
            img = img.icc_transform("srgb") if img.get_typeof("icc-profile-data") else img.colourspace("srgb")
        except pyvips.Error:
            img = img.colourspace("srgb")
    if img.hasalpha() and m.purpose in PRODUCT_PURPOSES:
        bg = [int(ms.backgroundCleanup.studioBackground[i : i + 2], 16) for i in (1, 3, 5)]
        img = img.flatten(background=bg)
    if img.bands == 1:
        img = img.colourspace("srgb")
    if opts.get("rotate"):
        img = img.rotate(float(opts["rotate"]) % 360) if float(opts["rotate"]) % 90 else img.rot(f"d{int(opts['rotate']) % 360}")
    if opts.get("crop"):
        c = opts["crop"]
        img = img.crop(int(c["x"]), int(c["y"]), min(int(c["width"]), img.width - int(c["x"])), min(int(c["height"]), img.height - int(c["y"])))
    if opts.get("autoEnhance"):
        img = _auto_enhance(img)
    orig_w, orig_h = img.width, img.height
    if max(img.width, img.height) > ms.imageMasterMaxEdge:
        img = img.thumbnail_image(ms.imageMasterMaxEdge, height=ms.imageMasterMaxEdge, size="down")
    if m.purpose in CROP_45_PURPOSES:
        img = _focal_crop(img, 4 / 5, m.focal_x, m.focal_y)
    elif m.purpose in SQUARE_PURPOSES:
        img = _focal_crop(img, 1, m.focal_x, m.focal_y)
    img = img.copy_memory()
    sharp = _sharpness(img)
    sha = hashlib.sha256(img.write_to_buffer(".png[compression=1]")).hexdigest()
    variants: list[dict[str, Any]] = []
    master_key = _key(m, sha, "master", "jpg")
    master = img.write_to_buffer(".jpg", Q=92, strip=True, optimize_coding=True, interlace=True)
    storage.put_bytes(master_key, master, "image/jpeg")
    variants.append({"width": img.width, "height": img.height, "format": "jpeg", "key": master_key, "bytes": len(master), "label": "master"})
    widths = sorted({w for w in ms.imageWidths if w < img.width} | ({img.width} if img.width < max(ms.imageWidths) else set()))
    for w in widths:
        im = img.thumbnail_image(w) if w < img.width else img
        for fmt, ext, mime, kwargs in (
            ("avif", "avif", "image/avif", {"Q": ms.avifQuality, "effort": 4, "strip": True}),
            ("webp", "webp", "image/webp", {"Q": ms.webpQuality, "effort": 4, "smart_subsample": True, "strip": True}),
            ("jpeg", "jpg", "image/jpeg", {"Q": ms.jpegQuality, "strip": True, "optimize_coding": True, "interlace": True, "trellis_quant": True}),
        ):
            buf = im.write_to_buffer(f".{ext}", **kwargs)
            key = _key(m, sha, f"w{w}", ext)
            storage.put_bytes(key, buf, mime)
            variants.append({"width": im.width, "height": im.height, "format": fmt, "key": key, "bytes": len(buf), "label": f"w{w}"})
    # Placeholders + dominant colour from a tiny copy
    tiny = img.thumbnail_image(32)
    from PIL import Image as PILImage
    import blurhash

    pil = PILImage.open(io.BytesIO(tiny.write_to_buffer(".png")))
    bh = blurhash.encode(pil.convert("RGB"), 4, 5 if img.height > img.width else 3)
    th_img = img.thumbnail_image(100, height=100)
    if not th_img.hasalpha():
        th_img = th_img.bandjoin(255)
    th = thumbhash_b64(th_img.width, th_img.height, bytes(th_img.cast("uchar").write_to_memory()))
    avg = img.thumbnail_image(1).getpoint(0, 0)
    dominant = "#{:02X}{:02X}{:02X}".format(*(int(x) for x in avg[:3]))
    return {
        "width": img.width, "height": img.height, "variants": variants, "blurhash": bh, "thumbhash": th, "dominant_color": dominant, "sha256": sha,
        "quality": {"sharpness": round(sharp, 1), "blurry": sharp < 60, "originalWidth": orig_w, "originalHeight": orig_h, "lowResolution": min(orig_w, orig_h) < 1000},
    }


# ---------------------------------------------------------------- video / audio helpers
def _run(cmd: list[str], timeout: int = 900) -> str:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as e:
        raise PipelineError(f"{cmd[0]} timed out") from e
    if r.returncode != 0:
        raise PipelineError(f"{cmd[0]} failed: {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else r.returncode}")
    return r.stdout


def probe(path: str) -> dict:
    out = _run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], timeout=60)
    return json.loads(out)


def _streams(info: dict, kind: str) -> list[dict]:
    return [s for s in info.get("streams", []) if s.get("codec_type") == kind]


def process_video(m: Media, src: str, work: str) -> dict[str, Any]:
    ms = settings_service.get("media")
    info = probe(src)
    v = _streams(info, "video")
    if not v:
        raise PipelineError("No video stream found")
    vs = v[0]
    rot = 0
    for sd in vs.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = abs(int(sd["rotation"]))
    w, h = int(vs["width"]), int(vs["height"])
    if rot in (90, 270):
        w, h = h, w
    duration = float(info.get("format", {}).get("duration") or vs.get("duration") or 0)
    has_audio = bool(_streams(info, "audio"))
    trim = (m.options or {}).get("trim") or {}
    ss = ["-ss", f"{trim['startMs'] / 1000:.3f}"] if trim.get("startMs") else []
    to = ["-to", f"{trim['endMs'] / 1000:.3f}"] if trim.get("endMs") else []
    if trim:
        duration = ((trim.get("endMs") or duration * 1000) - (trim.get("startMs") or 0)) / 1000
    sha = _hash_file(src)
    variants: list[dict[str, Any]] = []
    short_edge = min(w, h)
    targets = [r for r in ms.videoResolutions if r <= short_edge] or [min(ms.videoResolutions)]
    for res in targets:
        out = os.path.join(work, f"{res}.mp4")
        scale = f"scale=-2:{res}" if w >= h else f"scale={res}:-2"
        rate = int(ms.videoMaxBitrateKbps * (res / 1080) ** 1.4)
        cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *ss, "-i", src, *to, "-map_metadata", "-1", "-map", "0:v:0", *(["-map", "0:a:0"] if has_audio else []),
               "-vf", f"{scale},fps=fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-profile:v", "high", "-crf", "23",
               "-maxrate", f"{rate}k", "-bufsize", f"{rate * 2}k", "-movflags", "+faststart",
               *(["-c:a", "aac", "-b:a", "128k", "-ac", "2"] if has_audio else ["-an"]), out]
        _run(cmd)
        pi = _streams(probe(out), "video")[0]
        key = _key(m, sha, f"{res}p", "mp4")
        storage.upload_file(out, key, "video/mp4")
        variants.append({"width": int(pi["width"]), "height": int(pi["height"]), "format": "mp4", "key": key, "bytes": os.path.getsize(out), "label": f"{res}p"})
    # Poster
    poster_at = ((m.options or {}).get("posterAtMs") or min(1000, int(duration * 500))) / 1000
    poster = os.path.join(work, "poster.jpg")
    _run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{poster_at:.3f}", *([] if not ss else []), "-i", src, "-frames:v", "1", "-q:v", "3", "-map_metadata", "-1", poster])
    pimg = pyvips.Image.new_from_file(poster)
    if max(pimg.width, pimg.height) > 1280:
        pimg = pimg.thumbnail_image(1280, height=1280)
    pbuf = pimg.write_to_buffer(".jpg", Q=80, strip=True, interlace=True)
    pkey = _key(m, sha, "poster", "jpg")
    storage.put_bytes(pkey, pbuf, "image/jpeg")
    variants.append({"width": pimg.width, "height": pimg.height, "format": "jpeg", "key": pkey, "bytes": len(pbuf), "label": "poster"})
    # Muted preview loop for the feed
    prev = os.path.join(work, "preview.mp4")
    pl = min(ms.previewLoopSeconds, max(1, duration))
    _run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *ss, "-i", src, "-t", f"{pl:.2f}", "-an", "-map_metadata", "-1", "-vf", ("scale=-2:540" if w >= h else "scale=540:-2") + ",fps=fps=24,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-movflags", "+faststart", prev])
    prkey = _key(m, sha, "preview", "mp4")
    storage.upload_file(prev, prkey, "video/mp4")
    variants.append({"width": 540 if w < h else round(540 * w / h), "height": round(540 * h / w) if w < h else 540, "format": "mp4", "key": prkey, "bytes": os.path.getsize(prev), "label": "preview"})
    # HLS for longer clips
    if duration >= ms.hlsMinDurationSeconds:
        hls_dir = os.path.join(work, "hls")
        os.makedirs(hls_dir, exist_ok=True)
        top = os.path.join(work, f"{targets[-1]}.mp4")
        _run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", top, "-c", "copy", "-hls_time", "4", "-hls_playlist_type", "vod", "-hls_segment_filename", os.path.join(hls_dir, "seg_%03d.ts"), os.path.join(hls_dir, "index.m3u8")])
        base = _key(m, sha, "hls", "m3u8").rsplit("/", 1)[0] + "/hls"
        for fn in sorted(os.listdir(hls_dir)):
            storage.upload_file(os.path.join(hls_dir, fn), f"{base}/{fn}", "application/vnd.apple.mpegurl" if fn.endswith(".m3u8") else "video/mp2t")
        variants.append({"width": variants[-4]["width"] if len(variants) >= 4 else w, "height": h, "format": "m3u8", "key": f"{base}/index.m3u8", "bytes": 0, "label": "hls"})
    tiny = pimg.thumbnail_image(32)
    from PIL import Image as PILImage
    import blurhash

    bh = blurhash.encode(PILImage.open(io.BytesIO(tiny.write_to_buffer(".png"))).convert("RGB"), 4, 3)
    return {"width": w, "height": h, "duration_ms": int(duration * 1000), "variants": variants, "blurhash": bh, "sha256": sha}


def waveform_peaks(path: str, buckets: int = 96) -> list[float]:
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], capture_output=True, check=True, timeout=120).stdout
    import array

    samples = array.array("h")
    samples.frombytes(raw[: len(raw) - len(raw) % 2])
    if not samples:
        return [0.0] * buckets
    size = max(1, len(samples) // buckets)
    peaks = [max((abs(x) for x in samples[i * size : (i + 1) * size]), default=0) for i in range(buckets)]
    top = max(peaks) or 1
    return [round(p / top, 3) for p in peaks]


def process_audio(m: Media, src: str, work: str) -> dict[str, Any]:
    ms = settings_service.get("media")
    info = probe(src)
    if not _streams(info, "audio"):
        raise PipelineError("No audio stream found")
    trim = (m.options or {}).get("trim") or {}
    ss = ["-ss", f"{trim['startMs'] / 1000:.3f}"] if trim.get("startMs") else []
    to = ["-to", f"{trim['endMs'] / 1000:.3f}"] if trim.get("endMs") else []
    out = os.path.join(work, "note.m4a")
    filters = f"highpass=f=70,afftdn=nf=-25,agate=threshold=0.015:ratio=2:attack=10:release=250,loudnorm=I={ms.audioLoudnessLufs}:TP=-1.5:LRA=11"
    _run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *ss, "-i", src, *to, "-vn", "-map_metadata", "-1", "-af", filters, "-ar", "44100", "-ac", "1", "-c:a", "aac", "-b:a", f"{ms.audioBitrateKbps}k", "-movflags", "+faststart", out])
    dur = float(probe(out).get("format", {}).get("duration") or 0)
    sha = _hash_file(out)
    key = _key(m, sha, "audio", "m4a")
    storage.upload_file(out, key, "audio/mp4")
    return {"duration_ms": int(dur * 1000), "variants": [{"width": 0, "height": 0, "format": "m4a", "key": key, "bytes": os.path.getsize(out), "label": "aac"}], "waveform": waveform_peaks(out), "sha256": sha}


# ---------------------------------------------------------------- entry point
def process(media_id: str) -> Media:
    m = Media.objects.get(id=media_id)
    work = tempfile.mkdtemp(prefix="sw-media-")
    try:
        Media.objects.filter(id=m.id).update(status="PROCESSING", error="")
        src = os.path.join(work, "source")
        storage.download(m.original_key, src)
        with open(src, "rb") as f:
            head = f.read(64)
        sniffed = sniff(head)
        if sniffed is None:
            raise PipelineError("Unsupported file type")
        kind, mime = sniffed
        if kind == "VIDEO" and m.type == "AUDIO":
            kind = "AUDIO"  # MediaRecorder audio/webm
        if kind != m.type:
            raise PipelineError(f"File content is {kind.lower()}, but it was uploaded as {m.type.lower()}")
        old_keys = [v["key"] for v in (m.variants or [])]
        result = {"IMAGE": process_image, "VIDEO": process_video, "AUDIO": process_audio}[m.type](m, src, work)
        for k in ("width", "height", "duration_ms", "variants", "blurhash", "thumbhash", "dominant_color", "waveform", "sha256", "quality"):
            if k in result:
                setattr(m, k, result[k])
        m.bytes = os.path.getsize(src)
        m.content_type = mime
        m.status = "READY"
        m.processed_at = timezone.now()
        m.error = ""
        m.save()
        stale = [k for k in old_keys if k not in {v["key"] for v in m.variants}]
        if stale:
            try:
                storage.delete(stale)
            except Exception:  # noqa: BLE001
                logger.warning("could not delete stale renditions for %s", m.id)
        _after_ready(m)
        return m
    except PipelineError as e:
        Media.objects.filter(id=m.id).update(status="FAILED", error=str(e)[:2000])
        logger.warning("media %s failed: %s", m.id, e)
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _after_ready(m: Media) -> None:
    """Products whose publish depends on media, and the realtime admin editor, learn the media is ready."""
    from catalog.models import ProductMedia

    try:
        from notifications.realtime import broadcast

        broadcast("media", {"type": "media.ready", "mediaId": str(m.id), "status": m.status})
    except Exception:  # noqa: BLE001
        pass
    for pid in ProductMedia.objects.filter(media=m).values_list("product_id", flat=True):
        from catalog.models import Product
        from catalog.services.products import refresh_denormalised

        p = Product.objects.filter(id=pid).first()
        if p:
            refresh_denormalised(p)
