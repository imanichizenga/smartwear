import base64

import pytest

from core.crypto import decrypt_secret, encrypt_secret, mask_secret, parse_key_ring, rotate_if_needed

K1 = "k1." + base64.b64encode(bytes([1] * 32)).decode()
K2 = "k2." + base64.b64encode(bytes([2] * 32)).decode()


def test_roundtrip_unique_ciphertexts():
    ring = parse_key_ring(K1)
    a, b = encrypt_secret("beem-secret-3fA9", ring), encrypt_secret("beem-secret-3fA9", ring)
    assert a != b and a.startswith("enc:v1:k1:")
    assert decrypt_secret(a, ring) == "beem-secret-3fA9"


def test_tamper_detected():
    ring = parse_key_ring(K1)
    c = encrypt_secret("x", ring)
    tampered = c[:-2] + ("B" if c[-2] == "A" else "A") + c[-1]
    with pytest.raises(Exception):
        decrypt_secret(tampered, ring)


def test_rotation():
    old = parse_key_ring(K1)
    c = encrypt_secret("secret", old)
    rotated = parse_key_ring(f"{K2},{K1}")
    assert decrypt_secret(c, rotated) == "secret"
    re = rotate_if_needed(c, rotated)
    assert re.startswith("enc:v1:k2:") and decrypt_secret(re, rotated) == "secret"
    with pytest.raises(ValueError, match="Unknown encryption key"):
        decrypt_secret(c, parse_key_ring(K2))


def test_validation_and_mask():
    with pytest.raises(ValueError):
        parse_key_ring("bad")
    with pytest.raises(ValueError, match="32 bytes"):
        parse_key_ring("k1." + base64.b64encode(bytes(16)).decode())
    assert mask_secret("abcdefgh3fA9") == "••••••••3fA9"
    assert mask_secret("short") == "••••••••"
    assert mask_secret("") == ""
