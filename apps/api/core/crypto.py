"""
AES-256-GCM envelope for secrets at rest.
Ciphertext format: `enc:v1:<keyId>:<iv b64>:<tag b64>:<data b64>`
MASTER_ENCRYPTION_KEY = "k1.<base64>,k0.<base64>" → k1 encrypts, k0 still decrypts (rotation).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENC_PREFIX = "enc:v1:"


@dataclass(frozen=True)
class KeyRing:
    current_id: str
    keys: dict[str, bytes]

    @property
    def current(self) -> bytes:
        return self.keys[self.current_id]


def parse_key_ring(raw: str) -> KeyRing:
    entries = [e.strip() for e in (raw or "").split(",") if e.strip()]
    if not entries:
        raise ValueError("MASTER_ENCRYPTION_KEY is empty")
    keys: dict[str, bytes] = {}
    current = None
    for e in entries:
        if "." not in e:
            raise ValueError("MASTER_ENCRYPTION_KEY entries must be <keyId>.<base64Key>")
        kid, b64 = e.split(".", 1)
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", kid):
            raise ValueError(f"Key id {kid} has invalid characters")
        key = base64.b64decode(b64)
        if len(key) != 32:
            raise ValueError(f"Key {kid} must be 32 bytes (base64) — got {len(key)}")
        keys[kid] = key
        current = current or kid
    assert current
    return KeyRing(current_id=current, keys=keys)


def is_encrypted(v: object) -> bool:
    return isinstance(v, str) and v.startswith(ENC_PREFIX)


def encrypt_secret(plain: str, ring: KeyRing) -> str:
    iv = os.urandom(12)
    ct = AESGCM(ring.current).encrypt(iv, plain.encode(), None)
    data, tag = ct[:-16], ct[-16:]
    b = lambda x: base64.b64encode(x).decode()  # noqa: E731
    return f"{ENC_PREFIX}{ring.current_id}:{b(iv)}:{b(tag)}:{b(data)}"


def decrypt_secret(ciphertext: str, ring: KeyRing) -> str:
    if not is_encrypted(ciphertext):
        raise ValueError("Value is not an encrypted secret")
    parts = ciphertext[len(ENC_PREFIX) :].split(":")
    if len(parts) != 4:
        raise ValueError("Malformed ciphertext")
    kid, iv, tag, data = parts
    key = ring.keys.get(kid)
    if not key:
        raise ValueError(f'Unknown encryption key id "{kid}" — add it to MASTER_ENCRYPTION_KEY to decrypt')
    d = base64.b64decode
    return AESGCM(key).decrypt(d(iv), d(data) + d(tag), None).decode()


def rotate_if_needed(ciphertext: str, ring: KeyRing) -> str:
    kid = ciphertext[len(ENC_PREFIX) :].split(":")[0]
    return ciphertext if kid == ring.current_id else encrypt_secret(decrypt_secret(ciphertext, ring), ring)


def mask_secret(plain: str) -> str:
    if not plain:
        return ""
    return "••••••••" + (plain[-4:] if len(plain) > 8 else "")


def sha256(s: str | bytes) -> str:
    return hashlib.sha256(s.encode() if isinstance(s, str) else s).hexdigest()


def random_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def safe_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def get_path(obj: object, path: str) -> object:
    cur = obj
    for k in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def set_path(obj: dict, path: str, value: object) -> None:
    keys = path.split(".")
    cur = obj
    for k in keys[:-1]:
        if not isinstance(cur.get(k), dict):
            cur[k] = {}
        cur = cur[k]
    cur[keys[-1]] = value
