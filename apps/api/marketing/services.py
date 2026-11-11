"""Home layout builder → the exact payload the mobile Home screen renders, section by section."""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.db.models import Q
from django.utils import timezone

from catalog.models import Brand, Category, Collection, Product, ProductView
from catalog.services.products import card_queryset, cards
from catalog.services.search import collection_rule_q, published
from catalog.services.viewer import context_for_user
from core.media_urls import media_out

from .models import Banner, HomeSection, Look, Story, StoryView


def _live(qs):
    now = timezone.now()
    return qs.filter(Q(starts_at__isnull=True) | Q(starts_at__lte=now)).filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))


def viewer_profile(user) -> dict:
    if user is None:
        return {"signedIn": False, "customerType": "RETAIL", "departments": []}
    return {"signedIn": True, "customerType": "WHOLESALE" if user.customer_type == "WHOLESALE" and user.wholesale_approved else "RETAIL", "departments": (user.style_profile or {}).get("departments") or []}


def _segment_ok(seg: dict, prof: dict) -> bool:
    if not seg:
        return True
    if seg.get("signedIn") is True and not prof["signedIn"]:
        return False
    if seg.get("signedIn") is False and prof["signedIn"]:
        return False
    if seg.get("customerTypes") and prof["customerType"] not in seg["customerTypes"]:
        return False
    if seg.get("departments") and prof["departments"] and not set(prof["departments"]) & set(seg["departments"]):
        return False
    return True


def _cards(qs, user, locale: str, limit: int) -> list[dict]:
    rows = list(card_queryset(qs)[:limit])
    return cards(rows, context_for_user(user), user=user, locale=locale)


def for_you_queryset(user):
    """Honest personalisation: quiz departments/styles, recent views, wishlist and purchase categories."""
    base = published().filter(in_stock=True)
    if user is None:
        return base.order_by("-popularity", "-published_at")
    prof = user.style_profile or {}
    deps = prof.get("departments") or []
    q = Q()
    if deps:
        q |= Q(department__in=deps + ["unisex"])
    viewed_cats = list(Category.objects.filter(primary_products__in=ProductView.objects.filter(user=user).order_by("-viewed_at").values("product_id")[:30]).values_list("path", flat=True).distinct()[:6])
    from commerce.models import OrderItem, WishlistItem

    wish_cats = list(Category.objects.filter(primary_products__wishlist_items__board__user=user).values_list("path", flat=True).distinct()[:6])
    bought = list(Category.objects.filter(primary_products__in=OrderItem.objects.filter(order__user=user).values("product_id")).values_list("path", flat=True).distinct()[:6])
    for path in {*viewed_cats, *wish_cats, *bought}:
        parent = path.rsplit("/", 1)[0]
        q |= Q(category_links__category__path__startswith=parent)
    styles = [s.lower() for s in prof.get("styles") or []]
    for s in styles[:6]:
        q |= Q(tags__contains=[s])
    seen = OrderItem.objects.filter(order__user=user).values("product_id")
    qs = base.filter(q).exclude(id__in=seen) if q else base
    if not qs.exists():
        qs = base
    return qs.distinct().order_by("-popularity", "-published_at")


def render_home(user, locale: str = "en", *, profile: dict | None = None) -> dict[str, Any]:
    """`profile` lets Admin preview a segment without a real user (no per-user rows are read)."""
    prof = profile or viewer_profile(user)
    sections = []
    for s in _live(HomeSection.objects.filter(is_active=True)).order_by("sort_order"):
        if not _segment_ok(s.segment or {}, prof):
            continue
        cfg = s.config or {}
        title = s.title_sw if locale == "sw" and s.title_sw else s.title
        limit = int(cfg.get("limit", 10))
        out: dict[str, Any] = {"id": str(s.id), "type": s.type, "title": title or None, "subtitle": s.subtitle or None}
        if s.type == "stories":
            seen = set(StoryView.objects.filter(user=user).values_list("story_id", flat=True)) if user else set()
            stories = list(_live(Story.objects.filter(is_active=True)).select_related("cover", "brand").prefetch_related("items__media").order_by("sort_order")[:20])
            out["items"] = [story_out(st, seen=st.id in seen) for st in stories]
            out["items"].sort(key=lambda x: x["seen"])
            if not out["items"]:
                continue
        elif s.type in ("hero", "banner"):
            qs = _live(Banner.objects.filter(is_active=True)).select_related("media")
            if cfg.get("bannerIds"):
                qs = qs.filter(id__in=cfg["bannerIds"])
            out["items"] = [banner_out(b, locale) for b in qs.order_by("sort_order")[:8]]
            out["autoAdvanceMs"] = cfg.get("autoAdvanceMs", 5500)
            if not out["items"]:
                continue
        elif s.type == "new_in":
            out["items"] = _cards(published().filter(published_at__gte=timezone.now() - timedelta(days=int(cfg.get("days", 30)))).order_by("-published_at"), user, locale, limit)
            out["link"] = {"type": "products", "params": {"isNew": "1", "sort": "newest"}}
        elif s.type == "collections":
            now = timezone.now()
            qs = Collection.objects.filter(published=True).filter(Q(launches_at__isnull=True) | Q(launches_at__lte=now)).filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now)).select_related("cover")
            if cfg.get("collectionIds"):
                qs = qs.filter(id__in=cfg["collectionIds"])
            out["items"] = [{"id": str(c.id), "slug": c.slug, "title": c.title_sw if locale == "sw" and c.title_sw else c.title, "subtitle": c.subtitle or None, "cover": media_out(c.cover) if c.cover_id else None} for c in qs.order_by("sort_order")[:8]]
        elif s.type == "for_you":
            out["items"] = _cards(for_you_queryset(user), user, locale, limit)
            out["personalised"] = user is not None
        elif s.type == "brand_spotlight":
            b = Brand.objects.filter(id=cfg.get("brandId")).select_related("cover", "logo").first() if cfg.get("brandId") else Brand.objects.filter(featured=True, is_active=True).select_related("cover", "logo").order_by("?").first()
            if b is None:
                continue
            out["brand"] = {"id": str(b.id), "slug": b.slug, "name": b.name, "story": (b.story_sw if locale == "sw" and b.story_sw else b.story)[:280] or None, "cover": media_out(b.cover) if b.cover_id else None, "logo": media_out(b.logo) if b.logo_id else None}
            out["items"] = _cards(published().filter(brand=b).order_by("-popularity"), user, locale, limit)
        elif s.type == "beauty_corner":
            root = Category.objects.filter(root_key="beauty", parent__isnull=True).first()
            if root is None:
                continue
            out["categories"] = [{"id": str(c.id), "slug": c.slug, "name": c.name_sw if locale == "sw" and c.name_sw else c.name, "image": media_out(c.image) if c.image_id else None, "icon": c.icon or None} for c in root.children.filter(is_active=True, archived_at__isnull=True).select_related("image").order_by("sort_order")]
            out["items"] = _cards(published().filter(category_links__category__path__startswith="beauty").distinct().order_by("-popularity"), user, locale, limit)
        elif s.type == "recently_viewed":
            if user is None:
                continue
            ids = list(ProductView.objects.filter(user=user).order_by("-viewed_at").values_list("product_id", flat=True)[:limit])
            if not ids:
                continue
            by = {p["id"]: p for p in _cards(published().filter(id__in=ids), user, locale, limit)}
            out["items"] = [by[str(i)] for i in ids if str(i) in by]
        elif s.type == "drop_countdown":
            now = timezone.now()
            qs = Collection.objects.filter(published=True, is_drop=True, launches_at__gt=now).select_related("cover")
            if cfg.get("collectionId"):
                qs = qs.filter(id=cfg["collectionId"])
            c = qs.order_by("launches_at").first()
            if c is None:
                continue
            from .models import DropSubscription

            out["drop"] = {"id": str(c.id), "slug": c.slug, "title": c.title_sw if locale == "sw" and c.title_sw else c.title, "subtitle": c.subtitle or None, "cover": media_out(c.cover) if c.cover_id else None, "launchesAt": c.launches_at.isoformat(), "subscribed": DropSubscription.objects.filter(collection=c, user=user).exists() if user else False}
        elif s.type == "category_tiles":
            qs = Category.objects.filter(is_active=True, archived_at__isnull=True).select_related("image")
            qs = qs.filter(id__in=cfg["categoryIds"]) if cfg.get("categoryIds") else qs.filter(parent__isnull=True)
            out["items"] = [{"id": str(c.id), "slug": c.slug, "name": c.name_sw if locale == "sw" and c.name_sw else c.name, "image": media_out(c.image) if c.image_id else None, "icon": c.icon or None} for c in qs.order_by("sort_order")]
        elif s.type == "product_rail":
            qs = published()
            if cfg.get("productIds"):
                ids = cfg["productIds"]
                by = {p["id"]: p for p in _cards(qs.filter(id__in=ids), user, locale, len(ids))}
                out["items"] = [by[str(i)] for i in ids if str(i) in by]
            else:
                if cfg.get("categoryId"):
                    c = Category.objects.filter(id=cfg["categoryId"]).first()
                    if c:
                        qs = qs.filter(Q(category_links__category__path=c.path) | Q(category_links__category__path__startswith=c.path + "/")).distinct()
                        out["link"] = {"type": "category", "slug": c.slug}
                if cfg.get("collectionId"):
                    coll = Collection.objects.filter(id=cfg["collectionId"]).first()
                    if coll:
                        qs = qs.filter(collection_rule_q(coll)).distinct()
                        out["link"] = {"type": "collection", "slug": coll.slug}
                if cfg.get("tag"):
                    qs = qs.filter(tags__contains=[cfg["tag"]])
                out["items"] = _cards(qs.order_by({"newest": "-published_at", "price_asc": "min_price"}.get(cfg.get("sort"), "-popularity")), user, locale, limit)
        elif s.type == "looks_teaser":
            out["items"] = [look_out(lk, user, locale, compact=True) for lk in Look.objects.filter(published=True).select_related("media").order_by("-published_at")[:limit]]
        if out.get("items") == [] and s.type not in ("drop_countdown", "brand_spotlight"):
            continue
        sections.append(out)
    return {"sections": sections, "generatedAt": timezone.now().isoformat()}


def banner_out(b: Banner, locale: str = "en") -> dict:
    return {"id": str(b.id), "title": b.title_sw if locale == "sw" and b.title_sw else b.title, "subtitle": b.subtitle or None, "eyebrow": b.eyebrow or None, "media": media_out(b.media), "link": b.link, "ctaLabel": b.cta_label or None, "theme": b.theme}


def story_out(s: Story, seen: bool = False) -> dict:
    return {"id": str(s.id), "title": s.title, "kind": s.kind, "cover": media_out(s.cover), "brand": {"name": s.brand.name, "slug": s.brand.slug} if s.brand_id else None, "seen": seen,
            "items": [{"id": i.id, "media": media_out(i.media), "caption": i.caption or None, "durationMs": i.duration_ms, "link": i.link or None} for i in s.items.all()]}


def look_out(lk: Look, user, locale: str = "en", compact: bool = False, reactions: dict | None = None) -> dict:
    out = {"id": str(lk.id), "media": media_out(lk.media), "caption": (lk.caption_sw if locale == "sw" and lk.caption_sw else lk.caption) or None, "credit": lk.credit or None,
           "likes": lk.likes_count, "saves": lk.saves_count, "liked": bool(reactions and (lk.id, "like") in reactions), "saved": bool(reactions and (lk.id, "save") in reactions)}
    if not compact:
        tags = list(lk.tags.select_related("product").all())
        prod_cards = {c["id"]: c for c in _cards(published().filter(id__in=[t.product_id for t in tags]), user, locale, 20)}
        out["tags"] = [{"x": t.x, "y": t.y, "product": prod_cards[str(t.product_id)]} for t in tags if str(t.product_id) in prod_cards]
    return out
