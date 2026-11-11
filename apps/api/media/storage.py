"""S3 access built from DB settings (bucket, region, keys, optional endpoint for S3-compatible stores, CDN)."""
from __future__ import annotations

import hashlib
import time
from functools import lru_cache
from typing import Any

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from core import settings_service
from core.exceptions import ApiError

IMMUTABLE_CACHE = "public, max-age=31536000, immutable"


def _cfg():
    return settings_service.get("storage.s3")


def configured() -> bool:
    c = _cfg()
    return bool(c.bucket and c.accessKeyId and c.secretAccessKey and c.region)


@lru_cache(maxsize=4)
def _client_for(fingerprint: str, region: str, key_id: str, secret: str, endpoint: str, path_style: bool):
    return boto3.client(
        "s3",
        region_name=region,
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        endpoint_url=endpoint or None,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path" if path_style else "auto"}, retries={"max_attempts": 3, "mode": "standard"}, connect_timeout=5, read_timeout=30),
    )


def client():
    c = _cfg()
    if not configured():
        raise ApiError.not_configured("Media storage (S3)", "Enter the bucket, region and access keys in Settings → Media storage.")
    fp = hashlib.sha256(f"{c.region}|{c.accessKeyId}|{c.secretAccessKey}|{c.endpoint}|{c.forcePathStyle}".encode()).hexdigest()
    return _client_for(fp, c.region, c.accessKeyId, c.secretAccessKey, c.endpoint, c.forcePathStyle)


def bucket() -> str:
    return _cfg().bucket


def key_prefix() -> str:
    return (_cfg().keyPrefix or "media").strip("/")


def presign_post(key: str, content_type: str, max_bytes: int) -> dict[str, Any]:
    """Browser/app upload scoped to exactly this key, content type and size range."""
    c = _cfg()
    try:
        post = client().generate_presigned_post(
            Bucket=c.bucket,
            Key=key,
            Fields={"Content-Type": content_type},
            Conditions=[{"Content-Type": content_type}, ["content-length-range", 1, max_bytes], {"key": key}],
            ExpiresIn=c.presignTtlSeconds,
        )
    except (BotoCoreError, ClientError) as e:
        raise ApiError.upstream("S3", str(e)) from e
    return {"url": post["url"], "fields": post["fields"], "expiresAt": int(time.time()) + c.presignTtlSeconds}


def create_multipart(key: str, content_type: str) -> str:
    try:
        r = client().create_multipart_upload(Bucket=bucket(), Key=key, ContentType=content_type)
    except (BotoCoreError, ClientError) as e:
        raise ApiError.upstream("S3", str(e)) from e
    return r["UploadId"]


def presign_part(key: str, upload_id: str, part_number: int) -> str:
    return client().generate_presigned_url("upload_part", Params={"Bucket": bucket(), "Key": key, "UploadId": upload_id, "PartNumber": part_number}, ExpiresIn=max(3600, _cfg().presignTtlSeconds))


def complete_multipart(key: str, upload_id: str, parts: list[dict]) -> None:
    try:
        client().complete_multipart_upload(Bucket=bucket(), Key=key, UploadId=upload_id, MultipartUpload={"Parts": [{"PartNumber": p["partNumber"], "ETag": p["etag"]} for p in sorted(parts, key=lambda p: p["partNumber"])]})
    except (BotoCoreError, ClientError) as e:
        raise ApiError.upstream("S3", str(e)) from e


def abort_multipart(key: str, upload_id: str) -> None:
    try:
        client().abort_multipart_upload(Bucket=bucket(), Key=key, UploadId=upload_id)
    except (BotoCoreError, ClientError):
        pass


def head(key: str) -> dict | None:
    try:
        return client().head_object(Bucket=bucket(), Key=key)
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return None
        raise ApiError.upstream("S3", str(e)) from e


def read_range(key: str, start: int, end: int) -> bytes:
    return client().get_object(Bucket=bucket(), Key=key, Range=f"bytes={start}-{end}")["Body"].read()


def download(key: str, path: str) -> None:
    client().download_file(bucket(), key, path)


def upload_file(path: str, key: str, content_type: str, cache_control: str = IMMUTABLE_CACHE) -> None:
    client().upload_file(path, bucket(), key, ExtraArgs={"ContentType": content_type, "CacheControl": cache_control})


def put_bytes(key: str, data: bytes, content_type: str, cache_control: str = IMMUTABLE_CACHE) -> None:
    client().put_object(Bucket=bucket(), Key=key, Body=data, ContentType=content_type, CacheControl=cache_control)


def delete(keys: list[str]) -> None:
    if not keys:
        return
    for i in range(0, len(keys), 1000):
        client().delete_objects(Bucket=bucket(), Delete={"Objects": [{"Key": k} for k in keys[i : i + 1000]], "Quiet": True})


_url_cache: dict[str, tuple[float, str]] = {}


def public_url(key: str) -> str:
    """CDN URL when configured; otherwise a presigned GET (cached until shortly before expiry)."""
    c = _cfg()
    if c.cdnBaseUrl:
        return c.cdnBaseUrl.rstrip("/") + "/" + key
    if not configured():
        return ""
    now = time.time()
    hit = _url_cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    ttl = 6 * 3600
    url = client().generate_presigned_url("get_object", Params={"Bucket": c.bucket, "Key": key}, ExpiresIn=ttl)
    if len(_url_cache) > 20000:
        _url_cache.clear()
    _url_cache[key] = (now + ttl - 600, url)
    return url
