"""Real pipeline runs (libvips + ffmpeg) against the docker-compose S3 store."""
from __future__ import annotations

import os
import socket
import subprocess
import tempfile
import uuid

import pytest

from core import settings_service
from media.models import Media
from media.pipeline import PipelineError, process, sniff

pytestmark = pytest.mark.django_db


@pytest.fixture
def s3(admin_user):
    try:
        socket.create_connection(("localhost", 9000), timeout=1).close()
    except OSError:
        pytest.skip("local S3 not running")
    import boto3

    c = boto3.client("s3", endpoint_url="http://localhost:9000", aws_access_key_id="smartwear", aws_secret_access_key="smartwear-secret", region_name="us-east-1")
    try:
        c.create_bucket(Bucket="smartwear-test")
    except Exception:  # noqa: BLE001
        pass
    settings_service.update("storage.s3", {"provider": "s3_compatible", "bucket": "smartwear-test", "region": "us-east-1", "accessKeyId": "smartwear", "secretAccessKey": "smartwear-secret", "endpoint": "http://localhost:9000", "forcePathStyle": True}, admin=admin_user)
    return c


def _upload(c, path: str, mtype: str, ctype: str, purpose: str = "product") -> Media:
    key = f"media/uploads/test/{uuid.uuid4()}/{os.path.basename(path)}"
    c.upload_file(path, "smartwear-test", key)
    return Media.objects.create(type=mtype, purpose=purpose, status="UPLOADED", original_key=key, content_type=ctype, bytes=os.path.getsize(path))


def test_image_pipeline(s3):
    import pyvips

    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "dress.jpg")
        # 3000×2000 landscape with EXIF orientation 6 and fake GPS — must be rotated, stripped and cropped to 4:5
        img = pyvips.Image.xyz(3000, 2000)[0].cast("uchar").bandjoin([pyvips.Image.xyz(3000, 2000)[1].cast("uchar"), (pyvips.Image.black(3000, 2000) + 180).cast("uchar")]).copy(interpretation="srgb")
        img = img.copy()
        img.set_type(pyvips.GValue.gint_type, "orientation", 6)
        img.write_to_file(src, Q=90)
        m = _upload(s3, src, "IMAGE", "image/jpeg")
        m = process(str(m.id))
    assert m.status == "READY"
    assert abs(m.width / m.height - 0.8) < 0.01  # 4:5
    formats = {(v["format"], v["label"]) for v in m.variants}
    for w in (320, 640, 960, 1280):
        assert ("avif", f"w{w}") in formats and ("webp", f"w{w}") in formats and ("jpeg", f"w{w}") in formats
    thumb = next(v for v in m.variants if v["label"] == "w320" and v["format"] == "avif")
    assert thumb["bytes"] < 60_000
    assert m.blurhash and m.thumbhash and m.dominant_color.startswith("#")
    master = next(v for v in m.variants if v["label"] == "master")
    body = s3.get_object(Bucket="smartwear-test", Key=master["key"])
    assert body["CacheControl"] == "public, max-age=31536000, immutable"
    data = body["Body"].read()
    assert b"Exif" not in data[:2000] and b"GPS" not in data
    import pyvips as v2

    assert v2.Image.new_from_buffer(data, "").get_typeof("orientation") == 0 or v2.Image.new_from_buffer(data, "").get("orientation") == 1


def test_video_pipeline(s3):
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "look.mov")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "3", "-metadata", "location=+06.77-039.24/", "-c:v", "libx264", "-c:a", "aac", "-shortest", "-f", "mov", src], check=True)
        m = _upload(s3, src, "VIDEO", "video/quicktime", purpose="look")
        m = process(str(m.id))
    assert m.status == "READY" and 2900 <= m.duration_ms <= 3200
    labels = {v["label"] for v in m.variants}
    assert {"720p", "1080p", "poster", "preview"} <= labels
    p720 = next(v for v in m.variants if v["label"] == "720p")
    assert (p720["width"], p720["height"]) == (720, 1280)


def test_audio_pipeline_from_browser_recording(s3):
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "note.webm")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=4", "-f", "lavfi", "-i", "anoisesrc=d=4:a=0.02", "-filter_complex", "amix=inputs=2", "-c:a", "libopus", src], check=True)
        m = _upload(s3, src, "AUDIO", "audio/webm")
        m = process(str(m.id))
    assert m.status == "READY" and 3800 <= m.duration_ms <= 4200
    assert m.variants[0]["format"] == "m4a" and len(m.waveform) == 96 and max(m.waveform) == 1.0


def test_type_mismatch_rejected(s3):
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "fake.jpg")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=duration=1", src.replace(".jpg", ".wav")], check=True)
        os.rename(src.replace(".jpg", ".wav"), src)
        m = _upload(s3, src, "IMAGE", "image/jpeg")
        with pytest.raises(PipelineError):
            process(str(m.id))
    m.refresh_from_db()
    assert m.status == "FAILED" and "audio" in m.error


def test_sniff():
    assert sniff(b"\xff\xd8\xff\xe0" + b"0" * 60) == ("IMAGE", "image/jpeg")
    assert sniff(b"\x00\x00\x00\x20ftypM4A " + b"0" * 52)[0] == "AUDIO"
    assert sniff(b"<html>" + b"0" * 58) is None
