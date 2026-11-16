"""
Studio-style product renders of fictional sports jerseys for the demo catalogue (`seed_more`).

There are almost no licence-free photos of plain jerseys, and real kits carry club crests and sponsors we must not
use, so each demo kit is drawn here: a flat-lay shirt on a soft backdrop with fabric shading, the kit pattern, a
made-up crest and (on the back view) a name and number. Output is a deterministic JPEG, so re-running the seed reuses
the same Media by checksum.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, replace
from functools import lru_cache

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

W, H = 1600, 2000           # output size (4:5, the catalogue's product ratio)
SS = 2                      # supersampling factor for smooth edges
FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
FONT_NARROW = "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Bold.ttf"


@dataclass(frozen=True)
class Kit:
    body: str                       # main colour
    accent: str                     # pattern / trim colour
    trim: str = ""                  # collar & cuffs (defaults to accent)
    pattern: str = "solid"          # solid | stripes | hoops | sash | halves | pinstripe | chevron | shoulders | fade
    style: str = "tee"              # tee | longsleeve | vest | singlet | collar
    crest: str = ""                 # 2–3 letters inside the crest
    name: str = ""                  # back print
    number: str = ""
    number_colour: str = ""         # defaults to trim/accent, whichever contrasts with the body
    backdrop: str = "#EFEDE8"


def _rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _lum(h: str) -> float:
    r, g, b = (c / 255 for c in _rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(on: str, *choices: str) -> str:
    """Pick the choice that reads best on `on` (falls back to black/white)."""
    pool = [c for c in choices if c] + ["#FFFFFF", "#111111"]
    return max(pool, key=lambda c: abs(_lum(c) - _lum(on)) + (0.08 if c in choices else 0))


@lru_cache(maxsize=8)
def _font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


# ---------------------------------------------------------------------------------------------- silhouettes
def _outline(style: str) -> dict:
    """Front-view geometry in normalised 0..1 coords: outline polygon, neckline, cuff segments, armhole curves."""
    if style in ("vest", "singlet"):
        v = 0.25 if style == "vest" else 0.23
        poly = [(0.375, 0.15), (0.445, 0.15), (0.50, v), (0.555, 0.15), (0.625, 0.15),
                (0.655, 0.25), (0.745, 0.345), (0.75, 0.83), (0.25, 0.83), (0.255, 0.345), (0.345, 0.25)]
        return {"poly": poly, "neck": [(0.445, 0.15), (0.50, v), (0.555, 0.15)], "cuffs": [],
                "arms": [[(0.625, 0.15), (0.655, 0.25), (0.745, 0.345)], [(0.375, 0.15), (0.345, 0.25), (0.255, 0.345)]]}
    if style == "longsleeve":
        ro, ri = (0.975, 0.70), (0.885, 0.72)
    else:
        ro, ri = (0.955, 0.40), (0.845, 0.455)
    neck = [(0.41, 0.155), (0.45, 0.18), (0.50, 0.19), (0.55, 0.18), (0.59, 0.155)]
    poly = neck + [(0.79, 0.205), ro, ri, (0.765, 0.365), (0.775, 0.83), (0.225, 0.83), (0.235, 0.365),
                   (1 - ri[0], ri[1]), (1 - ro[0], ro[1]), (0.21, 0.205)]
    return {"poly": poly, "neck": neck, "cuffs": [(ro, ri), ((1 - ro[0], ro[1]), (1 - ri[0], ri[1]))], "arms": []}


def _px(pts, w, h):
    return [(x * w, y * h) for x, y in pts]


# ---------------------------------------------------------------------------------------------- patterns
def _pattern_layer(kit: Kit, w: int, h: int, back: bool) -> Image.Image:
    img = Image.new("RGB", (w, h), _rgb(kit.body))
    d = ImageDraw.Draw(img)
    a = _rgb(kit.accent)
    p = kit.pattern
    if p == "stripes":
        band = w * 0.055
        x = w * 0.5 - band / 2 - band * 2 * 6
        while x < w:
            d.rectangle([x, 0, x + band, h], fill=a)
            x += band * 2
    elif p == "pinstripe":
        x, step = 0.0, w * 0.035
        while x < w:
            d.rectangle([x, 0, x + w * 0.004, h], fill=a)
            x += step
    elif p == "hoops":
        band = h * 0.05
        y = h * 0.30
        while y < h:
            d.rectangle([0, y, w, y + band], fill=a)
            y += band * 2
    elif p == "sash":
        t = w * 0.10
        if back:   # a sash only shows on the front
            pass
        else:
            d.polygon([(w * 0.20, h * 0.18), (w * 0.20 + t * 1.5, h * 0.18), (w * 0.80, h * 0.84), (w * 0.80 - t * 1.5, h * 0.84)], fill=a)
    elif p == "halves":
        if back:
            d.rectangle([0, 0, w / 2, h], fill=a)
        else:
            d.rectangle([w / 2, 0, w, h], fill=a)
    elif p == "chevron":
        for k in range(3):
            y0 = h * (0.30 + k * 0.075)
            d.polygon([(0, y0), (w / 2, y0 + h * 0.07), (w, y0), (w, y0 + h * 0.03), (w / 2, y0 + h * 0.10), (0, y0 + h * 0.03)], fill=a)
    elif p == "shoulders":
        d.rectangle([0, 0, w, h * 0.29], fill=a)
        d.polygon([(0, h * 0.29), (w, h * 0.29), (w, h * 0.305), (0, h * 0.305)], fill=_rgb(kit.trim or kit.body))
    elif p == "fade":
        top, bot = _rgb(kit.body), a
        for y in range(h):
            t = max(0.0, min(1.0, (y / h - 0.25) / 0.6))
            d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return img


# ---------------------------------------------------------------------------------------------- shading
def _shade(mask: Image.Image, w: int, h: int, style: str) -> tuple[Image.Image, Image.Image]:
    """Returns (shadow multiply layer, highlight screen layer) built from soft fabric folds."""
    shadow = Image.new("L", (w, h), 255)
    sd = ImageDraw.Draw(shadow)
    # Side falloff and folds under the arms.
    for x0, x1, v in [(0.225, 0.29, 205), (0.71, 0.775, 205), (0.43, 0.46, 234), (0.58, 0.61, 238)]:
        sd.rectangle([x0 * w, 0.33 * h, x1 * w, 0.83 * h], fill=v)
    sd.rectangle([0, 0.78 * h, w, 0.83 * h], fill=228)
    if style not in ("vest", "singlet"):
        sd.polygon(_px([(0.235, 0.365), (0.17, 0.40), (0.20, 0.25)], w, h), fill=205)
        sd.polygon(_px([(0.765, 0.365), (0.83, 0.40), (0.80, 0.25)], w, h), fill=205)
    shadow = shadow.filter(ImageFilter.GaussianBlur(w * 0.03))
    hl = Image.new("L", (w, h), 0)
    hd = ImageDraw.Draw(hl)
    hd.ellipse([0.33 * w, 0.22 * h, 0.56 * w, 0.62 * h], fill=34)
    hd.ellipse([0.58 * w, 0.40 * h, 0.66 * w, 0.78 * h], fill=18)
    hl = hl.filter(ImageFilter.GaussianBlur(w * 0.05))
    return ImageChops.multiply(shadow, mask), ImageChops.multiply(hl, mask)


def _fabric_noise(w: int, h: int) -> Image.Image:
    """A fine mesh texture: deterministic, low-contrast diagonal weave."""
    tile = Image.new("L", (12, 12), 128)
    td = ImageDraw.Draw(tile)
    for k in range(-12, 24, 4):
        td.line([(k, 0), (k + 12, 12)], fill=140)
        td.line([(k + 12, 0), (k, 12)], fill=118)
    tex = Image.new("L", (w, h))
    for y in range(0, h, 12):
        for x in range(0, w, 12):
            tex.paste(tile, (x, y))
    return tex.filter(ImageFilter.GaussianBlur(0.6))


# ---------------------------------------------------------------------------------------------- crest & print
def _crest(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float, kit: Kit):
    ring = _contrast(kit.body, kit.trim, kit.accent)
    fill = kit.accent if _lum(kit.accent) != _lum(kit.body) else kit.trim or "#FFFFFF"
    shield = [(cx - r, cy - r), (cx + r, cy - r), (cx + r, cy + r * 0.25), (cx, cy + r * 1.2), (cx - r, cy + r * 0.25)]
    d.polygon(shield, fill=_rgb(ring))
    inner = [(cx - r * 0.82, cy - r * 0.82), (cx + r * 0.82, cy - r * 0.82), (cx + r * 0.82, cy + r * 0.18), (cx, cy + r * 0.98), (cx - r * 0.82, cy + r * 0.18)]
    d.polygon(inner, fill=_rgb(fill))
    if kit.crest:
        f = _font(FONT_BOLD, int(r * (0.78 if len(kit.crest) <= 2 else 0.6)))
        d.text((cx, cy - r * 0.05), kit.crest, font=f, fill=_rgb(_contrast(fill, ring)), anchor="mm")


def _back_print(d: ImageDraw.ImageDraw, w: int, h: int, kit: Kit):
    c = kit.number_colour or _contrast(kit.body, kit.trim, kit.accent)
    col = _rgb(c)
    busy = kit.pattern in ("stripes", "hoops", "halves", "pinstripe", "chevron")
    edge = _rgb(_contrast(c, kit.body, kit.accent, kit.trim))
    stroke = {"stroke_width": int(h * 0.005), "stroke_fill": edge} if busy else {}
    if kit.name:
        f = _font(FONT_BOLD, int(h * 0.045))
        # Gentle arc for the name, letter by letter.
        text = kit.name.upper()
        widths = [d.textlength(c, font=f) for c in text]
        total = sum(widths) + (len(text) - 1) * h * 0.006
        x = w / 2 - total / 2
        for ch, cw in zip(text, widths, strict=True):
            mid = x + cw / 2
            off = ((mid - w / 2) / (w * 0.22)) ** 2 * h * 0.012
            d.text((mid, h * 0.27 + off), ch, font=f, fill=col, anchor="mm", **stroke)
            x += cw + h * 0.006
    if kit.number:
        f = _font(FONT_NARROW, int(h * 0.22))
        d.text((w / 2, h * 0.47), kit.number, font=f, fill=col, anchor="mm", **({"stroke_width": int(h * 0.007), "stroke_fill": edge} if busy else {}))


# ---------------------------------------------------------------------------------------------- render
def render(kit: Kit, view: str = "front") -> bytes:
    """`view`: front | back | detail. Returns JPEG bytes."""
    w, h = W * SS, H * SS
    back = view == "back"
    geo = _outline(kit.style)
    poly = _px(geo["poly"], w, h)

    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)

    shirt = _pattern_layer(kit, w, h, back)
    sd = ImageDraw.Draw(shirt)
    trim = _rgb(kit.trim or kit.accent)
    lw = int(w * 0.012)
    # Collar / neckline trim.
    neck_px = _px(geo["neck"], w, h)
    if kit.style == "collar" and not back:
        cx = w * 0.5
        sd.polygon([(w * 0.40, h * 0.13), (cx, h * 0.20), (w * 0.60, h * 0.13), (w * 0.57, h * 0.12), (cx, h * 0.175), (w * 0.43, h * 0.12)], fill=trim)
        sd.polygon([(w * 0.40, h * 0.13), (w * 0.47, h * 0.215), (w * 0.43, h * 0.13)], fill=trim)
        sd.polygon([(w * 0.60, h * 0.13), (w * 0.53, h * 0.215), (w * 0.57, h * 0.13)], fill=trim)
        for k in range(2):
            sd.ellipse([cx - w * 0.006, h * (0.205 + k * 0.035), cx + w * 0.006, h * (0.205 + k * 0.035) + w * 0.012], fill=trim)
    elif back:
        sd.line(_px([(0.41, 0.155), (0.50, 0.165), (0.59, 0.155)] if kit.style not in ("vest", "singlet") else [(0.445, 0.15), (0.50, 0.165), (0.555, 0.15)], w, h), fill=trim, width=lw, joint="curve")
    else:
        sd.line(neck_px, fill=trim, width=lw, joint="curve")
    # Cuffs and armhole trim.
    for a, b in geo["cuffs"]:
        sd.line(_px([a, b], w, h), fill=trim, width=int(lw * (2.4 if kit.style == "longsleeve" else 1.6)))
    for arc in geo["arms"]:
        sd.line(_px(arc, w, h), fill=trim, width=lw, joint="curve")
    if back:
        _back_print(sd, w, h, kit)
    else:
        _crest(sd, w * 0.615, h * 0.265, w * 0.036, kit)
        # A small maker's mark opposite the crest.
        sd.polygon([(w * 0.37, h * 0.25), (w * 0.40, h * 0.27), (w * 0.37, h * 0.29), (w * 0.38, h * 0.27)], fill=trim)

    # Fabric: mesh texture + folds.
    tex = _fabric_noise(w, h)
    shirt = Image.blend(shirt, ImageChops.overlay(shirt, Image.merge("RGB", (tex, tex, tex))), 0.35)
    shadow, hl = _shade(mask, w, h, kit.style)
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    shirt = Image.composite(shirt, Image.blend(shirt, dark, 0.35), shadow.point(lambda v: 255 if v == 0 else v))
    shirt = Image.composite(Image.new("RGB", (w, h), (255, 255, 255)), shirt, hl)

    # Backdrop with a soft floor gradient and a drop shadow under the shirt.
    bg = Image.new("RGB", (w, h), _rgb(kit.backdrop))
    grad = Image.linear_gradient("L").resize((w, h)).point(lambda v: int(v * 0.10))
    bg = Image.composite(Image.new("RGB", (w, h), (0, 0, 0)), bg, grad)
    drop = mask.filter(ImageFilter.GaussianBlur(w * 0.018)).point(lambda v: int(v * 0.32))
    drop = ImageChops.offset(drop, int(w * 0.008), int(h * 0.014))
    bg = Image.composite(Image.new("RGB", (w, h), (20, 20, 20)), bg, drop)
    out = Image.composite(shirt, bg, mask)

    if view == "detail":   # close crop around the crest and collar
        cx, cy = w * 0.56, h * 0.27
        box = (int(cx - w * 0.2), int(cy - h * 0.2), int(cx + w * 0.2), int(cy + h * 0.2))
        out = out.crop(box)
    out = out.resize((W, H), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=88, optimize=True, progressive=True)
    return buf.getvalue()


def variant(kit: Kit, **changes) -> Kit:
    return replace(kit, **changes)


def ref(kit_id: str, view: str) -> str:
    """Image ref understood by `seed_more._fetch`: k:<kit id>:<view>."""
    return f"k:{kit_id}:{view}"


if __name__ == "__main__":  # quick local preview: python -m catalog.seed.kit_art /tmp/out
    import sys
    from pathlib import Path

    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    demo = Kit(body="#0E7C86", accent="#FFFFFF", trim="#0B3C49", pattern="stripes", crest="PW", name="Mrisho", number="10")
    for v in ("front", "back", "detail"):
        (out / f"kit-{v}.jpg").write_bytes(render(demo, v))
    print("ok")
