"""
Typed, encrypted, cached settings.

    settings_service.get("sms.beem")  -> SmsBeem (pydantic), secrets decrypted, server-side only

Caching: each process keeps decoded groups in memory; Redis holds the raw rows. Every write bumps
`version`, refreshes Redis and publishes the group name on `sw:settings`. A daemon thread in every
API/worker process listens and drops its local copy, so new values apply instantly without a restart.
A short local TTL is a safety net if a pub/sub message is ever missed.
"""
from __future__ import annotations

import copy
import json
import logging
import threading
import time
from functools import lru_cache
from typing import Any, TypeVar

from django.conf import settings as dj
from django.db import transaction
from pydantic import BaseModel, ValidationError

from .crypto import KeyRing, decrypt_secret, encrypt_secret, get_path, is_encrypted, mask_secret, parse_key_ring, random_token, set_path
from .exceptions import ApiError
from .settings_schema import PUBLIC_CONFIG_PICK, SECRET_FIELDS, SECRET_PLACEHOLDER, SETTINGS_GROUPS

logger = logging.getLogger("smartwear.settings")
T = TypeVar("T", bound=BaseModel)

CHANNEL = "sw:settings"
REDIS_KEY = "sw:settings:{group}"
LOCAL_TTL_SECONDS = 30


@lru_cache(maxsize=1)
def key_ring() -> KeyRing:
    return parse_key_ring(dj.MASTER_ENCRYPTION_KEY)


@lru_cache(maxsize=1)
def redis_client():
    import redis

    return redis.Redis.from_url(dj.REDIS_URL, decode_responses=True, socket_timeout=2, socket_connect_timeout=2)


class _Local:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.items: dict[str, tuple[float, BaseModel, int]] = {}
        self.listener_started = False

    def clear(self, group: str | None = None) -> None:
        with self.lock:
            if group is None:
                self.items.clear()
            else:
                self.items.pop(group, None)


_local = _Local()


def _start_listener() -> None:
    if _local.listener_started or getattr(dj, "SETTINGS_PUBSUB_DISABLED", False):
        return
    _local.listener_started = True

    def run() -> None:
        while True:
            try:
                ps = redis_client().pubsub(ignore_subscribe_messages=True)
                ps.subscribe(CHANNEL)
                for msg in ps.listen():
                    data = msg.get("data")
                    _local.clear(None if data == "*" else data)
            except Exception as e:  # noqa: BLE001 - keep the listener alive across Redis restarts
                logger.warning("settings listener reconnecting: %s", e)
                _local.clear()
                time.sleep(2)

    threading.Thread(target=run, name="settings-pubsub", daemon=True).start()


def _validate(group: str, value: dict) -> BaseModel:
    model = SETTINGS_GROUPS.get(group)
    if model is None:
        raise ApiError.not_found(f"Settings group {group}")
    try:
        return model.model_validate(value)
    except ValidationError as e:
        raise ApiError.bad_request(f"Invalid settings for {group}", details=json.loads(e.json(include_url=False))) from e


def _secret_paths(group: str) -> list[str]:
    return SECRET_FIELDS.get(group, [])


def _decrypt_value(group: str, raw: dict) -> dict:
    out = copy.deepcopy(raw)
    ring = key_ring()
    for path in _secret_paths(group):
        v = get_path(out, path)
        if is_encrypted(v):
            try:
                set_path(out, path, decrypt_secret(v, ring))  # type: ignore[arg-type]
            except Exception:  # noqa: BLE001
                logger.error("cannot decrypt %s.%s — wrong MASTER_ENCRYPTION_KEY?", group, path)
                set_path(out, path, "")
    return out


def _load_raw(group: str) -> tuple[dict, int]:
    key = REDIS_KEY.format(group=group)
    try:
        cached = redis_client().get(key)
        if cached:
            d = json.loads(cached)
            return d["value"], d["version"]
    except Exception as e:  # noqa: BLE001 - Redis down → fall back to the database
        logger.warning("settings redis read failed: %s", e)
    from .models import Setting

    row = Setting.objects.filter(group=group).first()
    value, version = (row.value, row.version) if row else ({}, 0)
    try:
        redis_client().set(key, json.dumps({"value": value, "version": version}), ex=3600)
    except Exception:  # noqa: BLE001
        pass
    return value, version


def get(group: str, model: type[T] | None = None) -> T:  # type: ignore[type-var]
    _start_listener()
    now = time.monotonic()
    hit = _local.items.get(group)
    if hit and now - hit[0] < LOCAL_TTL_SECONDS:
        return hit[1]  # type: ignore[return-value]
    raw, version = _load_raw(group)
    parsed = _validate(group, _decrypt_value(group, raw))
    if group == "auth" and not parsed.jwtSecret:  # type: ignore[attr-defined]
        parsed = _ensure_jwt_secret()
    with _local.lock:
        _local.items[group] = (now, parsed, version)
    return parsed  # type: ignore[return-value]


def version_of(group: str) -> int:
    get(group)
    return _local.items[group][2]


def _ensure_jwt_secret() -> BaseModel:
    """First boot: generate the access-token signing secret and store it encrypted."""
    from .models import Setting

    with transaction.atomic():
        row, _ = Setting.objects.select_for_update().get_or_create(group="auth", defaults={"value": {}, "secret_paths": _secret_paths("auth")})
        current = _decrypt_value("auth", row.value)
        if not current.get("jwtSecret"):
            row.value = {**row.value, "jwtSecret": encrypt_secret(random_token(48), key_ring())}
            row.version += 1
            row.save()
    invalidate("auth")
    return _validate("auth", _decrypt_value("auth", row.value))


def invalidate(group: str | None = None) -> None:
    _local.clear(group)
    try:
        r = redis_client()
        if group:
            r.delete(REDIS_KEY.format(group=group))
        r.publish(CHANNEL, group or "*")
    except Exception as e:  # noqa: BLE001
        logger.warning("settings invalidate publish failed: %s", e)


def _redact(group: str, value: dict) -> dict:
    out = copy.deepcopy(value)
    for p in _secret_paths(group):
        if get_path(out, p):
            set_path(out, p, "[redacted]")
    return out


def admin_view(group: str) -> dict[str, Any]:
    """Shape for the admin UI: secrets masked, plus which secret fields are set."""
    from .models import Setting

    model = get(group)
    data = model.model_dump(mode="json")
    secrets: dict[str, dict[str, Any]] = {}
    for p in _secret_paths(group):
        plain = get_path(data, p) or ""
        if group == "auth" and p == "jwtSecret":
            set_path(data, p, mask_secret(str(plain)))
            secrets[p] = {"set": bool(plain), "masked": mask_secret(str(plain)), "managed": True}
            continue
        set_path(data, p, mask_secret(str(plain)) if plain else "")
        secrets[p] = {"set": bool(plain), "masked": mask_secret(str(plain))}
    row = Setting.objects.filter(group=group).select_related("updated_by").first()
    return {
        "group": group,
        "value": data,
        "secrets": secrets,
        "version": row.version if row else 0,
        "updatedAt": row.updated_at.isoformat() if row else None,
        "updatedBy": (row.updated_by.name or row.updated_by.email) if row and row.updated_by else None,
        "schema": SETTINGS_GROUPS[group].model_json_schema(),
    }


def update(group: str, patch: dict[str, Any], *, admin=None, request=None, expected_version: int | None = None) -> dict[str, Any]:
    """Merge-patch a group. Secret fields equal to the placeholder / masked value keep their stored ciphertext."""
    from .audit import audit
    from .models import Setting

    if group not in SETTINGS_GROUPS:
        raise ApiError.not_found(f"Settings group {group}")
    ring = key_ring()
    with transaction.atomic():
        row, _ = Setting.objects.select_for_update().get_or_create(group=group, defaults={"value": {}, "secret_paths": _secret_paths(group)})
        if expected_version is not None and row.version != expected_version and row.version != 0:
            raise ApiError.conflict("stale_settings", "These settings were changed by someone else. Reload to see the latest values.", {"version": row.version})
        before_plain = _decrypt_value(group, row.value)
        merged = copy.deepcopy(before_plain)
        incoming = copy.deepcopy(patch)
        for p in _secret_paths(group):
            v = get_path(incoming, p)
            if v is None or v == SECRET_PLACEHOLDER or (isinstance(v, str) and v.startswith("••••")):
                if v is not None:
                    set_path(incoming, p, get_path(before_plain, p) or "")
        if group == "auth":
            incoming.pop("jwtSecret", None)
        _deep_merge(merged, incoming)
        parsed = _validate(group, merged)
        stored = parsed.model_dump(mode="json")
        for p in _secret_paths(group):
            plain = get_path(stored, p)
            if plain:
                existing = get_path(row.value, p)
                same = is_encrypted(existing) and get_path(before_plain, p) == plain
                set_path(stored, p, existing if same else encrypt_secret(str(plain), ring))
        row.value = stored
        row.secret_paths = _secret_paths(group)
        row.version += 1
        row.updated_by = admin
        row.save()
        changed_secrets = [p for p in _secret_paths(group) if get_path(before_plain, p) != get_path(parsed.model_dump(mode="json"), p)]
        audit(
            "settings.update", "setting", group, request=request, admin=admin,
            before=_redact(group, before_plain), after=_redact(group, parsed.model_dump(mode="json")),
            meta={"version": row.version, "secretsChanged": changed_secrets},
        )
        transaction.on_commit(lambda: invalidate(group))
    # This process sees its own write at once; other processes are told on commit (pub/sub).
    _local.clear(group)
    try:
        redis_client().delete(REDIS_KEY.format(group=group))
    except Exception:  # noqa: BLE001
        pass
    return admin_view(group) | {"version": row.version}


def reveal(group: str, path: str, *, admin, request=None) -> str:
    from .audit import audit

    if path not in _secret_paths(group):
        raise ApiError.bad_request("That field is not a secret")
    value = get_path(get(group).model_dump(mode="json"), path) or ""
    audit("settings.secret.reveal", "setting", group, request=request, admin=admin, meta={"path": path})
    return str(value)


def _deep_merge(dst: dict, src: dict) -> None:
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict) and k not in {"mapStyleLight", "mapStyleDark"}:
            _deep_merge(dst[k], v)
        else:
            dst[k] = v


def public_config() -> dict[str, Any]:
    """`GET /v1/config/public` — non-secret runtime config for the apps."""
    out: dict[str, Any] = {}
    for group, pick in PUBLIC_CONFIG_PICK.items():
        data = get(group).model_dump(mode="json")
        if pick == "*":
            section = data
        else:
            section = {k: data.get(k) for k in pick}
        out[group.replace(".", "_")] = section
    out["versions"] = {g: version_of(g) for g in PUBLIC_CONFIG_PICK}
    return out
