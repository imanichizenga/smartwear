"""ThumbHash encoder (port of evanw/thumbhash, public domain). Input: RGBA bytes, w, h ≤ 100."""
from __future__ import annotations

import base64
import math


def rgba_to_thumbhash(w: int, h: int, rgba: bytes) -> bytes:
    if w > 100 or h > 100:
        raise ValueError(f"{w}x{h} doesn't fit in 100x100")
    avg_r = avg_g = avg_b = avg_a = 0.0
    for i in range(w * h):
        j = i * 4
        alpha = rgba[j + 3] / 255
        avg_r += alpha / 255 * rgba[j]
        avg_g += alpha / 255 * rgba[j + 1]
        avg_b += alpha / 255 * rgba[j + 2]
        avg_a += alpha
    if avg_a:
        avg_r /= avg_a
        avg_g /= avg_a
        avg_b /= avg_a
    has_alpha = avg_a < w * h
    l_limit = 5 if has_alpha else 7
    lx = max(1, round(l_limit * w / max(w, h)))
    ly = max(1, round(l_limit * h / max(w, h)))
    l_, p_, q_, a_ = [], [], [], []
    for i in range(w * h):
        j = i * 4
        alpha = rgba[j + 3] / 255
        r = avg_r * (1 - alpha) + alpha / 255 * rgba[j]
        g = avg_g * (1 - alpha) + alpha / 255 * rgba[j + 1]
        b = avg_b * (1 - alpha) + alpha / 255 * rgba[j + 2]
        l_.append((r + g + b) / 3)
        p_.append((r + g) / 2 - b)
        q_.append(r - g)
        a_.append(alpha)

    def encode_channel(channel, nx, ny):
        dc, ac, scale = 0.0, [], 0.0
        fx = [0.0] * w
        for cy in range(ny):
            cx = 0
            while cx * ny < nx * (ny - cy):
                f = 0.0
                for x in range(w):
                    fx[x] = math.cos(math.pi / w * cx * (x + 0.5))
                for y in range(h):
                    fy = math.cos(math.pi / h * cy * (y + 0.5))
                    for x in range(w):
                        f += channel[x + y * w] * fx[x] * fy
                f /= w * h
                if cx or cy:
                    ac.append(f)
                    scale = max(scale, abs(f))
                else:
                    dc = f
                cx += 1
        if scale:
            ac = [0.5 + 0.5 / scale * x for x in ac]
        return dc, ac, scale

    l_dc, l_ac, l_scale = encode_channel(l_, max(3, lx), max(3, ly))
    p_dc, p_ac, p_scale = encode_channel(p_, 3, 3)
    q_dc, q_ac, q_scale = encode_channel(q_, 3, 3)
    a_dc, a_ac, a_scale = encode_channel(a_, 5, 5) if has_alpha else (0, [], 0)
    is_landscape = w > h
    header24 = round(63 * l_dc) | (round(31.5 + 31.5 * p_dc) << 6) | (round(31.5 + 31.5 * q_dc) << 12) | (round(31 * l_scale) << 18) | (int(has_alpha) << 23)
    header16 = (ly if is_landscape else lx) | (round(63 * p_scale) << 3) | (round(63 * q_scale) << 9) | (int(is_landscape) << 15)
    out = bytearray([header24 & 255, (header24 >> 8) & 255, header24 >> 16, header16 & 255, header16 >> 8])
    if has_alpha:
        out.append(round(15 * a_dc) | (round(15 * a_scale) << 4))
    is_odd = False
    pending = 0
    for ac in [l_ac, p_ac, q_ac] + ([a_ac] if has_alpha else []):
        for f in ac:
            v = round(15 * f)
            if is_odd:
                out.append(pending | (v << 4))
            else:
                pending = v
            is_odd = not is_odd
    if is_odd:
        out.append(pending)
    return bytes(out)


def encode_b64(w: int, h: int, rgba: bytes) -> str:
    return base64.b64encode(rgba_to_thumbhash(w, h, rgba)).decode()
