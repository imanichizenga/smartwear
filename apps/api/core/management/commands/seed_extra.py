"""
`python manage.py seed_extra` — layer a bigger demo catalog on top of `seed`: Sports & Activewear department,
denim shop, more beauty, bags, streetwear and kidswear with multi-photo galleries and product video clips,
plus video stories, shoppable video Looks, collections and home banners. Idempotent (products by title).

Run `seed` first (taxonomy, stores, base brands). Media goes through the real pipeline into the configured S3.
  --only-products   skip marketing (stories/looks/collections/banners)
  --limit N         only the first N products (smoke test)
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import timedelta
from pathlib import Path

from django.core.management.base import CommandError
from django.db import transaction
from django.utils import timezone
from slugify import slugify

from catalog.seed.extra import (
    BANNERS, BURST, COLLECTIONS, EXTRA, IMAGE_LOOKS, MIXKIT, MIXKIT_URLS, NEW_BRANDS, SPORT_CATEGORIES, SPORT_ROOT_NAME, SPORT_ROOT_NAME_SW, VIDEO_LOOKS, VIDEO_STORIES,
)

from .seed import Command as BaseSeed

CACHE = Path(__file__).resolve().parents[3] / ".seed-cache"


class Command(BaseSeed):
    help = "Add the extended demo catalog (sports, denim, beauty, videos) on top of `seed`."

    def add_arguments(self, parser):
        parser.add_argument("--admin-email", default="akilainnocent@smartwear.co.tz")
        parser.add_argument("--only-products", action="store_true")
        parser.add_argument("--limit", type=int, default=0)

    # ------------------------------------------------------------------ entry
    def handle(self, *args, **o):
        import httpx

        from accounts.models import AdminUser
        from media import storage

        if not storage.configured():
            raise CommandError("Media storage isn't configured. Add S3 credentials in Admin → Settings first.")
        admin = AdminUser.objects.filter(email__iexact=o["admin_email"]).first()
        if not admin:
            raise CommandError(f"No admin {o['admin_email']} — run `seed` first or pass --admin-email.")
        self.media_on = True
        self.http = httpx.Client(timeout=120, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (SmartWear demo seed)"})
        CACHE.mkdir(exist_ok=True)

        from inventory.models import Store

        stores = {s.code: s for s in Store.objects.filter(is_active=True).order_by("sort_order")}
        if not stores:
            raise CommandError("No stores — run `seed` first.")
        self._sports_department(admin)
        brands = self._all_brands()
        products = self._extra_products(admin, brands, stores, o["limit"])
        if not o["only_products"]:
            self._extra_marketing(products)
        self.stdout.write(self.style.SUCCESS(f"\nExtra catalog: {len(products)} products ready."))

    # ------------------------------------------------------------------ taxonomy & brands
    def _sports_department(self, admin):
        from catalog.models import Category
        from catalog.services import categories as cat_svc

        from catalog.services.seed_taxonomy import ensure_root

        # Only the Activewear branch of the standard tree (Women, Men, Training shoes) — other optional departments stay off.
        root = ensure_root("activewear", with_tree=True)
        Category.objects.filter(id=root.id).update(name=SPORT_ROOT_NAME, name_sw=SPORT_ROOT_NAME_SW, is_active=True, show_in_nav=True, is_featured=True,
                                                   description="Football, basketball, running, gym and yoga — kits, shoes and training wear.")
        attrs = {"activewear-jerseys": ["occasion", "fit", "pattern", "material", "season", "sleeve", "neckline"],
                 "activewear-football-boots": ["toe_shape", "closure", "shoe_material", "occasion"],
                 "activewear-accessories": ["occasion", "material"]}
        for slug, name, name_sw, dept, icon in SPORT_CATEGORIES:
            if not Category.objects.filter(slug=slug).exists():
                cat_svc.create({"parentId": str(root.id), "name": name, "nameSw": name_sw, "slug": slug, "department": dept, "icon": icon, "attributeKeys": attrs.get(slug, [])}, admin=admin)
        self.stdout.write(f"department: {SPORT_ROOT_NAME} ({Category.objects.filter(root_key='activewear').count()} categories)")

    def _all_brands(self):
        from catalog.models import Brand

        start = Brand.objects.count()
        for i, b in enumerate(NEW_BRANDS):
            Brand.objects.update_or_create(slug=slugify(b.name), defaults={"name": b.name, "country": b.country, "story": b.story, "story_sw": b.story_sw,
                                                                         "featured": b.featured, "sort_order": start + i, "is_active": True})
        return {b.name: b for b in Brand.objects.all()}

    # ------------------------------------------------------------------ media
    def _download(self, url: str, name: str) -> bytes:
        path = CACHE / name
        if path.exists() and path.stat().st_size > 10_000:
            return path.read_bytes()
        r = self.http.get(url)
        r.raise_for_status()
        path.write_bytes(r.content)
        return r.content

    def _fetch(self, ref: str) -> bytes:  # used by BaseSeed.media_for
        if ref.startswith("b:"):
            return self._download(BURST.format(slug=ref[2:]), f"burst-{ref[2:]}.jpg")
        if ref.startswith("u:"):
            ref = ref[2:]
        return super()._fetch(ref)

    def image(self, ref: str, purpose: str, alt: str = ""):
        return self.media_for(ref, purpose=purpose, alt=alt)

    def video(self, clip_id: str, seconds: int, purpose: str, alt: str = ""):
        """Short clip (trimmed) through the real video pipeline: H.264 renditions, poster, muted preview loop."""
        from media import pipeline, storage
        from media.models import Media

        try:
            data = self._download(MIXKIT_URLS.get(clip_id) or MIXKIT.format(id=clip_id), f"mixkit-{clip_id}.mp4")
        except Exception as e:  # noqa: BLE001 — a missing clip must never block the product or section
            self.stdout.write(self.style.WARNING(f"  video {clip_id} unavailable: {e}"))
            return None
        sha = hashlib.sha256(data).hexdigest()
        existing = (Media.objects.filter(original_name=f"mixkit-{clip_id}.mp4", status="READY", type="VIDEO", deleted_at__isnull=True).order_by("-created_at").first()
                    or Media.objects.filter(sha256=sha, status="READY", type="VIDEO", deleted_at__isnull=True).first())
        if existing:
            return existing
        mid = uuid.uuid4()
        key = f"{storage.key_prefix()}/uploads/{purpose}/seed/{mid}/mixkit-{clip_id}.mp4"
        storage.put_bytes(key, data, "video/mp4", cache_control="private, max-age=0")
        m = Media.objects.create(id=mid, type="VIDEO", status="UPLOADED", purpose=purpose, original_key=key, original_name=f"mixkit-{clip_id}.mp4",
                                 content_type="video/mp4", declared_bytes=len(data), alt=alt[:200], options={"trim": {"startMs": 0, "endMs": seconds * 1000}})
        pipeline.process(str(m.id))
        m.refresh_from_db()
        self.stdout.write(f"  video {clip_id} → {m.status} ({len(m.variants or [])} renditions){' ' + m.error if m.status != 'READY' else ''}")
        return m if m.status == "READY" else None

    # ------------------------------------------------------------------ products
    def _extra_products(self, admin, brands, stores, limit: int, catalogue=EXTRA, note: str = "seed_extra"):
        from catalog.models import Product
        from catalog.services.categories import refresh_counts
        from catalog.services.products import upsert_product

        out = {}
        items = catalogue[:limit] if limit else catalogue
        for n, x in enumerate(items, 1):
            s = x.p
            self.stdout.write(f"[{n}/{len(items)}] {s.title}")
            self.stdout.flush()
            try:
                imgs = [self.image(ref, "product", s.alt or s.title) for ref in s.images]
                vids = [v for v in (self.video(cid, secs, "product", s.title) for cid, secs in x.videos) if v]
            except Exception as e:  # noqa: BLE001 — one bad download must not stop the whole catalog
                self.stdout.write(self.style.WARNING(f"  skipped media for {s.title}: {e}"))
                continue
            payload = self._payload(s, brands, stores, [str(m.id) for m in imgs])
            axis = "Colour" if s.colours else "Shade" if s.shades else None
            media = []
            for k, m in enumerate(imgs):
                ov = next((val for val, idx in x.colour_images.items() if idx == k), None) if axis else None
                media.append({"mediaId": str(m.id), "sortOrder": k, "role": "gallery", "alt": s.alt or s.title, "optionValue": {"type": axis, "value": ov} if ov else None})
            for j, v in enumerate(vids):
                media.append({"mediaId": str(v.id), "sortOrder": len(imgs) + j, "role": "video", "alt": f"{s.title} video"})
            payload["media"] = media
            existing = Product.objects.filter(title=s.title).first()
            with transaction.atomic():
                p = upsert_product(payload, admin=admin, product=existing, note=note)
            out[s.title] = p
            self.stdout.write(f"  product {p.status.lower()} · {len(imgs)} photos · {len(vids)} video")
            self.stdout.flush()
        refresh_counts()
        # Make previously-seeded products available for tagging too.
        for p in Product.objects.filter(deleted_at__isnull=True) if hasattr(Product, "deleted_at") else Product.objects.all():
            out.setdefault(p.title, p)
        return out

    # ------------------------------------------------------------------ marketing
    def _extra_marketing(self, products):
        from catalog.models import Category, Collection, CollectionProduct
        from marketing.models import Banner, HomeSection, Look, LookProductTag, Story, StoryItem

        cols = {}
        start = Collection.objects.count()
        for i, (slug, title, title_sw, sub, cover_ref, members) in enumerate(COLLECTIONS):
            cover = self.image(cover_ref, "collection", title)
            c, _ = Collection.objects.update_or_create(slug=slug, defaults={"title": title, "title_sw": title_sw, "subtitle": sub, "cover": cover, "published": True, "sort_order": start + i})
            for j, name in enumerate(members):
                if name in products:
                    CollectionProduct.objects.update_or_create(collection=c, product=products[name], defaults={"sort_order": j})
            cols[slug] = c
            self.stdout.write(f"collection {title}: {c.products.count() if hasattr(c, 'products') else len(members)} products")

        b_start = Banner.objects.count()
        for i, (title, title_sw, eyebrow, sub, ref, col, cta, theme) in enumerate(BANNERS):
            m = self.image(ref, "branding", title)
            Banner.objects.update_or_create(title=title, defaults={"title_sw": title_sw, "eyebrow": eyebrow, "subtitle": sub, "media": m, "link": {"type": "collection", "id": str(cols[col].id)},
                                                                 "cta_label": cta, "theme": theme, "sort_order": b_start + i, "is_active": True})
        hero = HomeSection.objects.filter(type="hero").first()
        if hero:
            hero.config = {**(hero.config or {}), "bannerIds": [str(b.id) for b in Banner.objects.filter(is_active=True).order_by("sort_order")]}
            hero.save(update_fields=["config"])

        s_start = Story.objects.count()
        for i, (title, kind, cid, secs, caption, (ltype, lslug)) in enumerate(VIDEO_STORIES):
            v = self.video(cid, secs, "story", title)
            if not v:
                continue
            link = {"type": "collection", "id": str(cols[lslug].id)} if ltype == "collection" else {"type": "category", "id": str(Category.objects.get(slug=lslug).id)}
            st, _ = Story.objects.update_or_create(title=title, defaults={"kind": kind, "cover": v, "sort_order": s_start + i, "is_active": True})
            StoryItem.objects.update_or_create(story=st, sort_order=0, defaults={"media": v, "caption": caption, "link": link, "duration_ms": secs * 1000})
            self.stdout.write(f"story {title} (video)")

        l_start = Look.objects.count()
        looks = [(self.video(cid, secs, "look", cap), cap, cap_sw, dept, tags) for cid, secs, cap, cap_sw, dept, tags in VIDEO_LOOKS]
        looks += [(self.image(ref, "look", cap), cap, cap_sw, dept, tags) for ref, cap, cap_sw, dept, tags in IMAGE_LOOKS]
        for i, (m, cap, cap_sw, dept, tags) in enumerate(looks):
            if not m:
                continue
            lk, _ = Look.objects.update_or_create(media=m, defaults={"caption": cap, "caption_sw": cap_sw, "department": dept, "published": True,
                                                                   "published_at": timezone.now() - timedelta(hours=i * 3), "sort_order": l_start + i, "credit": "Mixkit" if m.type == "VIDEO" else "Burst"})
            for j, (name, x, y) in enumerate(tags):
                if name in products:
                    LookProductTag.objects.update_or_create(look=lk, product=products[name], defaults={"x": x, "y": y, "sort_order": j})
            self.stdout.write(f"look {'video' if m.type == 'VIDEO' else 'image'}: {cap}")

        # Home: a row for the new collections, and a Sports & Activewear product rail.
        HomeSection.objects.update_or_create(type="collections", title="Shop the new edits", defaults={
            "title_sw": "Nunua mikusanyiko mipya", "config": {"collectionIds": [str(cols[k].id) for k in ("matchday", "the-denim-shop", "beauty-lab", "run-and-train", "street-essentials")]},
            "sort_order": 4, "is_active": True})
        sports = Category.objects.filter(parent__isnull=True, root_key="activewear").first()
        if sports:
            HomeSection.objects.update_or_create(type="product_rail", title="Sports & Activewear", defaults={
                "title_sw": "Michezo na Mazoezi", "config": {"categoryId": str(sports.id), "limit": 12}, "sort_order": 9, "is_active": True})
