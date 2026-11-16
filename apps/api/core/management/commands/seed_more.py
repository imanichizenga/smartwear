"""
`python manage.py seed_more` — a third demo layer on top of `seed` + `seed_extra`: a jersey shop of fictional clubs
(rendered kit images, front/back/detail), more women's, men's and kids' clothing, and more beauty (lips, eyes,
nails, skincare, soaps, hair oil, fragrance). Adds "The Jersey Shop" and "New in beauty" collections and a jerseys
rail on Home. Idempotent: products match by title, images by source name.

  --only-products   skip collections and the Home rail
  --limit N         only the first N products (smoke test)
"""
from __future__ import annotations

from catalog.seed import kit_art
from catalog.seed.more import COLLECTIONS, KITS, MORE, MORE_BRANDS

from .seed_extra import CACHE
from .seed_extra import Command as ExtraSeed


class Command(ExtraSeed):
    help = "Add the jersey shop, more clothing and more beauty on top of `seed_extra`."

    def handle(self, *args, **o):
        import httpx
        from django.core.management.base import CommandError
        from slugify import slugify

        from accounts.models import AdminUser
        from catalog.models import Brand, Category
        from inventory.models import Store
        from media import storage

        if not storage.configured():
            raise CommandError("Media storage isn't configured. Add S3 credentials in Admin → Settings first.")
        admin = AdminUser.objects.filter(email__iexact=o["admin_email"]).first()
        if not admin:
            raise CommandError(f"No admin {o['admin_email']} — run `seed` first or pass --admin-email.")
        if not Category.objects.filter(slug="activewear-jerseys").exists():
            raise CommandError("Run `seed_extra` first (it creates the Sports & Activewear department).")
        stores = {s.code: s for s in Store.objects.filter(is_active=True).order_by("sort_order")}
        if not stores:
            raise CommandError("No stores — run `seed` first.")
        self.media_on = True
        self.http = httpx.Client(timeout=120, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (SmartWear demo seed)"})
        CACHE.mkdir(exist_ok=True)

        start = Brand.objects.count()
        for i, b in enumerate(MORE_BRANDS):
            Brand.objects.update_or_create(slug=slugify(b.name), defaults={"name": b.name, "country": b.country, "story": b.story, "story_sw": b.story_sw,
                                                                         "featured": b.featured, "sort_order": start + i, "is_active": True})
        brands = {b.name: b for b in Brand.objects.all()}
        products = self._extra_products(admin, brands, stores, o["limit"], catalogue=MORE, note="seed_more")
        if not o["only_products"]:
            self._more_marketing(products)
        self.stdout.write(self.style.SUCCESS(f"\nMore catalog: {sum(1 for x in MORE if x.p.title in products)} of {len(MORE)} products ready."))

    def _payload(self, s, brands, stores, media_ids):
        """Same as `seed`, but many titles here share their first 10 letters (home/away kits), so SKUs get a title hash."""
        import hashlib

        from slugify import slugify

        payload = super()._payload(s, brands, stores, media_ids)
        base = slugify(s.title, separator="")[:10].upper()
        tag = base[:7] + hashlib.md5(s.title.encode()).hexdigest()[:3].upper()  # noqa: S324 — a label, not security
        for v in payload["variants"]:
            v["sku"] = tag + v["sku"][len(base):]
        return payload

    def _fetch(self, ref: str) -> bytes:
        if ref.startswith("k:"):  # rendered kit — k:<kit id>:<front|back|detail>
            _, kit_id, view = ref.split(":")
            path = CACHE / f"kit-{kit_id}-{view}.jpg"
            if not path.exists():
                path.write_bytes(kit_art.render(KITS[kit_id], view))
            return path.read_bytes()
        return super()._fetch(ref)

    def _more_marketing(self, products):
        from catalog.models import Category, Collection, CollectionProduct
        from marketing.models import HomeSection

        start = Collection.objects.count()
        for i, (slug, title, title_sw, sub, cover_ref, members) in enumerate(COLLECTIONS):
            cover = self.image(cover_ref, "collection", title)
            c, _ = Collection.objects.update_or_create(slug=slug, defaults={"title": title, "title_sw": title_sw, "subtitle": sub, "cover": cover, "published": True,
                                                                          "sort_order": Collection.objects.filter(slug=slug).values_list("sort_order", flat=True).first() or start + i})
            for j, name in enumerate(members):
                if name in products:
                    CollectionProduct.objects.update_or_create(collection=c, product=products[name], defaults={"sort_order": j})
            self.stdout.write(f"collection {title}: {len(members)} products")
        jerseys = Category.objects.filter(slug="activewear-jerseys").first()
        if jerseys:
            HomeSection.objects.update_or_create(type="product_rail", title="Jerseys & kits", defaults={
                "title_sw": "Jezi na sare", "config": {"categoryId": str(jerseys.id), "limit": 12}, "sort_order": 8, "is_active": True})
            self.stdout.write("home rail: Jerseys & kits")
