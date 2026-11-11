"""
`python manage.py seed` — a realistic fashion & beauty store for local development and demos.

Idempotent: re-running updates in place (products by slug, stores by code, riders by phone).

  --admin-email / --admin-password   first Super Admin (2FA is set up on first sign-in)
  --local-s3                         point storage.s3 at the docker-compose S3 stand-in and create the bucket
  --no-media                         skip downloading/processing images (products stay DRAFT — nothing is
                                     published without a ready image)
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import timedelta
from pathlib import Path

import httpx
from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from slugify import slugify

from catalog.seed.catalog import BRANDS, EDITORIAL, PRODUCTS, RIDERS, STORES, UNSPLASH, ProductSeed

CACHE = Path(__file__).resolve().parents[3] / ".seed-cache"
LOCAL_S3 = {
    "provider": "s3_compatible", "bucket": "smartwear-media", "region": "us-east-1", "accessKeyId": "smartwear", "secretAccessKey": "smartwear-secret",
    "endpoint": "http://localhost:9000", "forcePathStyle": True, "cdnBaseUrl": "", "keyPrefix": "media",
}


def _round500(v: float) -> int:
    return int(round(v / 500.0) * 500)


class Command(BaseCommand):
    help = "Seed a realistic SmartWear catalog, stores in Dar es Salaam, test riders and a Super Admin."

    def add_arguments(self, parser):
        parser.add_argument("--admin-email", default="owner@smartwear.local")
        parser.add_argument("--admin-password", default=None)
        parser.add_argument("--local-s3", action="store_true")
        parser.add_argument("--no-media", action="store_true")

    # ------------------------------------------------------------------ entry
    def handle(self, *args, **o):
        from catalog.services.seed_taxonomy import ensure_taxonomy

        self.media_on = not o["no_media"]
        self.http = httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": "SmartWear-seed/1.0"})
        CACHE.mkdir(exist_ok=True)

        ensure_taxonomy()
        admin, password = self._admin(o["admin_email"], o["admin_password"])
        if o["local_s3"]:
            self._local_s3(admin)
        if self.media_on:
            from media import storage

            if not storage.configured():
                raise CommandError("Media storage isn't configured. Add S3 credentials in Admin → Settings, or run with --local-s3 (dev) or --no-media.")
        stores = self._stores()
        brands = self._brands()
        products = self._products(admin, brands, stores)
        self._collections(admin, products)
        self._riders(admin, stores)
        if self.media_on:
            self._marketing(products, brands)
        self._credits()

        self.stdout.write(self.style.SUCCESS(f"\nSeeded {len(products)} products, {len(stores)} locations, {len(RIDERS)} riders."))
        if password:
            self.stdout.write(self.style.WARNING(f"Super Admin: {admin.email}  password: {password}  (set up 2FA on first sign-in)"))
        self.stdout.write("Test riders sign in with OTP on: " + ", ".join(r["phone"] for r in RIDERS))

    # ------------------------------------------------------------------ pieces
    def _admin(self, email: str, password: str | None):
        from accounts.models import AdminUser, Role
        from accounts.rbac import ensure_roles

        ensure_roles()
        existing = AdminUser.objects.filter(email__iexact=email).first()
        if existing:
            if password:
                existing.set_password(password)
                existing.save(update_fields=["password"])
            return existing, password
        password = password or secrets.token_urlsafe(12)
        a = AdminUser.objects.create_user(email, password, name="Store Owner", role=Role.objects.get(key="SUPER_ADMIN"))
        return a, password

    def _local_s3(self, admin) -> None:
        import boto3
        from botocore.config import Config

        from core import settings_service

        settings_service.update("storage.s3", LOCAL_S3, admin=admin)
        s3 = boto3.client("s3", endpoint_url=LOCAL_S3["endpoint"], region_name=LOCAL_S3["region"], aws_access_key_id=LOCAL_S3["accessKeyId"],
                          aws_secret_access_key=LOCAL_S3["secretAccessKey"], config=Config(s3={"addressing_style": "path"}, signature_version="s3v4"))
        try:
            s3.head_bucket(Bucket=LOCAL_S3["bucket"])
        except Exception:  # noqa: BLE001
            s3.create_bucket(Bucket=LOCAL_S3["bucket"])
        try:
            s3.put_bucket_cors(Bucket=LOCAL_S3["bucket"], CORSConfiguration={"CORSRules": [
                {"AllowedOrigins": ["*"], "AllowedMethods": ["GET", "PUT", "POST", "HEAD"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600}]})
        except Exception as e:  # noqa: BLE001 — some S3 stand-ins don't implement CORS config; uploads still work same-origin
            self.stdout.write(self.style.WARNING(f"Could not set bucket CORS: {e}"))
        self.stdout.write("storage.s3 → local S3 stand-in (bucket smartwear-media)")

    def _stores(self):
        from inventory.models import Store

        hours = {d: [["09:00", "20:00"]] for d in ("mon", "tue", "wed", "thu", "fri", "sat")} | {"sun": [["10:00", "18:00"]]}
        out = {}
        for i, s in enumerate(STORES):
            obj, _ = Store.objects.update_or_create(code=s["code"], defaults={
                "name": s["name"], "kind": s["kind"], "address": s["address"], "area": s["area"], "location": Point(s["lng"], s["lat"], srid=4326),
                "phone": s["phone"], "hours": hours, "allows_pickup": s.get("allows_pickup", True), "fulfils_delivery": True, "sort_order": i, "is_active": True})
            out[s["code"]] = obj
        return out

    def _brands(self):
        from catalog.models import Brand

        out = {}
        for i, b in enumerate(BRANDS):
            obj, _ = Brand.objects.update_or_create(slug=slugify(b.name), defaults={"name": b.name, "country": b.country, "story": b.story, "story_sw": b.story_sw, "featured": b.featured, "sort_order": i, "is_active": True})
            out[b.name] = obj
        return out

    # ------------------------------------------------------------------ media
    def _fetch(self, photo_id: str) -> bytes:
        path = CACHE / f"{photo_id}.jpg"
        if path.exists() and path.stat().st_size > 10_000:
            return path.read_bytes()
        r = self.http.get(UNSPLASH.format(id=photo_id))
        r.raise_for_status()
        path.write_bytes(r.content)
        return r.content

    def media_for(self, photo_id: str, *, purpose: str, alt: str = "", focal=(0.5, 0.4)):
        """Upload one image through the real pipeline (renditions, ThumbHash, quality hints). Reused by checksum."""
        from media import pipeline, storage
        from media.models import Media

        data = self._fetch(photo_id)
        sha = hashlib.sha256(data).hexdigest()
        existing = Media.objects.filter(sha256=sha, status="READY", purpose=purpose, deleted_at__isnull=True).first()
        if existing:
            return existing
        mid = uuid.uuid4()
        key = f"{storage.key_prefix()}/uploads/{purpose}/seed/{mid}/{photo_id}.jpg"
        storage.put_bytes(key, data, "image/jpeg", cache_control="private, max-age=0")
        m = Media.objects.create(id=mid, type="IMAGE", status="UPLOADED", purpose=purpose, original_key=key, original_name=f"unsplash-{photo_id}.jpg",
                                 content_type="image/jpeg", declared_bytes=len(data), alt=alt[:200], focal_x=focal[0], focal_y=focal[1])
        pipeline.process(str(m.id))
        m.refresh_from_db()
        self.stdout.write(f"  image {photo_id} → {len(m.variants)} renditions")
        return m

    # ------------------------------------------------------------------ catalog
    def _attrs(self, attrs: dict) -> dict:
        """Keep only attribute values the controlled vocabulary allows (the seed must never fail validation)."""
        from catalog.models import AttributeDefinition

        defs = {d.key: d for d in AttributeDefinition.objects.filter(key__in=list(attrs))}
        out = {}
        for k, v in attrs.items():
            d = defs.get(k)
            if not d:
                continue
            allowed = {x["value"] for x in d.options}
            if d.type == "multiselect":
                vs = [x for x in (v if isinstance(v, list) else [v]) if x in allowed]
                if vs:
                    out[k] = vs
            elif d.type == "select":
                if v in allowed:
                    out[k] = v
            else:
                out[k] = v
        return out

    def _payload(self, s: ProductSeed, brands, stores, media_ids: list[str]) -> dict:
        from catalog.models import Badge, Category
        from catalog.services import categories as cat_svc

        cat = Category.objects.get(slug=s.category)
        allowed = set(cat_svc.effective_attribute_keys(cat))
        attrs = self._attrs({k: v for k, v in s.attributes.items() if k in allowed})
        opt_types, axes = [], []
        if s.colours:
            opt_types.append({"name": "Colour", "kind": "color", "values": [{"value": c, "swatchHex": h} for c, h in s.colours]})
            axes.append(("Colour", [c for c, _ in s.colours]))
        if s.shades:
            opt_types.append({"name": "Shade", "kind": "shade", "values": [{"value": c, "swatchHex": h} for c, h in s.shades]})
            axes.append(("Shade", [c for c, _ in s.shades]))
        if s.sizes:
            opt_types.append({"name": "Size", "kind": "size", "values": [{"value": z} for z in s.sizes]})
            axes.append(("Size", list(s.sizes)))
        if s.volumes:
            opt_types.append({"name": "Volume", "kind": "volume", "values": [{"value": z} for z in s.volumes]})
            axes.append(("Volume", list(s.volumes)))

        combos: list[list[tuple[str, str]]] = [[]]
        for name, vals in axes:
            combos = [c + [(name, v)] for c in combos for v in vals]
        base = slugify(s.title, separator="")[:10].upper()
        store_list = list(stores.values())
        h = int(hashlib.md5(s.title.encode()).hexdigest(), 16)  # noqa: S324 — deterministic stock, not security
        variants = []
        for i, combo in enumerate(combos):
            # First volume is the base price; a travel size is cheaper, any larger size costs more.
            vol = next((v for n, v in combo if n == "Volume"), None)
            price = s.price if not vol or vol == s.volumes[0] else _round500(s.price * (0.45 if "Travel" in vol else 1.6))
            sku = "-".join([base] + [slugify(v, separator="")[:6].upper() for _, v in combo]) or base
            stock = []
            for j, st in enumerate(store_list):
                q = (h >> ((i + j) % 40)) % 9 + (6 if st.kind == "warehouse" else 0)
                if j == 0:
                    q = max(q, 3)
                stock.append({"storeId": str(st.id), "quantity": int(q)})
            tiers = [{"minQty": 6, "unitPrice": _round500(price * 0.86)}, {"minQty": 24, "unitPrice": _round500(price * 0.74)}] if s.wholesale else []
            variants.append({"sku": sku, "optionValues": [{"type": n, "value": v} for n, v in combo], "retailPrice": price,
                             "compareAtPrice": s.compare_at, "wholesaleTiers": tiers, "moq": None, "stock": stock})
        colour_axis = "Colour" if s.colours else "Shade" if s.shades else None
        first_colour = (s.colours or s.shades or [(None, None)])[0][0]
        media = [{"mediaId": mid, "sortOrder": k, "role": "gallery", "alt": s.alt or s.title,
                  "optionValue": {"type": colour_axis, "value": first_colour} if colour_axis and len(s.colours or s.shades) > 1 and k == 0 else None}
                 for k, mid in enumerate(media_ids)]
        badge_ids = list(Badge.objects.filter(key__in=s.badges).values_list("id", flat=True))
        return {
            "title": s.title, "titleSw": s.title_sw, "brandId": str(brands[s.brand].id), "categoryIds": [str(cat.id)], "tagline": s.tagline,
            "descriptionHtml": s.description, "story": s.story, "care": s.care, "materials": s.materials, "countryOfOrigin": s.origin,
            "attributes": attrs, "optionTypes": opt_types, "variants": variants, "media": media, "badgeIds": badge_ids, "featured": s.featured,
            "fitNote": s.fit_note, "tags": list(s.tags), "beauty": s.beauty, "season": "Resort 2026",
            "status": "PUBLISHED" if media_ids else "DRAFT",
        }

    def _products(self, admin, brands, stores):
        from catalog.models import Product
        from catalog.services.categories import refresh_counts
        from catalog.services.products import upsert_product

        out = {}
        for s in PRODUCTS:
            media_ids = [str(self.media_for(pid, purpose="product", alt=s.alt or s.title).id) for pid in s.images] if self.media_on else []
            existing = Product.objects.filter(title=s.title).first()
            if existing and not media_ids:
                out[s.title] = existing  # --no-media re-run: keep the product (and its images) as they are
                continue
            with transaction.atomic():
                p = upsert_product(self._payload(s, brands, stores, media_ids), admin=admin, product=existing, note="seed")
            out[s.title] = p
            self.stdout.write(f"product {p.status.lower():9} {p.title}")
        self._relations(out)
        refresh_counts()
        return out

    def _relations(self, products):
        from catalog.models import ProductRelation

        looks = [
            ("Zuri linen maxi dress", ["Cork footbed sandals", "Wicker & leather basket bag", "Round wire sunglasses"]),
            ("Malkia off-shoulder gown", ["Tanzanite drop earrings", "Bloom print stilettos", "Velvet matte lipstick"]),
            ("Navy tailored suit", ["Everyday oxford shirt", "Cognac leather brogues", "Tan leather belt"]),
            ("High-rise straight jeans", ["Embroidered cotton blouse", "Navy suede pumps", "Canvas market tote"]),
            ("Kanga swing dress", ["Coral top-handle bag", "Crescent layered necklace"]),
            ("Vitamin C glow serum", ["Shea cream cleanser", "Baobab & moringa face oil"]),
        ]
        for head, others in looks:
            p = products.get(head)
            if not p:
                continue
            for i, o in enumerate(others):
                if o in products:
                    ProductRelation.objects.get_or_create(product=p, related=products[o], kind="complete_look", defaults={"sort_order": i})
                    ProductRelation.objects.get_or_create(product=products[o], related=p, kind="pairs_with", defaults={"sort_order": i})

    def _collections(self, admin, products):
        from catalog.models import Collection, CollectionProduct

        now = timezone.now()
        specs = [
            ("the-coastal-edit", "The Coastal Edit", "Mitindo ya Pwani", "Linen, florals and sandals for long days by the ocean.", "rack-neutral", False, None,
             ["Zuri linen maxi dress", "Pwani floral wrap dress", "Striped linen overshirt", "Cork footbed sandals", "Wicker & leather basket bag", "Round wire sunglasses", "Fringed crochet poncho"]),
            ("wedding-guest", "Wedding Guest", "Mgeni wa Harusi", "Gowns, heels and jewels for every ceremony this season.", "rack-studio", False, None,
             ["Malkia off-shoulder gown", "Rubi flowing maxi", "Kanga swing dress", "Bloom print stilettos", "Tanzanite drop earrings", "Freshwater pearl strand", "Navy tailored suit"]),
            ("the-glow-ritual", "The Glow Ritual", "Siri ya Mng'ao", "Clean skincare and melanin-first makeup.", "beauty-face", False, None,
             ["Vitamin C glow serum", "Baobab & moringa face oil", "Daily hydration ritual", "Shea cream cleanser", "Velvet matte lipstick", "Lift & define mascara"]),
            ("modern-tailoring", "Modern Tailoring", "Ushonaji wa Kisasa", "Sharp suits and soft shirting for the working week.", "look-men", False, None,
             ["Navy tailored suit", "Charcoal pinstripe suit", "Everyday oxford shirt", "Chambray dot shirt", "Cognac leather brogues", "Pinstripe wide-leg trousers"]),
            ("kilimanjaro-drop", "Kilimanjaro Drop", "Toleo la Kilimanjaro", "Tanzanite fine jewellery and leather in a strictly limited run.", "hero-african", True, now + timedelta(days=6, hours=4), []),
        ]
        for i, (slug, title, title_sw, sub, cover_key, is_drop, launches, members) in enumerate(specs):
            cover = self.media_for(EDITORIAL[cover_key], purpose="collection", alt=title) if self.media_on else None
            c, _ = Collection.objects.update_or_create(slug=slug, defaults={"title": title, "title_sw": title_sw, "subtitle": sub, "cover": cover, "is_drop": is_drop,
                                                                           "launches_at": launches, "published": True, "sort_order": i})
            for j, name in enumerate(members):
                if name in products:
                    CollectionProduct.objects.update_or_create(collection=c, product=products[name], defaults={"sort_order": j})

    def _riders(self, admin, stores):
        from accounts.models import AuthIdentity, User
        from delivery.models import Rider, Vehicle

        for r in RIDERS:
            u, _ = User.objects.get_or_create(phone=r["phone"], defaults={"name": r["name"], "phone_verified_at": timezone.now()})
            AuthIdentity.objects.get_or_create(provider="phone", subject=r["phone"], defaults={"user": u})
            rider, _ = Rider.objects.update_or_create(user=u, defaults={"status": "ACTIVE", "home_store": stores[r["store"]], "approved_at": timezone.now(), "approved_by": admin, "rating_avg": 4.8})
            Vehicle.objects.update_or_create(rider=rider, is_primary=True, defaults={"type": r["vehicle"], "plate": r["plate"], "color": r["color"], "make": r["make"]})

    def _marketing(self, products, brands):
        from catalog.models import Category, Collection
        from marketing.models import Banner, HomeSection, Look, LookProductTag, Story, StoryItem

        def img(key, purpose, alt=""):
            return self.media_for(EDITORIAL[key], purpose=purpose, alt=alt)

        coastal = Collection.objects.get(slug="the-coastal-edit")
        wedding = Collection.objects.get(slug="wedding-guest")
        glow = Collection.objects.get(slug="the-glow-ritual")
        drop = Collection.objects.get(slug="kilimanjaro-drop")
        banners = [
            Banner.objects.update_or_create(title="The Coastal Edit", defaults={"title_sw": "Mitindo ya Pwani", "eyebrow": "New season", "subtitle": "Linen, light and ocean air", "media": img("hero-rack", "branding", "Linen pieces on a rail"), "link": {"type": "collection", "id": str(coastal.id)}, "cta_label": "Shop the edit", "theme": "dark", "sort_order": 0})[0],
            Banner.objects.update_or_create(title="Dressed for the ceremony", defaults={"title_sw": "Mavazi ya sherehe", "eyebrow": "Wedding guest", "subtitle": "Gowns, heels and jewels", "media": img("hero-shopping", "branding", "Woman carrying shopping bags"), "link": {"type": "collection", "id": str(wedding.id)}, "cta_label": "Discover", "theme": "light", "sort_order": 1})[0],
            Banner.objects.update_or_create(title="Made in Tanzania", defaults={"title_sw": "Imetengenezwa Tanzania", "eyebrow": "Our makers", "subtitle": "Prints, leather and jewels from home", "media": img("hero-african", "branding", "Portrait of a woman in a printed blouse"), "link": {"type": "collection", "id": str(drop.id)}, "cta_label": "Meet the makers", "theme": "light", "sort_order": 2})[0],
        ]
        stories = [
            ("New in", "drop", "rack-colour", "Fresh drops every Friday", {"type": "collection", "id": str(coastal.id)}),
            ("Glow", "tutorial", "beauty-eye", "Three steps to a lit-from-within glow", {"type": "collection", "id": str(glow.id)}),
            ("Makers", "brand", "hero-african", "Inside the Kanga House studio", {"type": "brand", "id": str(brands["Kanga House"].id)}),
            ("Weddings", "editorial", "rack-studio", "What to wear to a Swahili wedding", {"type": "collection", "id": str(wedding.id)}),
            ("Skin", "tutorial", "skincare-stones", "Your evening ritual, simplified", {"type": "collection", "id": str(glow.id)}),
        ]
        for i, (title, kind, key, caption, link) in enumerate(stories):
            m = img(key, "story", title)
            s, _ = Story.objects.update_or_create(title=title, defaults={"kind": kind, "cover": m, "sort_order": i, "is_active": True})
            StoryItem.objects.update_or_create(story=s, sort_order=0, defaults={"media": m, "caption": caption, "link": link})
        looks = [
            ("look-stairs", "Sunday in white linen.", "Jumapili kwa kitani cheupe.", "women", [("Zuri linen maxi dress", 0.5, 0.55), ("Cork footbed sandals", 0.52, 0.92)]),
            ("look-floral", "Ruffles, but make it effortless.", "Mikunjo kwa urahisi.", "women", [("Asali ruffle dress", 0.45, 0.5)]),
            ("look-coat", "Long rains, sharp lines.", "Masika kwa mtindo.", "women", [("Powder blue trench", 0.5, 0.45)]),
            ("look-men", "Utility layers for the city.", "Tabaka za mjini.", "men", [("Washed field jacket", 0.42, 0.35), ("Essential heavyweight tee", 0.45, 0.5)]),
            ("look-sweater", "Colour-block, cool evenings.", "Rangi mbili, jioni baridi.", "women", [("Colour-block knit sweater", 0.5, 0.35)]),
            ("look-denim", "Soft pink, washed denim.", "Waridi na jinzi.", "men", [("Pink crew knit", 0.5, 0.35)]),
        ]
        for i, (key, cap, cap_sw, dept, tags) in enumerate(looks):
            m = img(key, "look", cap)
            lk, _ = Look.objects.update_or_create(media=m, defaults={"caption": cap, "caption_sw": cap_sw, "department": dept, "published": True, "published_at": timezone.now() - timedelta(hours=i * 7), "sort_order": i, "credit": "Unsplash"})
            for j, (name, x, y) in enumerate(tags):
                if name in products:
                    LookProductTag.objects.update_or_create(look=lk, product=products[name], defaults={"x": x, "y": y, "sort_order": j})

        beauty = Category.objects.get(slug="beauty")
        brands["Maison Pwani"].cover = img("rack-neutral", "brand", "Maison Pwani studio rail")
        brands["Maison Pwani"].save(update_fields=["cover"])
        brands["Baobab Botanics"].cover = img("skincare-stones", "brand", "Baobab Botanics skincare")
        brands["Baobab Botanics"].save(update_fields=["cover"])
        sections = [
            ("stories", "", {}), ("hero", "", {"bannerIds": [str(b.id) for b in banners], "autoAdvanceMs": 5500}),
            ("new_in", "New in", {"days": 60, "limit": 10}), ("collections", "Curated for you", {"collectionIds": [str(coastal.id), str(wedding.id), str(glow.id)]}),
            ("drop_countdown", "Coming soon", {"collectionId": str(drop.id)}), ("category_tiles", "Shop by category", {}),
            ("for_you", "For you", {"limit": 12}), ("brand_spotlight", "Brand spotlight", {"brandId": str(brands["Maison Pwani"].id)}),
            ("beauty_corner", "Beauty corner", {"categoryId": str(beauty.id), "limit": 10}), ("looks_teaser", "Shop the look", {"limit": 6}),
            ("recently_viewed", "Recently viewed", {"limit": 10}),
        ]
        titles_sw = {"New in": "Mpya", "Curated for you": "Tumekuchagulia", "Coming soon": "Inakuja", "Shop by category": "Nunua kwa aina", "For you": "Kwa ajili yako",
                     "Brand spotlight": "Chapa maalum", "Beauty corner": "Kona ya urembo", "Shop the look": "Nunua mtindo", "Recently viewed": "Ulivyotazama"}
        for i, (typ, title, cfg) in enumerate(sections):
            HomeSection.objects.update_or_create(type=typ, title=title, defaults={"title_sw": titles_sw.get(title, ""), "config": cfg, "sort_order": i, "is_active": True})

    def _credits(self):
        from catalog.seed.catalog import EDITORIAL as ED

        ids = sorted({i for p in PRODUCTS for i in p.images} | set(ED.values()))
        doc = Path(__file__).resolve().parents[5] / "docs" / "IMAGE_CREDITS.md"
        lines = ["# Image credits", "", "Seed and demo imagery is from [Unsplash](https://unsplash.com) under the [Unsplash License](https://unsplash.com/license)",
                 "(free for commercial and non-commercial use; attribution appreciated, not required). Images were chosen so that no logo,",
                 "watermark or text appears on the product. Brands in the seed catalog are fictional.", "", "| Photo ID | Used for |", "|---|---|"]
        used: dict[str, list[str]] = {}
        for p in PRODUCTS:
            for i in p.images:
                used.setdefault(i, []).append(p.title)
        for k, v in ED.items():
            used.setdefault(v, []).append(k)
        for i in ids:
            lines.append(f"| [`{i}`](https://images.unsplash.com/photo-{i}) | {', '.join(used[i])} |")
        doc.write_text("\n".join(lines) + "\n")
