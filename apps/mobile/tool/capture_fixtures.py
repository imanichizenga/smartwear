"""
Capture real API responses (from a seeded dev database) as Flutter test fixtures, plus one WebP
rendition per media item, so golden screenshots render real catalog data and photos fully offline.

  cd apps/api && uv run python ../mobile/tool/capture_fixtures.py
"""
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import django

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "api"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "smartwear.settings")
django.setup()

import httpx  # noqa: E402
from django.conf import settings  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402

settings.ALLOWED_HOSTS = ["*"]
OUT = Path(__file__).resolve().parents[1] / "test" / "fixtures"
MEDIA = OUT / "media"
MEDIA.mkdir(parents=True, exist_ok=True)
media_keys: dict[str, str] = {}


def media_dir(url: str) -> str:
    """S3 key folder of a rendition — every rendition of one image shares it."""
    return "/".join(urlparse(url).path.split("/")[:-1])


def walk(o):
    if isinstance(o, dict):
        if o.get("type") == "IMAGE" and "sources" in o and o.get("url"):
            webp = sorted((o.get("sources") or {}).get("webp") or [], key=lambda s: s["width"])
            pick = next((s for s in webp if s["width"] >= 600), webp[-1] if webp else None)
            if pick:
                media_keys.setdefault(media_dir(pick["url"]), pick["url"])
        for v in o.values():
            walk(v)
    elif isinstance(o, list):
        for v in o:
            walk(v)


def save(name: str, data):
    walk(data)
    (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print("fixture", name)


def main():
    from accounts.models import User
    from accounts.tokens import start_session
    from catalog.models import ProductVariant

    guest = APIClient()
    save("config", guest.get("/v1/config/public").json())
    save("home", guest.get("/v1/home").json())
    save("categories", guest.get("/v1/categories").json())
    save("products_women", guest.get("/v1/products", {"category": "women", "limit": 20}).json())
    save("search_dress", guest.get("/v1/products", {"q": "dress", "limit": 20}).json())
    save("product_zuri", guest.get("/v1/products/zuri-linen-maxi-dress").json())
    save("product_lipstick", guest.get("/v1/products/velvet-matte-lipstick").json())
    save("looks", guest.get("/v1/looks").json())
    save("suggest", guest.get("/v1/search/suggest", {"q": "lin"}).json())

    u = User.objects.get(phone="+255713000999")

    class Req:
        headers = {"User-Agent": "fixtures"}
        META = {"REMOTE_ADDR": "127.0.0.1"}
        device_id = "fixtures"

    tok = start_session(u, Req(), device_id="fixtures")
    me = APIClient()
    me.credentials(HTTP_AUTHORIZATION=f"Bearer {tok['accessToken']}", HTTP_X_DEVICE_ID="fixtures")
    cart = me.get("/v1/cart").json()
    if not cart.get("items"):
        for slug, qty in (("zuri-linen-maxi-dress", 1), ("velvet-matte-lipstick", 2), ("tanzanite-drop-earrings", 1)):
            v = ProductVariant.objects.filter(product__slug=slug, inventory__on_hand__gt=1).first()
            if v:
                me.post("/v1/cart/items", {"variantId": str(v.id), "qty": qty}, format="json")
    save("cart", me.get("/v1/cart").json())
    save("me", me.get("/v1/me").json())
    orders = me.get("/v1/me/orders").json()
    save("orders", orders)
    if orders.get("items"):
        save("order_detail", me.get(f"/v1/me/orders/{orders['items'][0]['id']}").json())
    save("loyalty", me.get("/v1/me/loyalty").json())
    save("places", me.get("/v1/me/places").json())

    index = {}
    with httpx.Client(timeout=30) as http:
        for folder, url in media_keys.items():
            name = hashlib.sha1(folder.encode()).hexdigest()[:16] + ".webp"
            p = MEDIA / name
            if not p.exists():
                r = http.get(url)
                r.raise_for_status()
                p.write_bytes(r.content)
            index[folder] = name
    (OUT / "media_index.json").write_text(json.dumps(index, indent=1))
    total = sum(f.stat().st_size for f in MEDIA.iterdir())
    print(f"{len(index)} media files, {total // 1024} KB")


main()
