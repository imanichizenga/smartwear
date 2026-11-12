"""Product reads (cards, detail) and the admin write path (upsert, publish, versions, quality hints)."""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from typing import Any

from django.contrib.postgres.search import SearchVector
from django.db import IntegrityError, transaction
from django.db.models import Count, Prefetch
from django.utils import timezone
from slugify import slugify

from core import settings_service
from core.audit import audit
from core.exceptions import ApiError
from core.media_urls import media_out
from inventory.models import InventoryLevel, Store
from media.models import Media

from ..models import (
    AttributeDefinition, Badge, Brand, Category, Collection, CollectionProduct, OptionType, OptionValue, PriceTier, Product,
    ProductCategory, ProductMedia, ProductRelation, ProductVariant, ProductVersion, SizeChart,
)
from ..pricing import PricingContext, Tier, VariantPricing, apply_rounding, can_see_wholesale, tier_table, unit_price_for
from . import categories as cat_svc

logger = logging.getLogger("smartwear.catalog")
HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
SKU_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


# ================================================================ pricing display
def variant_pricing(v: ProductVariant) -> VariantPricing:
    tiers = [Tier(t.min_qty, t.unit_price) for t in v.tiers.all()]
    return VariantPricing(v.retail_price, v.currency, v.compare_at_price, tiers, v.wholesale_moq, v.cost_price)


def price_display(v: ProductVariant, ctx: PricingContext, qty: int = 1) -> dict[str, Any]:
    p = variant_pricing(v)
    show = can_see_wholesale(ctx)
    first_qty = max(qty, v.wholesale_moq or 1) if ctx.is_wholesale else qty
    u = unit_price_for(str(v.id), p, first_qty, ctx)
    tiers = tier_table(p, first_qty, ctx.settings.rounding) if show else []
    bulk = [t for t in p.tiers if t.unit_price < p.retail_price]
    return {
        "retail": apply_rounding(p.retail_price, ctx.settings.rounding),
        "compareAt": u.compare_at_price,
        "currency": p.currency,
        "fromBulk": min(t.unit_price for t in bulk) if (show and bulk) else None,
        "tiers": tiers,
        "moq": v.wholesale_moq if ctx.is_wholesale else None,
        "yourPrice": u.unit_price,
        "yourBasis": u.basis,
        "nextTier": u.next_tier,
        "showWholesale": show,
        "isWholesaleAccount": ctx.is_wholesale,
    }


# ================================================================ cards
def card_queryset(qs=None):
    qs = qs if qs is not None else Product.objects.all()
    return qs.select_related("brand", "primary_category").prefetch_related(
        Prefetch("variants", queryset=ProductVariant.objects.filter(is_active=True).prefetch_related("tiers", "option_values__option_type").order_by("sort_order", "created_at")),
        Prefetch("media_links", queryset=ProductMedia.objects.filter(media__status="READY", media__type__in=["IMAGE", "VIDEO"]).select_related("media", "option_value").order_by("sort_order", "id")),
        "badges",
        Prefetch("option_types", queryset=OptionType.objects.prefetch_related("values__swatch_media")),
    )


def _badge_out(b: Badge, locale: str) -> dict:
    return {"id": str(b.id), "key": b.key, "label": b.label_sw if locale == "sw" and b.label_sw else b.label, "labelSw": b.label_sw or None, "tone": b.tone}


def _cheapest(variants: list[ProductVariant]) -> ProductVariant | None:
    return min(variants, key=lambda v: v.retail_price) if variants else None


def _is_new(p: Product) -> bool:
    days = 21
    return bool(p.published_at and (timezone.now() - p.published_at).days <= days)


def product_card(p: Product, ctx: PricingContext, *, locale: str = "en", wishlisted: set | None = None) -> dict[str, Any]:
    variants = list(p.variants.all())
    links = [l for l in p.media_links.all() if l.role in ("gallery", "hover")]
    images = [l for l in links if l.media.type == "IMAGE"]
    cover_link = next((l for l in images if l.role == "gallery"), images[0] if images else None)
    hover_link = next((l for l in images if l.role == "hover"), None) or next((l for l in images if l is not cover_link), None)
    swatches = []
    for ot in p.option_types.all():
        if ot.kind in ("color", "shade"):
            for val in ot.values.all():
                swatches.append({"valueId": str(val.id), "label": val.label or val.value, "hex": val.swatch_hex or None, "mediaUrl": media_out(val.swatch_media)["url"] if val.swatch_media_id else None})
            break
    cheapest = _cheapest(variants)
    price = price_display(cheapest, ctx) if cheapest else None
    return {
        "id": str(p.id), "slug": p.slug, "title": p.title_sw if locale == "sw" and p.title_sw else p.title,
        "brand": {"id": str(p.brand.id), "name": p.brand.name, "slug": p.brand.slug} if p.brand_id else None,
        "cover": media_out(cover_link.media, alt=cover_link.alt or p.title) if cover_link else None,
        "hover": media_out(hover_link.media, alt=hover_link.alt or p.title) if hover_link else None,
        "price": price,
        "priceRange": {"min": p.min_price, "max": p.max_price} if p.max_price != p.min_price else None,
        "badges": [_badge_out(b, locale) for b in sorted(p.badges.all(), key=lambda b: b.sort_order)],
        "swatches": swatches[:6], "moreSwatches": max(0, len(swatches) - 6),
        "rating": round(p.rating_avg, 1) if p.rating_count else None, "reviewCount": p.rating_count,
        "isNew": _is_new(p), "inStock": p.in_stock, "wishlisted": bool(wishlisted and p.id in wishlisted),
        "department": p.department, "isBeauty": p.is_beauty,
        "category": {"id": str(p.primary_category_id), "slug": p.primary_category.slug, "name": p.primary_category.name_sw if locale == "sw" and p.primary_category.name_sw else p.primary_category.name},
    }


def wishlisted_ids(user, product_ids: list) -> set:
    if user is None or not product_ids:
        return set()
    from commerce.models import WishlistItem

    return set(WishlistItem.objects.filter(board__user=user, product_id__in=product_ids).values_list("product_id", flat=True))


def cards(products: list[Product], ctx: PricingContext, *, user=None, locale: str = "en") -> list[dict[str, Any]]:
    wl = wishlisted_ids(user, [p.id for p in products])
    return [product_card(p, ctx, locale=locale, wishlisted=wl) for p in products]


# ================================================================ availability
def stock_by_variant(variant_ids: list, store_ids: list | None = None) -> dict:
    qs = InventoryLevel.objects.filter(variant_id__in=variant_ids, store__is_active=True)
    if store_ids:
        qs = qs.filter(store_id__in=store_ids)
    out: dict = defaultdict(int)
    for lvl in qs.only("variant_id", "on_hand", "reserved"):
        out[lvl.variant_id] += max(0, lvl.on_hand - lvl.reserved)
    return out


# ================================================================ detail
def product_detail(p: Product, ctx: PricingContext, *, user=None, locale: str = "en") -> dict[str, Any]:
    card = product_card(p, ctx, locale=locale, wishlisted=wishlisted_ids(user, [p.id]))
    variants = list(p.variants.all())
    stock = stock_by_variant([v.id for v in variants])
    low_threshold = 3
    all_links = list(ProductMedia.objects.filter(product=p, media__status="READY").select_related("media", "option_value").order_by("sort_order", "id"))
    gallery = [l for l in all_links if l.role in ("gallery", "hover", "video")]
    audio = next((l for l in all_links if l.role in ("designer_note", "story") and l.media.type == "AUDIO"), None)
    option_types = []
    for ot in p.option_types.all():
        option_types.append({
            "id": str(ot.id), "name": ot.name, "kind": ot.kind,
            "values": [{"id": str(v.id), "value": v.value, "label": v.label or v.value, "swatchHex": v.swatch_hex or None, "swatchMedia": media_out(v.swatch_media) if v.swatch_media_id else None, "sortOrder": v.sort_order} for v in ot.values.all()],
        })
    variant_media = {v.id: [str(m) for m in v.media.values_list("id", flat=True)] for v in variants}
    rel = defaultdict(list)
    for r in ProductRelation.objects.filter(product=p).order_by("sort_order"):
        rel[r.kind].append(r.related_id)
    related_ids = [i for ids in rel.values() for i in ids]
    related = {x.id: x for x in card_queryset(Product.objects.filter(id__in=related_ids, status="PUBLISHED", deleted_at__isnull=True))}
    wl = wishlisted_ids(user, list(related))

    def rel_cards(kind: str) -> list:
        return [product_card(related[i], ctx, locale=locale, wishlisted=wl) for i in rel.get(kind, []) if i in related]

    complete = rel_cards("complete_look")
    pairs = rel_cards("pairs_with") or rel_cards("related")
    if not pairs:
        auto = card_queryset(Product.objects.filter(status="PUBLISHED", deleted_at__isnull=True, primary_category_id=p.primary_category_id).exclude(id=p.id).order_by("-popularity")[:8])
        pairs = cards(list(auto), ctx, user=user, locale=locale)
    chart = p.size_chart or cat_svc.effective_size_chart(p.primary_category)
    from commerce.models import Review

    dist = [0, 0, 0, 0, 0]
    for r, n in Review.objects.filter(product=p, status="PUBLISHED").values("rating").annotate(n=Count("id")).values_list("rating", "n"):
        dist[r - 1] = n
    attr_defs = {d.key: d for d in AttributeDefinition.objects.filter(key__in=list((p.attributes or {}).keys()))}

    def attr_label(k: str, v: Any) -> tuple[str, str]:
        d = attr_defs.get(k)
        if d is None:
            return k, ", ".join(v) if isinstance(v, list) else str(v)
        opts = {o["value"]: (o.get("labelSw") if locale == "sw" and o.get("labelSw") else o["label"]) for o in d.options}
        vals = v if isinstance(v, list) else [v]
        return (d.label_sw if locale == "sw" and d.label_sw else d.label), ", ".join(opts.get(str(x), str(x)) for x in vals)

    attributes = dict(attr_label(k, v) for k, v in (p.attributes or {}).items() if v not in (None, "", []))
    breadcrumbs = [{"id": str(c.id), "slug": c.slug, "name": c.name_sw if locale == "sw" and c.name_sw else c.name} for c in cat_svc.ancestors(p.primary_category)]
    return {
        **card,
        "tagline": p.tagline or None, "descriptionHtml": p.description_html or None, "story": p.story or None, "care": p.care or None,
        "materials": p.materials or None, "countryOfOrigin": p.country_of_origin or None, "season": p.season or None, "tags": p.tags or [],
        "attributes": attributes, "rawAttributes": p.attributes or {},
        "beauty": p.beauty if p.is_beauty else None,
        "media": [media_out(l.media, role=l.role, alt=l.alt or p.title) | {"optionValueId": str(l.option_value_id) if l.option_value_id else None} for l in gallery],
        "audioNote": media_out(audio.media, role=audio.role, alt=audio.alt) if audio else None,
        "optionTypes": option_types,
        "variants": [{
            "id": str(v.id), "sku": v.sku, "barcode": v.barcode or None, "optionValueIds": [str(o.id) for o in v.option_values.all()],
            "price": price_display(v, ctx), "inStock": stock.get(v.id, 0) > 0, "stockLevel": stock.get(v.id, 0) if 0 < stock.get(v.id, 0) <= low_threshold else None,
            "lowStock": 0 < stock.get(v.id, 0) <= low_threshold, "weightGrams": v.weight_grams, "mediaIds": variant_media.get(v.id, []), "shadeHex": v.shade_hex or None,
        } for v in variants],
        "sizeChart": size_chart_out(chart) if chart else None, "fitNote": p.fit_note,
        "reviews": {"average": round(p.rating_avg, 2), "count": p.rating_count, "distribution": dist},
        "completeTheLook": complete, "pairsWellWith": pairs[:12],
        "categoryPath": breadcrumbs, "publishedAt": p.published_at.isoformat() if p.published_at else None,
        "seo": {"title": p.seo_title or f"{p.title} — SmartWear", "description": p.seo_description or (p.tagline or "")[:160]},
    }


def size_chart_out(c: SizeChart) -> dict[str, Any]:
    return {"id": str(c.id), "name": c.name, "unit": c.unit, "columns": c.columns, "rows": c.rows, "note": c.note or None}


# ================================================================ admin write path
def _slug_for(title: str, exclude=None) -> str:
    base = slugify(title, max_length=100) or "product"
    slug, i = base, 2
    while Product.objects.filter(slug=slug).exclude(id=exclude).exists():
        slug, i = f"{base}-{i}", i + 1
    return slug


def _validate_attributes(attrs: dict, category_list: list[Category]) -> dict:
    allowed: list[str] = []
    for c in category_list:
        for k in cat_svc.effective_attribute_keys(c):
            if k not in allowed:
                allowed.append(k)
    defs = {d.key: d for d in AttributeDefinition.objects.filter(key__in=list(attrs.keys()))}
    clean: dict = {}
    errors: dict = {}
    for k, v in (attrs or {}).items():
        if v in (None, "", []):
            continue
        d = defs.get(k)
        if d is None:
            errors[k] = "Unknown attribute"
            continue
        if k not in allowed:
            errors[k] = "This attribute doesn't apply to the selected categories"
            continue
        values = {o["value"] for o in d.options}
        if d.type == "select":
            if str(v) not in values:
                errors[k] = f"Choose one of: {', '.join(sorted(values))}"
                continue
            clean[k] = str(v)
        elif d.type == "multiselect":
            vs = [str(x) for x in (v if isinstance(v, list) else [v])]
            bad = [x for x in vs if x not in values]
            if bad:
                errors[k] = f"Unknown values: {', '.join(bad)}"
                continue
            clean[k] = vs
        elif d.type == "boolean":
            clean[k] = bool(v)
        else:
            clean[k] = str(v)[:200]
    if errors:
        raise ApiError.bad_request("Some attributes are not valid", details={"field": "attributes", "attributes": errors})
    return clean


def _validate_tiers(retail: int, tiers: list[dict], sku: str) -> list[dict]:
    rows = sorted(({"minQty": int(t["minQty"]), "unitPrice": int(t["unitPrice"])} for t in tiers or []), key=lambda t: t["minQty"])
    last_price = retail
    seen = set()
    for t in rows:
        if t["minQty"] < 2:
            raise ApiError.bad_request(f"{sku}: wholesale tiers start at 2 units or more", details={"field": "wholesaleTiers"})
        if t["minQty"] in seen:
            raise ApiError.bad_request(f"{sku}: two tiers share the quantity {t['minQty']}", details={"field": "wholesaleTiers"})
        seen.add(t["minQty"])
        if t["unitPrice"] >= last_price:
            raise ApiError.bad_request(f"{sku}: each tier must be cheaper than the one before (and than retail)", details={"field": "wholesaleTiers"})
        last_price = t["unitPrice"]
    return rows


def _resolve_option_value(spec, by_id: dict, by_name: dict) -> OptionValue:
    if isinstance(spec, dict):
        key = (spec.get("type", "").strip().lower(), str(spec.get("value", "")).strip().lower())
        ov = by_name.get(key)
    else:
        ov = by_id.get(str(spec))
    if ov is None:
        raise ApiError.bad_request(f"Unknown option value {spec}", details={"field": "variants.optionValues"})
    return ov


@transaction.atomic
def upsert_product(data: dict[str, Any], *, admin, product: Product | None = None, request=None, note: str = "") -> Product:
    """Create or fully update a product from the editor payload (AdminProductInput in packages/shared)."""
    is_new = product is None
    title = (data.get("title") or "").strip()
    if not title:
        raise ApiError.bad_request("Title is required", details={"field": "title"})
    cat_ids = [str(c) for c in (data.get("categoryIds") or [])]
    if not cat_ids:
        raise ApiError.bad_request("Choose at least one category", details={"field": "categoryIds"})
    cats = {str(c.id): c for c in Category.objects.filter(id__in=cat_ids)}
    missing = [c for c in cat_ids if c not in cats]
    if missing:
        raise ApiError.bad_request("Unknown category", details={"field": "categoryIds", "ids": missing})
    archived = [c.name for c in cats.values() if c.archived_at]
    if archived:
        raise ApiError.bad_request(f"Archived categories can't receive products: {', '.join(archived)}", details={"field": "categoryIds"})
    primary = cats[str(data.get("primaryCategoryId") or cat_ids[0])]
    if primary.depth == 0:
        raise ApiError.bad_request("Choose a specific category, not only a top-level department", details={"field": "categoryIds"})
    ordered_cats = [cats[c] for c in cat_ids]
    is_beauty = primary.kind == "beauty"
    attributes = _validate_attributes(data.get("attributes") or {}, ordered_cats)

    status = data.get("status") or (product.status if product else "DRAFT")
    if status in ("PUBLISHED", "SCHEDULED") and (is_new or (product and product.status not in ("PUBLISHED", "SCHEDULED"))):
        if admin is not None and not admin.has_perm_key("products.publish"):
            raise ApiError.forbidden("Your role can save drafts but not publish")
    publish_at = data.get("publishAt")
    if status == "SCHEDULED" and not publish_at:
        raise ApiError.bad_request("Pick a publish date for a scheduled product", details={"field": "publishAt"})

    brand_id = data.get("brandId")
    if brand_id and not Brand.objects.filter(id=brand_id).exists():
        raise ApiError.bad_request("Unknown brand", details={"field": "brandId"})

    p = product or Product(created_by=admin)
    before = admin_product_out(product) if product else None
    p.title = title
    p.title_sw = (data.get("titleSw") or "").strip()
    p.slug = slugify(data["slug"], max_length=100) if data.get("slug") else (p.slug or _slug_for(title))
    if Product.objects.filter(slug=p.slug).exclude(id=p.id).exists():
        raise ApiError.conflict("duplicate_slug", "Another product already uses this URL", details={"field": "slug"})
    p.brand_id = brand_id or None
    p.primary_category = primary
    for k, f in (("tagline", "tagline"), ("descriptionHtml", "description_html"), ("story", "story"), ("care", "care"), ("materials", "materials"), ("countryOfOrigin", "country_of_origin"), ("season", "season"), ("seoTitle", "seo_title"), ("seoDescription", "seo_description")):
        if k in data or is_new:
            setattr(p, f, (data.get(k) or "").strip() if isinstance(data.get(k), str) or data.get(k) is None else data.get(k))
    p.description_html = sanitize_html(p.description_html)
    p.department = data.get("department") or primary.department
    p.tags = [t.strip().lower() for t in (data.get("tags") or []) if t and t.strip()][:30]
    p.attributes = attributes
    p.is_beauty = is_beauty
    beauty = data.get("beauty")
    if beauty and not is_beauty:
        raise ApiError.bad_request("Beauty details only apply to products in a Beauty category", details={"field": "beauty"})
    p.beauty = beauty if is_beauty else None
    p.size_chart_id = data.get("sizeChartId") or None
    p.fit_note = data.get("fitNote") or None
    p.featured = bool(data.get("featured", p.featured if product else False))
    p.status = status
    p.publish_at = publish_at or None
    p.unpublish_at = data.get("unpublishAt") or None
    if status == "PUBLISHED" and not p.published_at:
        p.published_at = timezone.now()
    p.updated_by = admin
    p.currency = settings_service.get("pricing.wholesale").currency
    p.save()

    # categories
    ProductCategory.objects.filter(product=p).exclude(category_id__in=cat_ids).delete()
    ProductCategory.objects.filter(product=p).update(is_primary=False)
    for c in ordered_cats:
        link, _ = ProductCategory.objects.get_or_create(product=p, category=c)
        if c.id == primary.id:
            link.is_primary = True
            link.save(update_fields=["is_primary"])

    # options
    keep_types: list[int] = []
    by_id: dict[str, OptionValue] = {}
    by_name: dict[tuple, OptionValue] = {}
    for ti, ot_in in enumerate(data.get("optionTypes") or []):
        kind = ot_in.get("kind") or "other"
        if kind == "shade" and not is_beauty:
            raise ApiError.bad_request("Shades are for beauty products — use Colour for fashion", details={"field": "optionTypes"})
        ot = OptionType.objects.filter(product=p, id=ot_in["id"]).first() if str(ot_in.get("id") or "").isdigit() else None
        ot = ot or OptionType.objects.filter(product=p, kind=kind, name__iexact=ot_in["name"]).first() or OptionType(product=p)
        ot.name, ot.kind, ot.sort_order = ot_in["name"].strip(), kind, ti
        ot.save()
        keep_types.append(ot.id)
        keep_vals = []
        for vi, v_in in enumerate(ot_in.get("values") or []):
            hexv = v_in.get("swatchHex") or ""
            if hexv and not HEX_RE.match(hexv):
                raise ApiError.bad_request(f"Swatch colour {hexv} must look like #A1B2C3", details={"field": "optionTypes.values.swatchHex"})
            ov = OptionValue.objects.filter(option_type=ot, id=v_in["id"]).first() if str(v_in.get("id") or "").isdigit() else None  # "new:…" ids are client placeholders
            ov = ov or OptionValue.objects.filter(option_type=ot, value__iexact=str(v_in["value"]).strip()).first() or OptionValue(option_type=ot)
            ov.value = str(v_in["value"]).strip()
            ov.label = (v_in.get("label") or "").strip()
            ov.swatch_hex = hexv.upper() if hexv else ""
            ov.swatch_media_id = v_in.get("swatchMediaId") or None
            ov.sort_order = vi
            ov.save()
            keep_vals.append(ov.id)
            by_id[str(ov.id)] = ov
            if v_in.get("id"):
                by_id[str(v_in["id"])] = ov  # snapshot ids still resolve after the value was recreated
            by_name[(ot.name.lower(), ov.value.lower())] = ov
        OptionValue.objects.filter(option_type=ot).exclude(id__in=keep_vals).delete()
    OptionType.objects.filter(product=p).exclude(id__in=keep_types).delete()

    # variants
    variants_in = data.get("variants") or []
    if not variants_in:
        raise ApiError.bad_request("Add at least one variant with a SKU and price", details={"field": "variants"})
    keep_variants = []
    combos = set()
    stores = {str(s.id): s for s in Store.objects.all()}
    for vi, v_in in enumerate(variants_in):
        sku = str(v_in.get("sku") or "").strip()
        if not SKU_RE.match(sku):
            raise ApiError.bad_request(f"SKU '{sku}' may only use letters, numbers, dot, dash and underscore", details={"field": "variants.sku"})
        retail = int(v_in.get("retailPrice", -1))
        if retail < 0:
            raise ApiError.bad_request(f"{sku}: set a retail price", details={"field": "variants.retailPrice"})
        compare = v_in.get("compareAtPrice")
        if compare is not None and int(compare) <= retail:
            raise ApiError.bad_request(f"{sku}: the compare-at price must be higher than the price — only show real discounts", details={"field": "variants.compareAtPrice"})
        tiers = _validate_tiers(retail, v_in.get("wholesaleTiers") or [], sku)
        ovs = [_resolve_option_value(s, by_id, by_name) for s in (v_in.get("optionValueIds") or v_in.get("optionValues") or [])]
        combo = tuple(sorted(o.id for o in ovs))
        if combo in combos:
            raise ApiError.bad_request(f"{sku}: another variant already has the same options", details={"field": "variants.optionValues"})
        combos.add(combo)
        if len({o.option_type_id for o in ovs}) != len(ovs):
            raise ApiError.bad_request(f"{sku}: pick one value per option", details={"field": "variants.optionValues"})
        v = ProductVariant.objects.filter(product=p, id=v_in["id"]).first() if v_in.get("id") else None
        v = v or ProductVariant.objects.filter(product=p, sku=sku).first() or ProductVariant(product=p)
        if ProductVariant.objects.filter(sku=sku).exclude(id=v.id).exclude(product=p).exists():
            raise ApiError.conflict("duplicate_sku", f"SKU {sku} is used by another product", details={"field": "variants.sku"})
        v.sku, v.barcode = sku, (v_in.get("barcode") or "").strip()
        v.retail_price, v.compare_at_price = retail, (int(compare) if compare is not None else None)
        v.cost_price = v_in.get("costPrice")
        v.wholesale_moq = v_in.get("wholesaleMoq") or None
        v.weight_grams = v_in.get("weightGrams")
        shade = v_in.get("shadeHex") or ""
        if shade and not HEX_RE.match(shade):
            raise ApiError.bad_request(f"{sku}: shade colour must look like #A1B2C3")
        v.shade_hex = shade.upper()
        v.currency = p.currency
        v.sort_order = vi
        v.is_active = v_in.get("isActive", True)
        v.save()
        v.option_values.set(ovs)
        PriceTier.objects.filter(variant=v).delete()
        PriceTier.objects.bulk_create([PriceTier(variant=v, min_qty=t["minQty"], unit_price=t["unitPrice"]) for t in tiers])
        v.media.set(Media.objects.filter(id__in=v_in.get("mediaIds") or []))
        from inventory.services import set_stock

        for st in v_in.get("stock") or []:
            store = stores.get(str(st["storeId"]))
            if store is None:
                raise ApiError.bad_request("Unknown store in stock", details={"field": "variants.stock"})
            set_stock(store, v, int(st["quantity"]), low_threshold=st.get("lowStockThreshold"), admin=admin, reason="count", note="Product editor")
        keep_variants.append(v.id)
    gone = ProductVariant.objects.filter(product=p).exclude(id__in=keep_variants)
    from commerce.models import OrderItem

    for v in gone:
        if OrderItem.objects.filter(variant=v).exists():
            v.is_active = False
            v.save(update_fields=["is_active"])  # keep for order history
        else:
            v.delete()

    # media
    media_in = data.get("media") or []
    ids = [str(m["mediaId"]) for m in media_in]
    found = {str(m.id): m for m in Media.objects.filter(id__in=ids)}
    if len(found) != len(set(ids)):
        raise ApiError.bad_request("Some media could not be found — re-upload and try again", details={"field": "media"})
    ProductMedia.objects.filter(product=p).exclude(media_id__in=ids).delete()
    for i, m in enumerate(media_in):
        link, _ = ProductMedia.objects.get_or_create(product=p, media_id=m["mediaId"])
        role = m.get("role") or "gallery"
        mt = found[str(m["mediaId"])].type
        if role in ("designer_note", "story") and mt != "AUDIO":
            raise ApiError.bad_request("Designer's notes and product stories are audio", details={"field": "media.role"})
        if mt == "VIDEO" and role == "gallery":
            role = "video"
        link.role = role
        link.sort_order = m.get("sortOrder", i)
        link.alt = (m.get("alt") or "")[:200]
        ov = m.get("optionValueId") or m.get("optionValue")
        link.option_value = _resolve_option_value(ov, by_id, by_name) if ov else None
        link.save()
        if link.alt and not found[str(m["mediaId"])].alt:
            Media.objects.filter(id=m["mediaId"]).update(alt=link.alt)

    if status == "PUBLISHED":
        _assert_publishable(p)

    # merchandising
    p.badges.set(Badge.objects.filter(id__in=data.get("badgeIds") or []))
    coll_ids = data.get("collectionIds") or []
    CollectionProduct.objects.filter(product=p).exclude(collection_id__in=coll_ids).delete()
    for cid in coll_ids:
        if Collection.objects.filter(id=cid).exists():
            CollectionProduct.objects.get_or_create(product=p, collection_id=cid)
    for kind, key in (("related", "relatedProductIds"), ("complete_look", "completeTheLookIds"), ("pairs_with", "pairsWellWithIds")):
        rel_ids = [r for r in (data.get(key) or []) if str(r) != str(p.id)]
        ProductRelation.objects.filter(product=p, kind=kind).delete()
        valid = set(str(x) for x in Product.objects.filter(id__in=rel_ids).values_list("id", flat=True))
        ProductRelation.objects.bulk_create([ProductRelation(product=p, related_id=r, kind=kind, sort_order=i) for i, r in enumerate(rel_ids) if str(r) in valid])

    refresh_denormalised(p)
    if not is_new:
        p.version += 1
        p.save(update_fields=["version"])
    snapshot = admin_product_out(Product.objects.get(id=p.id))
    ProductVersion.objects.create(product=p, version=p.version, snapshot=snapshot, created_by=admin, note=note[:200])
    audit("product.create" if is_new else "product.update", "product", p.id, request=request, admin=admin, before=_audit_trim(before), after=_audit_trim(snapshot))
    transaction.on_commit(cat_svc.refresh_counts)
    return p


def _audit_trim(d: dict | None) -> dict | None:
    if d is None:
        return None
    return {k: d[k] for k in ("title", "status", "primaryCategoryId", "categoryIds", "brandId", "featured") if k in d} | {"variants": [{"sku": v["sku"], "retailPrice": v["retailPrice"], "wholesaleTiers": v["wholesaleTiers"]} for v in d.get("variants", [])]}


def _assert_publishable(p: Product) -> None:
    problems = []
    if not ProductMedia.objects.filter(product=p, role__in=["gallery", "hover"], media__type="IMAGE", media__status="READY").exists():
        problems.append("Add at least one processed image")
    if not ProductVariant.objects.filter(product=p, is_active=True).exists():
        problems.append("Add at least one active variant")
    if problems:
        raise ApiError.bad_request("This product isn't ready to publish yet", details={"problems": problems})


ALLOWED_TAGS = {"p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "h3", "h4", "blockquote", "a"}


def sanitize_html(html: str) -> str:
    """Tiny allow-list sanitiser for the rich-text description (no attributes except safe hrefs)."""
    if not html:
        return ""
    from html.parser import HTMLParser
    from html import escape

    out: list[str] = []

    class P(HTMLParser):
        def handle_starttag(self, tag, attrs):
            if tag in ALLOWED_TAGS:
                if tag == "a":
                    href = dict(attrs).get("href", "") or ""
                    if href.startswith(("https://", "http://", "/")):
                        out.append(f'<a href="{escape(href, quote=True)}" rel="noopener">')
                        return
                    out.append("<a>")
                    return
                out.append(f"<{tag}>")

        def handle_endtag(self, tag):
            if tag in ALLOWED_TAGS and tag != "br":
                out.append(f"</{tag}>")

        def handle_data(self, data):
            out.append(escape(data, quote=False))

    P(convert_charrefs=True).feed(html)
    return "".join(out)[:50000]


def refresh_denormalised(p: Product) -> None:
    variants = list(ProductVariant.objects.filter(product=p, is_active=True).prefetch_related("tiers"))
    prices = [v.retail_price for v in variants]
    bulk = [t.unit_price for v in variants for t in v.tiers.all()]
    stock = stock_by_variant([v.id for v in variants])
    cats = list(Category.objects.filter(product_links__product=p))
    names = set()
    for c in cats:
        for a in cat_svc.ancestors(c):
            names.add(a.name)
            if a.name_sw:
                names.add(a.name_sw)
    attr_words = []
    for v in (p.attributes or {}).values():
        attr_words.extend(v if isinstance(v, list) else [str(v)])
    option_words = list(OptionValue.objects.filter(option_type__product=p).values_list("value", flat=True))
    brand = p.brand.name if p.brand_id else ""
    Product.objects.filter(id=p.id).update(
        min_price=min(prices) if prices else 0, max_price=max(prices) if prices else 0, min_bulk_price=min(bulk) if bulk else None,
        in_stock=any(n > 0 for n in stock.values()),
        search_text=" ".join([brand, *sorted(names), *(p.tags or []), *attr_words, *option_words, p.materials or ""]).strip(),
    )
    Product.objects.filter(id=p.id).update(
        search_vector=SearchVector("title", weight="A", config="simple") + SearchVector("title_sw", weight="A", config="simple")
        + SearchVector("search_text", weight="B", config="simple") + SearchVector("tagline", weight="C", config="simple")
    )


def admin_product_out(p: Product) -> dict[str, Any]:
    """Editor shape (round-trips into upsert_product, so version snapshots are restorable)."""
    variants = list(p.variants.all().prefetch_related("tiers", "option_values__option_type", "media", "inventory"))
    links = list(p.media_links.select_related("media").order_by("sort_order", "id"))
    return {
        "id": str(p.id), "title": p.title, "titleSw": p.title_sw or None, "slug": p.slug, "brandId": str(p.brand_id) if p.brand_id else None,
        "primaryCategoryId": str(p.primary_category_id),
        "categoryIds": [str(c) for c in ProductCategory.objects.filter(product=p).order_by("-is_primary", "id").values_list("category_id", flat=True)],
        "tagline": p.tagline or None, "descriptionHtml": p.description_html or None, "story": p.story or None, "care": p.care or None,
        "materials": p.materials or None, "countryOfOrigin": p.country_of_origin or None, "department": p.department, "season": p.season or None,
        "tags": p.tags or [], "attributes": p.attributes or {}, "beauty": p.beauty, "isBeauty": p.is_beauty,
        "optionTypes": [{"id": str(ot.id), "name": ot.name, "kind": ot.kind, "values": [{"id": str(v.id), "value": v.value, "label": v.label or None, "swatchHex": v.swatch_hex or None, "swatchMediaId": str(v.swatch_media_id) if v.swatch_media_id else None} for v in ot.values.all()]} for ot in p.option_types.all()],
        "variants": [{
            "id": str(v.id), "sku": v.sku, "barcode": v.barcode or None, "optionValueIds": [str(o.id) for o in v.option_values.all()],
            "retailPrice": v.retail_price, "compareAtPrice": v.compare_at_price, "costPrice": v.cost_price,
            "wholesaleTiers": [{"minQty": t.min_qty, "unitPrice": t.unit_price} for t in v.tiers.all()], "wholesaleMoq": v.wholesale_moq,
            "weightGrams": v.weight_grams, "mediaIds": [str(m.id) for m in v.media.all()], "shadeHex": v.shade_hex or None, "isActive": v.is_active,
            "stock": [{"storeId": str(l.store_id), "quantity": l.on_hand, "reserved": l.reserved, "lowStockThreshold": l.low_stock_threshold} for l in v.inventory.all()],
        } for v in variants],
        "media": [{"mediaId": str(l.media_id), "sortOrder": l.sort_order, "role": l.role, "alt": l.alt or None, "optionValueId": str(l.option_value_id) if l.option_value_id else None, "media": media_out(l.media)} for l in links],
        "sizeChartId": str(p.size_chart_id) if p.size_chart_id else None, "fitNote": p.fit_note,
        "badgeIds": [str(b) for b in p.badges.values_list("id", flat=True)], "featured": p.featured,
        "collectionIds": [str(c) for c in CollectionProduct.objects.filter(product=p).values_list("collection_id", flat=True)],
        "relatedProductIds": [str(r) for r in ProductRelation.objects.filter(product=p, kind="related").values_list("related_id", flat=True)],
        "completeTheLookIds": [str(r) for r in ProductRelation.objects.filter(product=p, kind="complete_look").values_list("related_id", flat=True)],
        "pairsWellWithIds": [str(r) for r in ProductRelation.objects.filter(product=p, kind="pairs_with").values_list("related_id", flat=True)],
        "status": p.status, "publishAt": p.publish_at.isoformat() if p.publish_at else None, "unpublishAt": p.unpublish_at.isoformat() if p.unpublish_at else None,
        "publishedAt": p.published_at.isoformat() if p.published_at else None,
        "seoTitle": p.seo_title or None, "seoDescription": p.seo_description or None, "version": p.version,
        "updatedAt": p.updated_at.isoformat() if p.updated_at else None,
    }


def revert_to_version(p: Product, version: int, *, admin, request=None) -> Product:
    v = ProductVersion.objects.filter(product=p, version=version).first()
    if v is None:
        raise ApiError.not_found("Version")
    snap = dict(v.snapshot)
    # Media or values deleted since then are dropped; everything else is restored.
    snap["media"] = [m for m in snap.get("media", []) if Media.objects.filter(id=m["mediaId"]).exists()]
    for var in snap.get("variants", []):
        var.pop("stock", None)
    snap["status"] = "DRAFT" if snap.get("status") == "PUBLISHED" and not admin.has_perm_key("products.publish") else snap.get("status")
    return upsert_product(snap, admin=admin, product=p, request=request, note=f"Reverted to v{version}")


def duplicate(p: Product, *, admin, request=None) -> Product:
    data = admin_product_out(p)
    data.pop("id")
    data["title"] = f"{p.title} (copy)"
    data["slug"] = None
    data["status"] = "DRAFT"
    for ot in data["optionTypes"]:
        ot.pop("id", None)
        for v in ot["values"]:
            v.pop("id", None)
    id_to_spec = {}
    for ot_out in admin_product_out(p)["optionTypes"]:
        for v in ot_out["values"]:
            id_to_spec[v["id"]] = {"type": ot_out["name"], "value": v["value"]}
    for var in data["variants"]:
        var.pop("id", None)
        var.pop("stock", None)
        var["sku"] = f"{var['sku']}-COPY"[:64]
        var["optionValues"] = [id_to_spec[i] for i in var.pop("optionValueIds")]
    for m in data["media"]:
        if m.get("optionValueId"):
            m["optionValue"] = id_to_spec.get(m.pop("optionValueId"))
    return upsert_product(data, admin=admin, request=request, note=f"Duplicated from {p.slug}")


# ================================================================ quality hints
def quality_hints(p: Product) -> list[dict[str, Any]]:
    hints: list[dict[str, Any]] = []
    links = list(p.media_links.select_related("media"))
    images = [l for l in links if l.media.type == "IMAGE"]
    if not images:
        hints.append({"level": "error", "code": "no_images", "message": "Add at least one photo — products without images can't be published."})
    for l in images:
        m = l.media
        q = m.quality or {}
        if m.status == "FAILED":
            hints.append({"level": "error", "code": "media_failed", "message": f"Processing failed: {m.error[:120]}", "mediaId": str(m.id)})
        if m.width and m.height:
            if min(m.width, m.height) < 1000:
                hints.append({"level": "warning", "code": "low_resolution", "message": f"Low resolution ({m.width}×{m.height}). Use at least 1600px on the long edge for a crisp product page.", "mediaId": str(m.id)})
            ratio = m.width / m.height
            if abs(ratio - 0.8) > 0.12:
                hints.append({"level": "info", "code": "aspect", "message": "Not 4:5 portrait — it will be cropped around the focal point. Check the focal point.", "mediaId": str(m.id)})
        if q.get("blurry"):
            hints.append({"level": "warning", "code": "blurry", "message": f"Looks soft or out of focus (sharpness {q.get('sharpness', 0):.0f}).", "mediaId": str(m.id)})
        if not (l.alt or m.alt):
            hints.append({"level": "info", "code": "missing_alt", "message": "Add alt text so screen-reader users know what's in the photo.", "mediaId": str(m.id)})
    variants = list(p.variants.filter(is_active=True).prefetch_related("tiers", "option_values__option_type"))
    kinds = {ot.kind for ot in p.option_types.all()}
    apparel = p.primary_category.root_key in ("women", "men", "kids", "shoes", "african-fashion", "activewear", "modest-wear", "bridal", "lingerie", "maternity")
    if apparel and "size" not in kinds:
        hints.append({"level": "warning", "code": "missing_sizes", "message": "No sizes set — add a Size option so customers can pick their fit."})
    if apparel and not (p.size_chart_id or cat_svc.effective_size_chart(p.primary_category)):
        hints.append({"level": "info", "code": "missing_size_chart", "message": "Attach a size guide."})
    ws = settings_service.get("pricing.wholesale")
    if ws.visibility != "hidden" and variants and not any(v.tiers.all() for v in variants):
        hints.append({"level": "info", "code": "missing_wholesale", "message": "No wholesale tiers — bulk buyers will only see the retail price."})
    if not p.description_html:
        hints.append({"level": "info", "code": "missing_description", "message": "Add a description."})
    allowed = cat_svc.effective_attribute_keys(p.primary_category)
    missing_attrs = [k for k in allowed if k not in (p.attributes or {})]
    if missing_attrs:
        defs = dict(AttributeDefinition.objects.filter(key__in=missing_attrs[:5]).values_list("key", "label"))
        hints.append({"level": "info", "code": "missing_attributes", "message": "Fill in " + ", ".join(defs.get(k, k) for k in missing_attrs[:5]) + " to improve filters."})
    return hints
