from __future__ import annotations

import csv
import io
from typing import Any

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from slugify import slugify

from accounts.permissions import AdminPerm
from core.audit import audit
from core.exceptions import ApiError
from core.media_urls import media_out
from core.pagination import keyset, page_params

from .models import (
    AttributeDefinition, Badge, Brand, Category, Collection, CollectionProduct, CustomerGroup, PriceList, PriceListEntry, Product,
    ProductTemplate, ProductVariant, ProductVersion, ScheduledPriceChange, SizeChart,
)
from .pricing import PricingContext, margin_bps
from .services import categories as cat_svc
from .services import products as prod_svc
from .services.viewer import wholesale_settings
from .taxonomy import CATEGORY_ICONS, MAX_DEPTH


def _get(model, pk, what: str):
    obj = model.objects.filter(pk=pk).first()
    if obj is None:
        raise ApiError.not_found(what)
    return obj


# ================================================================ categories
class AdminCategoryTreeView(APIView):
    def get_permissions(self):
        return [AdminPerm("products.view")()] if self.request.method == "GET" else [AdminPerm("catalog.manage")()]

    def get(self, request):
        return Response({
            "items": cat_svc.admin_tree(include_archived=request.query_params.get("archived") == "1"),
            "roots": cat_svc.available_roots(), "maxDepth": MAX_DEPTH, "icons": CATEGORY_ICONS,
            "canManageRoots": request.user.admin.has_perm_key("catalog.roots"),
        })

    def post(self, request):
        cat = cat_svc.create(request.data or {}, admin=request.user.admin, request=request)
        return Response(cat_svc.category_admin_out(cat), status=201)


class AdminCategoryView(APIView):
    def get_permissions(self):
        return [AdminPerm("products.view")()] if self.request.method == "GET" else [AdminPerm("catalog.manage")()]

    def get(self, request, cid):
        c = _get(Category, cid, "Category")
        d = cat_svc.category_admin_out(c)
        d["breadcrumbs"] = [{"id": str(a.id), "name": a.name} for a in cat_svc.ancestors(c)]
        d["effectiveAttributeKeys"] = cat_svc.effective_attribute_keys(c)
        chart = cat_svc.effective_size_chart(c)
        d["effectiveSizeChart"] = {"id": str(chart.id), "name": chart.name} if chart else None
        d["image"] = media_out(c.image) if c.image_id else None
        return Response(d)

    def patch(self, request, cid):
        c = _get(Category, cid, "Category")
        return Response(cat_svc.category_admin_out(cat_svc.update(c, request.data or {}, admin=request.user.admin, request=request)))

    def delete(self, request, cid):
        cat_svc.delete(_get(Category, cid, "Category"), admin=request.user.admin, request=request)
        return Response({"ok": True})


class AdminCategoryMoveView(APIView):
    permission_classes = [AdminPerm("catalog.manage")]

    def post(self, request, cid):
        c = _get(Category, cid, "Category")
        c = cat_svc.move(c, request.data.get("parentId"), position=request.data.get("position"), admin=request.user.admin, request=request)
        return Response(cat_svc.category_admin_out(c))


class AdminCategoryReorderView(APIView):
    permission_classes = [AdminPerm("catalog.manage")]

    def post(self, request):
        cat_svc.reorder(request.data.get("parentId"), [str(i) for i in request.data.get("ids") or []], admin=request.user.admin, request=request)
        return Response({"ok": True})


class AdminCategoryArchiveView(APIView):
    permission_classes = [AdminPerm("catalog.manage")]

    def post(self, request, cid):
        c = _get(Category, cid, "Category")
        if request.data.get("restore"):
            cat_svc.restore(c, admin=request.user.admin, request=request)
            return Response({"ok": True})
        return Response(cat_svc.archive(c, admin=request.user.admin, request=request, reassign_to_id=request.data.get("reassignToId")))


class AdminRootEnableView(APIView):
    permission_classes = [AdminPerm("catalog.roots")]

    def post(self, request, key: str):
        from .services.seed_taxonomy import ensure_root

        cat = cat_svc.enable_root(key, admin=request.user.admin, request=request)
        if request.data.get("withSuggestedTree", True):
            ensure_root(key)
            cat_svc.bump_version()
        return Response(cat_svc.category_admin_out(cat), status=201)


class AdminAttributesView(APIView):
    def get_permissions(self):
        return [AdminPerm("products.view")()] if self.request.method == "GET" else [AdminPerm("catalog.manage")()]

    def get(self, request):
        return Response({"items": [attr_out(a) for a in AttributeDefinition.objects.all()]})

    def post(self, request):
        d = request.data
        key = slugify(d.get("key") or d.get("label") or "", separator="_")[:40]
        if not key or not d.get("label"):
            raise ApiError.bad_request("Key and label are required")
        if AttributeDefinition.objects.filter(key=key).exists():
            raise ApiError.conflict("duplicate_key", "An attribute with this key exists")
        a = AttributeDefinition.objects.create(key=key, label=d["label"], label_sw=d.get("labelSw") or "", type=d.get("type") or "select", options=_clean_options(d.get("options")), filterable=d.get("filterable", True))
        audit("attribute.create", "attribute", a.key, request=request, after=attr_out(a))
        return Response(attr_out(a), status=201)


class AdminAttributeView(APIView):
    permission_classes = [AdminPerm("catalog.manage")]

    def patch(self, request, key: str):
        a = AttributeDefinition.objects.filter(key=key).first()
        if a is None:
            raise ApiError.not_found("Attribute")
        before = attr_out(a)
        for k, f in (("label", "label"), ("labelSw", "label_sw"), ("filterable", "filterable"), ("sortOrder", "sort_order")):
            if k in request.data:
                setattr(a, f, request.data[k])
        if "options" in request.data:
            new = _clean_options(request.data["options"])
            removed = {o["value"] for o in a.options} - {o["value"] for o in new}
            in_use = [v for v in removed if Product.objects.filter(Q(**{f"attributes__{key}": v}) | Q(**{f"attributes__{key}__contains": [v]})).exists()]
            if in_use:
                raise ApiError.conflict("option_in_use", f"Products still use: {', '.join(in_use)}")
            a.options = new
        a.save()
        audit("attribute.update", "attribute", a.key, request=request, before=before, after=attr_out(a))
        return Response(attr_out(a))


def _clean_options(opts) -> list[dict]:
    out, seen = [], set()
    for o in opts or []:
        label = (o.get("label") or "").strip()
        value = slugify(o.get("value") or label)
        if not label or value in seen:
            continue
        seen.add(value)
        out.append({"value": value, "label": label, "labelSw": (o.get("labelSw") or "").strip() or None, **({"hex": o["hex"]} if o.get("hex") else {})})
    return out


def attr_out(a: AttributeDefinition) -> dict:
    return {"key": a.key, "label": a.label, "labelSw": a.label_sw or None, "type": a.type, "options": a.options, "filterable": a.filterable, "sortOrder": a.sort_order, "usedBy": list(Category.objects.filter(attribute_keys__contains=[a.key]).values_list("name", flat=True)[:12])}


# ================================================================ brands, badges, size charts, collections
class AdminBrandsView(APIView):
    def get_permissions(self):
        return [AdminPerm("products.view")()] if self.request.method == "GET" else [AdminPerm("catalog.manage")()]

    def get(self, request):
        rows = Brand.objects.select_related("logo").annotate(n=Count("products", filter=Q(products__deleted_at__isnull=True)))
        return Response({"items": [brand_admin_out(b) | {"productCount": b.n} for b in rows]})

    def post(self, request):
        b = Brand()
        _apply_brand(b, request.data)
        audit("brand.create", "brand", b.id, request=request, after=brand_admin_out(b))
        return Response(brand_admin_out(b), status=201)


class AdminBrandView(APIView):
    permission_classes = [AdminPerm("catalog.manage")]

    def patch(self, request, bid):
        b = _get(Brand, bid, "Brand")
        before = brand_admin_out(b)
        _apply_brand(b, request.data)
        audit("brand.update", "brand", b.id, request=request, before=before, after=brand_admin_out(b))
        return Response(brand_admin_out(b))

    def delete(self, request, bid):
        b = _get(Brand, bid, "Brand")
        if b.products.exists():
            raise ApiError.conflict("has_products", "This brand still has products — deactivate it instead")
        b.delete()
        return Response({"ok": True})


def _apply_brand(b: Brand, d: dict) -> None:
    if "name" in d or not b.name:
        name = (d.get("name") or "").strip()
        if not name:
            raise ApiError.bad_request("Name is required")
        if Brand.objects.filter(name__iexact=name).exclude(id=b.id).exists():
            raise ApiError.conflict("duplicate_name", "A brand with this name exists")
        b.name = name
    if not b.slug or d.get("slug"):
        base = slugify(d.get("slug") or b.name)
        slug, i = base, 2
        while Brand.objects.filter(slug=slug).exclude(id=b.id).exists():
            slug, i = f"{base}-{i}", i + 1
        b.slug = slug
    for k, f in (("story", "story"), ("storySw", "story_sw"), ("country", "country"), ("website", "website"), ("featured", "featured"), ("isActive", "is_active"), ("sortOrder", "sort_order"), ("logoMediaId", "logo_id"), ("coverMediaId", "cover_id")):
        if k in d:
            setattr(b, f, d[k] if d[k] is not None or f.endswith("_id") else "")
    b.save()


def brand_admin_out(b: Brand) -> dict:
    return {"id": str(b.id), "slug": b.slug, "name": b.name, "story": b.story or None, "storySw": b.story_sw or None, "country": b.country or None, "website": b.website or None, "featured": b.featured, "isActive": b.is_active, "sortOrder": b.sort_order, "logo": media_out(b.logo) if b.logo_id else None, "coverMediaId": str(b.cover_id) if b.cover_id else None}


class AdminBadgesView(APIView):
    def get_permissions(self):
        return [AdminPerm("products.view")()] if self.request.method == "GET" else [AdminPerm("catalog.manage")()]

    def get(self, request):
        return Response({"items": [{"id": str(b.id), "key": b.key, "label": b.label, "labelSw": b.label_sw or None, "tone": b.tone, "sortOrder": b.sort_order, "productCount": b.n} for b in Badge.objects.annotate(n=Count("products")).order_by("sort_order")]})

    def post(self, request):
        d = request.data
        key = slugify(d.get("key") or d.get("label") or "")
        if not key or not d.get("label"):
            raise ApiError.bad_request("Key and label are required")
        if len(d["label"]) > 24:
            raise ApiError.bad_request("Keep badge labels short (24 characters)")
        if d.get("tone", "ink") not in dict(Badge.TONES):
            raise ApiError.bad_request("Tone must be ink, accent, blush or muted")
        b, created = Badge.objects.update_or_create(key=key, defaults={"label": d["label"], "label_sw": d.get("labelSw") or "", "tone": d.get("tone", "ink"), "sort_order": d.get("sortOrder", 0)})
        return Response({"id": str(b.id), "key": b.key}, status=201 if created else 200)


class AdminBadgeView(APIView):
    permission_classes = [AdminPerm("catalog.manage")]

    def delete(self, request, bid):
        _get(Badge, bid, "Badge").delete()
        return Response({"ok": True})


class AdminSizeChartsView(APIView):
    def get_permissions(self):
        return [AdminPerm("products.view")()] if self.request.method == "GET" else [AdminPerm("catalog.manage")()]

    def get(self, request):
        return Response({"items": [prod_svc.size_chart_out(c) | {"brandId": str(c.brand_id) if c.brand_id else None, "categoryId": str(c.category_id) if c.category_id else None, "key": c.key} for c in SizeChart.objects.order_by("name")]})

    def post(self, request):
        c = SizeChart()
        _apply_chart(c, request.data)
        return Response(prod_svc.size_chart_out(c), status=201)


class AdminSizeChartView(APIView):
    permission_classes = [AdminPerm("catalog.manage")]

    def patch(self, request, sid):
        c = _get(SizeChart, sid, "Size chart")
        _apply_chart(c, request.data)
        return Response(prod_svc.size_chart_out(c))

    def delete(self, request, sid):
        c = _get(SizeChart, sid, "Size chart")
        if c.products.exists():
            raise ApiError.conflict("in_use", "Products use this size guide")
        c.delete()
        return Response({"ok": True})


def _apply_chart(c: SizeChart, d: dict) -> None:
    cols = d.get("columns", c.columns)
    rows = d.get("rows", c.rows)
    if not cols or not rows:
        raise ApiError.bad_request("Add at least one column and one row")
    for r in rows:
        if len(r.get("values", [])) != len(cols):
            raise ApiError.bad_request(f"Row {r.get('label')} needs {len(cols)} values")
    c.name = d.get("name", c.name) or "Size guide"
    c.unit = d.get("unit", c.unit or "cm")
    c.columns, c.rows = cols, rows
    c.note = d.get("note", c.note) or ""
    c.brand_id = d.get("brandId", c.brand_id)
    c.category_id = d.get("categoryId", c.category_id)
    c.save()


class AdminCollectionsView(APIView):
    def get_permissions(self):
        return [AdminPerm("products.view")()] if self.request.method == "GET" else [AdminPerm("marketing.manage")()]

    def get(self, request):
        return Response({"items": [collection_admin_out(c) for c in Collection.objects.select_related("cover").order_by("sort_order", "-created_at")]})

    def post(self, request):
        c = Collection()
        _apply_collection(c, request.data, request)
        return Response(collection_admin_out(c), status=201)


class AdminCollectionView(APIView):
    permission_classes = [AdminPerm("marketing.manage")]

    def get(self, request, cid):
        return Response(collection_admin_out(_get(Collection, cid, "Collection")))

    def patch(self, request, cid):
        c = _get(Collection, cid, "Collection")
        _apply_collection(c, request.data, request)
        return Response(collection_admin_out(c))

    def delete(self, request, cid):
        _get(Collection, cid, "Collection").delete()
        return Response({"ok": True})


@transaction.atomic
def _apply_collection(c: Collection, d: dict, request) -> None:
    if "title" in d or not c.title:
        if not (d.get("title") or "").strip():
            raise ApiError.bad_request("Title is required")
        c.title = d["title"].strip()
    if not c.slug or d.get("slug"):
        base = slugify(d.get("slug") or c.title)
        slug, i = base, 2
        while Collection.objects.filter(slug=slug).exclude(id=c.id).exists():
            slug, i = f"{base}-{i}", i + 1
        c.slug = slug
    for k, f in (("titleSw", "title_sw"), ("subtitle", "subtitle"), ("description", "description"), ("isDrop", "is_drop"), ("launchesAt", "launches_at"), ("endsAt", "ends_at"), ("rule", "rule"), ("published", "published"), ("sortOrder", "sort_order"), ("coverMediaId", "cover_id")):
        if k in d:
            setattr(c, f, d[k] if d[k] is not None or f in ("launches_at", "ends_at", "rule", "cover_id") else "")
    if c.is_drop and not c.launches_at:
        raise ApiError.bad_request("A drop needs a real launch time for its countdown")
    c.save()
    if "productIds" in d:
        CollectionProduct.objects.filter(collection=c).delete()
        valid = set(str(x) for x in Product.objects.filter(id__in=d["productIds"]).values_list("id", flat=True))
        CollectionProduct.objects.bulk_create([CollectionProduct(collection=c, product_id=pid, sort_order=i) for i, pid in enumerate(d["productIds"]) if str(pid) in valid])
    audit("collection.save", "collection", c.id, request=request)


def collection_admin_out(c: Collection) -> dict:
    return {
        "id": str(c.id), "slug": c.slug, "title": c.title, "titleSw": c.title_sw or None, "subtitle": c.subtitle or None, "description": c.description or None,
        "cover": media_out(c.cover) if c.cover_id else None, "coverMediaId": str(c.cover_id) if c.cover_id else None, "isDrop": c.is_drop,
        "launchesAt": c.launches_at.isoformat() if c.launches_at else None, "endsAt": c.ends_at.isoformat() if c.ends_at else None,
        "rule": c.rule, "published": c.published, "sortOrder": c.sort_order,
        "productIds": [str(x) for x in CollectionProduct.objects.filter(collection=c).order_by("sort_order").values_list("product_id", flat=True)],
        "subscribers": c.subscriptions.count(),
    }


# ================================================================ products
def _admin_row(p: Product, stock: dict) -> dict:
    cover = next((l for l in p.media_links.all() if l.media.type == "IMAGE"), None)
    vs = list(p.variants.all())
    return {
        "id": str(p.id), "slug": p.slug, "title": p.title, "status": p.status, "brand": p.brand.name if p.brand_id else None,
        "category": {"id": str(p.primary_category_id), "name": p.primary_category.name, "path": p.primary_category.path},
        "cover": media_out(cover.media) if cover else None, "minPrice": p.min_price, "maxPrice": p.max_price, "currency": p.currency,
        "hasWholesale": p.min_bulk_price is not None, "variants": len(vs),
        "stock": sum(stock.get(v.id, 0) for v in vs), "inStock": p.in_stock, "featured": p.featured,
        "rating": p.rating_avg if p.rating_count else None, "updatedAt": p.updated_at.isoformat(), "publishedAt": p.published_at.isoformat() if p.published_at else None,
        "skus": [v.sku for v in vs][:4],
    }


class AdminProductsView(APIView):
    def get_permissions(self):
        return [AdminPerm("products.view")()] if self.request.method == "GET" else [AdminPerm("products.manage")()]

    def get(self, request):
        cursor, limit = page_params(request, 50, 200)
        q = request.query_params
        qs = Product.objects.filter(deleted_at__isnull=True).select_related("brand", "primary_category").prefetch_related("variants", "media_links__media")
        if q.get("q"):
            term = q["q"].strip()
            qs = qs.filter(Q(title__icontains=term) | Q(variants__sku__icontains=term) | Q(brand__name__icontains=term) | Q(variants__barcode=term)).distinct()
        if q.get("status"):
            qs = qs.filter(status__in=q["status"].split(","))
        if q.get("ids"):
            qs = qs.filter(id__in=[i for i in q["ids"].split(",") if len(i) == 36][:200])
        if q.get("categoryId"):
            c = _get(Category, q["categoryId"], "Category")
            qs = qs.filter(Q(category_links__category__path=c.path) | Q(category_links__category__path__startswith=c.path + "/")).distinct()
        if q.get("brandId"):
            qs = qs.filter(brand_id=q["brandId"])
        if q.get("lowStock") == "1":
            from inventory.models import InventoryLevel
            from django.db.models import F

            low = InventoryLevel.objects.filter(on_hand__lte=F("low_stock_threshold")).values("variant__product_id")
            qs = qs.filter(id__in=low)
        if q.get("noWholesale") == "1":
            qs = qs.filter(min_bulk_price__isnull=True)
        order = {"updated": ["-updated_at", "-id"], "title": ["title", "id"], "price": ["min_price", "id"], "-price": ["-min_price", "-id"]}.get(q.get("sort", "updated"), ["-updated_at", "-id"])
        rows, nxt = keyset(qs, order, cursor, limit)
        stock = prod_svc.stock_by_variant([v.id for p in rows for v in p.variants.all()])
        counts = dict(Product.objects.filter(deleted_at__isnull=True).values("status").annotate(n=Count("id")).values_list("status", "n"))
        return Response({"items": [_admin_row(p, stock) for p in rows], "nextCursor": nxt, "counts": counts})

    def post(self, request):
        p = prod_svc.upsert_product(request.data or {}, admin=request.user.admin, request=request)
        return Response(prod_svc.admin_product_out(Product.objects.get(id=p.id)), status=201)


class AdminProductView(APIView):
    def get_permissions(self):
        return [AdminPerm("products.view")()] if self.request.method == "GET" else [AdminPerm("products.manage")()]

    def get(self, request, pid):
        p = _get(Product, pid, "Product")
        return Response(prod_svc.admin_product_out(p) | {"qualityHints": prod_svc.quality_hints(p)})

    def put(self, request, pid):
        p = _get(Product, pid, "Product")
        expected = request.data.get("version")
        if expected is not None and int(expected) != p.version:
            raise ApiError.conflict("stale_product", "Someone else saved this product. Reload to see their changes.", {"version": p.version})
        p = prod_svc.upsert_product(request.data or {}, admin=request.user.admin, product=p, request=request, note=request.data.get("note") or "")
        p = Product.objects.get(id=p.id)
        return Response(prod_svc.admin_product_out(p) | {"qualityHints": prod_svc.quality_hints(p)})

    def patch(self, request, pid):
        """Inline edits from the product table: status, featured, a variant's price or stock."""
        p = _get(Product, pid, "Product")
        d = request.data
        if "status" in d:
            if d["status"] == "PUBLISHED":
                if not request.user.admin.has_perm_key("products.publish"):
                    raise ApiError.forbidden("Your role can't publish")
                prod_svc._assert_publishable(p)
                p.published_at = p.published_at or timezone.now()
            p.status = d["status"]
        if "featured" in d:
            p.featured = bool(d["featured"])
        p.updated_by = request.user.admin
        p.save()
        if "variant" in d:
            vd = d["variant"]
            v = ProductVariant.objects.filter(product=p, id=vd.get("id")).first()
            if v is None:
                raise ApiError.not_found("Variant")
            if "retailPrice" in vd:
                rp = int(vd["retailPrice"])
                if rp < 0 or (v.compare_at_price and v.compare_at_price <= rp):
                    raise ApiError.bad_request("Price must be positive and below the compare-at price")
                if any(t.unit_price >= rp for t in v.tiers.all()):
                    raise ApiError.bad_request("Retail must stay above every wholesale tier")
                v.retail_price = rp
                v.save(update_fields=["retail_price"])
            if "stock" in vd:
                from inventory.models import Store
                from inventory.services import set_stock

                store = _get(Store, vd["stock"]["storeId"], "Store")
                set_stock(store, v, int(vd["stock"]["quantity"]), admin=request.user.admin, reason="count", note="Inline edit")
        prod_svc.refresh_denormalised(p)
        audit("product.inline", "product", p.id, request=request, after=d)
        transaction.on_commit(cat_svc.refresh_counts)
        return Response(_admin_row(Product.objects.select_related("brand", "primary_category").prefetch_related("variants", "media_links__media").get(id=p.id), prod_svc.stock_by_variant(list(p.variants.values_list("id", flat=True)))))

    def delete(self, request, pid):
        p = _get(Product, pid, "Product")
        p.deleted_at = timezone.now()
        p.status = "ARCHIVED"
        p.save(update_fields=["deleted_at", "status"])
        audit("product.delete", "product", p.id, request=request)
        transaction.on_commit(cat_svc.refresh_counts)
        return Response({"ok": True})


class AdminProductDuplicateView(APIView):
    permission_classes = [AdminPerm("products.manage")]

    def post(self, request, pid):
        p = prod_svc.duplicate(_get(Product, pid, "Product"), admin=request.user.admin, request=request)
        return Response(prod_svc.admin_product_out(p), status=201)


class AdminProductVersionsView(APIView):
    permission_classes = [AdminPerm("products.view")]

    def get(self, request, pid):
        rows = ProductVersion.objects.filter(product_id=pid).select_related("created_by")[:100]
        return Response({"items": [{"version": v.version, "note": v.note, "by": (v.created_by.name or v.created_by.email) if v.created_by else None, "createdAt": v.created_at.isoformat(), "title": v.snapshot.get("title"), "status": v.snapshot.get("status")} for v in rows]})

    def post(self, request, pid):
        if not request.user.admin.has_perm_key("products.manage"):
            raise ApiError.forbidden()
        p = prod_svc.revert_to_version(_get(Product, pid, "Product"), int(request.data.get("version")), admin=request.user.admin, request=request)
        return Response(prod_svc.admin_product_out(Product.objects.get(id=p.id)))


class AdminProductPreviewView(APIView):
    """What a retail vs wholesale customer will see — powers the editor's live phone preview."""

    permission_classes = [AdminPerm("products.view")]

    def get(self, request, pid):
        p = prod_svc.card_queryset(Product.objects.filter(id=pid)).first()
        if p is None:
            raise ApiError.not_found("Product")
        ws = wholesale_settings()
        out = {}
        for who, ctx in (("retail", PricingContext("RETAIL", False, ws)), ("wholesale", PricingContext("WHOLESALE", True, ws))):
            out[who] = {"card": prod_svc.product_card(p, ctx, locale=request.query_params.get("locale", "en")), "detail": prod_svc.product_detail(p, ctx, locale=request.query_params.get("locale", "en"))}
        return Response(out)


class AdminProductPricingView(APIView):
    """Pricing tab: margins per variant and tier, plus scheduled price changes."""

    permission_classes = [AdminPerm("products.view")]

    def get(self, request, pid):
        p = _get(Product, pid, "Product")
        rows = []
        for v in p.variants.prefetch_related("tiers", "scheduled_prices"):
            rows.append({
                "variantId": str(v.id), "sku": v.sku, "retailPrice": v.retail_price, "compareAtPrice": v.compare_at_price, "costPrice": v.cost_price,
                "retailMarginBps": margin_bps(v.retail_price, v.cost_price),
                "tiers": [{"minQty": t.min_qty, "unitPrice": t.unit_price, "marginBps": margin_bps(t.unit_price, v.cost_price)} for t in v.tiers.all()],
                "scheduled": [{"id": str(s.id), "retailPrice": s.retail_price, "compareAtPrice": s.compare_at_price, "startsAt": s.starts_at.isoformat(), "appliedAt": s.applied_at.isoformat() if s.applied_at else None} for s in v.scheduled_prices.order_by("starts_at")],
            })
        return Response({"currency": p.currency, "variants": rows})

    def post(self, request, pid):
        if not request.user.admin.has_perm_key("products.manage"):
            raise ApiError.forbidden()
        d = request.data
        v = ProductVariant.objects.filter(product_id=pid, id=d.get("variantId")).first()
        if v is None:
            raise ApiError.not_found("Variant")
        from django.utils.dateparse import parse_datetime

        starts = parse_datetime(d.get("startsAt") or "")
        if not starts or starts <= timezone.now():
            raise ApiError.bad_request("Pick a future start time")
        s = ScheduledPriceChange.objects.create(variant=v, retail_price=int(d["retailPrice"]), compare_at_price=d.get("compareAtPrice"), starts_at=starts, created_by=request.user.admin)
        audit("price.schedule", "variant", v.id, request=request, after={"retailPrice": s.retail_price, "startsAt": s.starts_at.isoformat()})
        return Response({"id": str(s.id)}, status=201)


class AdminBulkPriceView(APIView):
    """Bulk price update by percentage for a filtered set (category subtree, brand or explicit ids)."""

    permission_classes = [AdminPerm("products.manage")]

    @transaction.atomic
    def post(self, request):
        d = request.data
        pct = float(d.get("percent", 0))
        if not -90 <= pct <= 500 or pct == 0:
            raise ApiError.bad_request("Percent must be between -90 and 500, and not zero")
        rounding = d.get("rounding", "nearest_100")
        apply_tiers = bool(d.get("includeTiers", True))
        qs = ProductVariant.objects.filter(product__deleted_at__isnull=True, is_active=True)
        if d.get("productIds"):
            qs = qs.filter(product_id__in=d["productIds"])
        elif d.get("categoryId"):
            c = _get(Category, d["categoryId"], "Category")
            qs = qs.filter(Q(product__category_links__category__path=c.path) | Q(product__category_links__category__path__startswith=c.path + "/")).distinct()
        elif d.get("brandId"):
            qs = qs.filter(product__brand_id=d["brandId"])
        else:
            raise ApiError.bad_request("Choose products, a category or a brand")
        from .pricing import apply_rounding

        factor = 1 + pct / 100
        changed, products = 0, set()
        for v in qs.prefetch_related("tiers"):
            new_retail = apply_rounding(v.retail_price * factor, rounding)
            if v.compare_at_price and v.compare_at_price <= new_retail:
                v.compare_at_price = None  # a raise past the old "was" price would fake a discount
            v.retail_price = new_retail
            v.save(update_fields=["retail_price", "compare_at_price"])
            if apply_tiers:
                for t in v.tiers.all():
                    t.unit_price = min(apply_rounding(t.unit_price * factor, rounding), new_retail - 1)
                    t.save(update_fields=["unit_price"])
            changed += 1
            products.add(v.product_id)
        for p in Product.objects.filter(id__in=products):
            prod_svc.refresh_denormalised(p)
        audit("price.bulk", "product", "", request=request, meta={"percent": pct, "variants": changed, "rounding": rounding})
        return Response({"variantsUpdated": changed, "productsUpdated": len(products)})


EXPORT_COLUMNS = ["product_slug", "title", "brand", "category_path", "status", "sku", "barcode", "options", "retail_price", "compare_at_price", "cost_price", "wholesale_tiers", "wholesale_moq", "weight_grams", "tags", "description"]


class AdminProductExportView(APIView):
    permission_classes = [AdminPerm("products.view")]

    def get(self, request):
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(EXPORT_COLUMNS)
        qs = ProductVariant.objects.filter(product__deleted_at__isnull=True).select_related("product__brand", "product__primary_category").prefetch_related("tiers", "option_values__option_type").order_by("product__title", "sort_order")
        for v in qs.iterator(chunk_size=500):
            p = v.product
            w.writerow([
                p.slug, p.title, p.brand.name if p.brand_id else "", p.primary_category.path, p.status, v.sku, v.barcode,
                "; ".join(f"{o.option_type.name}={o.value}" for o in v.option_values.all()), v.retail_price, v.compare_at_price or "", v.cost_price or "",
                "; ".join(f"{t.min_qty}:{t.unit_price}" for t in v.tiers.all()), v.wholesale_moq or "", v.weight_grams or "", ", ".join(p.tags or []), p.description_html,
            ])
        resp = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="smartwear-products-{timezone.now():%Y%m%d}.csv"'
        return resp


class AdminProductImportView(APIView):
    """CSV/XLSX import. Rows sharing `product_slug` form one product; `dryRun=1` validates without saving."""

    permission_classes = [AdminPerm("products.manage")]
    parser_classes = [MultiPartParser, JSONParser]

    def post(self, request):
        f = request.FILES.get("file")
        if f is None:
            raise ApiError.bad_request("Attach a CSV or XLSX file")
        if f.size > 10 * 1024 * 1024:
            raise ApiError.bad_request("Files up to 10 MB")
        rows = _read_sheet(f)
        dry = str(request.data.get("dryRun", "")).lower() in ("1", "true")
        groups: dict[str, list[dict]] = {}
        for r in rows:
            key = (r.get("product_slug") or r.get("title") or "").strip()
            if key:
                groups.setdefault(key, []).append(r)
        results: list[dict[str, Any]] = []
        for slug, lines in groups.items():
            try:
                with transaction.atomic():
                    data = _rows_to_product(slug, lines)
                    existing = Product.objects.filter(slug=data["slug"]).first()
                    prod_svc.upsert_product(data, admin=request.user.admin, product=existing, request=request, note="CSV import")
                    if dry:
                        transaction.set_rollback(True)
                results.append({"product": slug, "ok": True, "action": "update" if existing else "create"})
            except ApiError as e:
                results.append({"product": slug, "ok": False, "error": e.message, "details": e.details})
        ok = sum(1 for r in results if r["ok"])
        if not dry:
            audit("product.import", "product", "", request=request, meta={"ok": ok, "failed": len(results) - ok})
        return Response({"dryRun": dry, "ok": ok, "failed": len(results) - ok, "results": results})


def _read_sheet(f) -> list[dict]:
    name = (f.name or "").lower()
    if name.endswith(".xlsx"):
        try:
            from openpyxl import load_workbook
        except ImportError as e:
            raise ApiError.bad_request("XLSX support is not installed on the server; upload CSV") from e
        wb = load_workbook(f, read_only=True, data_only=True)
        ws = wb.active
        it = ws.iter_rows(values_only=True)
        header = [str(h or "").strip().lower() for h in next(it)]
        return [{header[i]: ("" if c is None else str(c)) for i, c in enumerate(row) if i < len(header)} for row in it]
    text = f.read().decode("utf-8-sig")
    return [{(k or "").strip().lower(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(io.StringIO(text))]


def _rows_to_product(slug: str, lines: list[dict]) -> dict:
    first = lines[0]
    path = first.get("category_path", "").strip()
    cat = Category.objects.filter(Q(path=path) | Q(slug=path.split("/")[-1])).first()
    if cat is None:
        raise ApiError.bad_request(f"Unknown category '{path}'")
    brand = None
    if first.get("brand"):
        brand = Brand.objects.filter(name__iexact=first["brand"].strip()).first()
        if brand is None:
            brand = Brand.objects.create(name=first["brand"].strip(), slug=slugify(first["brand"]))
    option_types: dict[str, list[str]] = {}
    variants = []
    for ln in lines:
        opts = []
        for pair in [x for x in (ln.get("options") or "").split(";") if "=" in x]:
            k, v = [s.strip() for s in pair.split("=", 1)]
            option_types.setdefault(k, [])
            if v not in option_types[k]:
                option_types[k].append(v)
            opts.append({"type": k, "value": v})
        tiers = []
        for t in [x for x in (ln.get("wholesale_tiers") or "").split(";") if ":" in x]:
            q, price = t.split(":")
            tiers.append({"minQty": int(q), "unitPrice": int(price)})
        variants.append({
            "sku": ln["sku"], "barcode": ln.get("barcode") or None, "optionValues": opts, "retailPrice": int(float(ln["retail_price"])),
            "compareAtPrice": int(float(ln["compare_at_price"])) if ln.get("compare_at_price") else None, "costPrice": int(float(ln["cost_price"])) if ln.get("cost_price") else None,
            "wholesaleTiers": tiers, "wholesaleMoq": int(ln["wholesale_moq"]) if ln.get("wholesale_moq") else None, "weightGrams": int(ln["weight_grams"]) if ln.get("weight_grams") else None,
        })
    kind_of = lambda n: "size" if n.lower() in ("size", "saizi") else "color" if n.lower() in ("colour", "color", "rangi") else "shade" if n.lower() == "shade" else "volume" if n.lower() in ("volume", "size (ml)") else "other"  # noqa: E731
    existing = Product.objects.filter(slug=slugify(slug)).first()
    base = prod_svc.admin_product_out(existing) if existing else {}
    return {
        **{k: base.get(k) for k in ("media", "badgeIds", "collectionIds", "relatedProductIds", "completeTheLookIds", "pairsWellWithIds", "attributes", "beauty", "sizeChartId", "fitNote") if k in base},
        "slug": slugify(slug), "title": first.get("title") or slug, "brandId": str(brand.id) if brand else None, "categoryIds": [str(cat.id)],
        "status": (first.get("status") or "DRAFT").upper() if (first.get("status") or "DRAFT").upper() in ("DRAFT", "ARCHIVED") else "DRAFT",
        "tags": [t.strip() for t in (first.get("tags") or "").split(",") if t.strip()], "descriptionHtml": first.get("description") or None,
        "optionTypes": [{"name": n, "kind": kind_of(n), "values": [{"value": v} for v in vals]} for n, vals in option_types.items()],
        "variants": variants,
    }


class AdminTemplatesView(APIView):
    def get_permissions(self):
        return [AdminPerm("products.view")()] if self.request.method == "GET" else [AdminPerm("catalog.manage")()]

    def get(self, request):
        return Response({"items": [{"id": str(t.id), "name": t.name, "categoryId": str(t.category_id) if t.category_id else None, "data": t.data} for t in ProductTemplate.objects.order_by("name")]})

    def post(self, request):
        d = request.data
        if not d.get("name"):
            raise ApiError.bad_request("Name the template")
        allowed = {"attributes", "optionTypes", "sizeChartId", "fitNote", "care", "materials", "tags", "department", "badgeIds", "categoryIds"}
        t, _ = ProductTemplate.objects.update_or_create(name=d["name"], defaults={"category_id": d.get("categoryId"), "data": {k: v for k, v in (d.get("data") or {}).items() if k in allowed}})
        return Response({"id": str(t.id)}, status=201)


# ================================================================ price lists & customer groups
class AdminPriceListsView(APIView):
    def get_permissions(self):
        return [AdminPerm("customers.view")()] if self.request.method == "GET" else [AdminPerm("wholesale.approve")()]

    def get(self, request):
        rows = PriceList.objects.select_related("customer", "group").annotate(n=Count("entries"))
        return Response({
            "items": [{"id": str(p.id), "name": p.name, "customer": {"id": str(p.customer_id), "name": p.customer.display_name} if p.customer_id else None, "group": {"id": str(p.group_id), "name": p.group.name} if p.group_id else None, "active": p.active, "entries": p.n, "startsAt": p.starts_at.isoformat() if p.starts_at else None, "endsAt": p.ends_at.isoformat() if p.ends_at else None} for p in rows],
            "groups": [{"id": str(g.id), "name": g.name, "members": g.members.count()} for g in CustomerGroup.objects.all()],
        })

    @transaction.atomic
    def post(self, request):
        d = request.data
        if not d.get("customerId") and not d.get("groupId"):
            raise ApiError.bad_request("Choose a customer or a customer group")
        pl = PriceList.objects.create(name=d.get("name") or "Price list", customer_id=d.get("customerId"), group_id=d.get("groupId"), starts_at=d.get("startsAt"), ends_at=d.get("endsAt"))
        _set_entries(pl, d.get("entries") or [])
        audit("pricelist.create", "price_list", pl.id, request=request)
        return Response({"id": str(pl.id)}, status=201)


class AdminPriceListView(APIView):
    permission_classes = [AdminPerm("wholesale.approve")]

    def get(self, request, plid):
        pl = _get(PriceList, plid, "Price list")
        return Response({"id": str(pl.id), "name": pl.name, "active": pl.active, "entries": [{"variantId": str(e.variant_id), "sku": e.variant.sku, "title": e.variant.product.title, "retailPrice": e.variant.retail_price, "minQty": e.min_qty, "unitPrice": e.unit_price} for e in pl.entries.select_related("variant__product")]})

    @transaction.atomic
    def put(self, request, plid):
        pl = _get(PriceList, plid, "Price list")
        for k, f in (("name", "name"), ("active", "active"), ("startsAt", "starts_at"), ("endsAt", "ends_at")):
            if k in request.data:
                setattr(pl, f, request.data[k])
        pl.save()
        if "entries" in request.data:
            _set_entries(pl, request.data["entries"])
        audit("pricelist.update", "price_list", pl.id, request=request)
        return Response({"ok": True})

    def delete(self, request, plid):
        _get(PriceList, plid, "Price list").delete()
        return Response({"ok": True})


def _set_entries(pl: PriceList, entries: list[dict]) -> None:
    PriceListEntry.objects.filter(price_list=pl).delete()
    variants = {str(v.id): v for v in ProductVariant.objects.filter(id__in=[e["variantId"] for e in entries])}
    objs = []
    for e in entries:
        v = variants.get(str(e["variantId"]))
        if v is None:
            raise ApiError.bad_request(f"Unknown variant {e['variantId']}")
        price = int(e["unitPrice"])
        if price <= 0 or price > v.retail_price:
            raise ApiError.bad_request(f"{v.sku}: price-list price must be above 0 and not above retail")
        objs.append(PriceListEntry(price_list=pl, variant=v, min_qty=max(1, int(e.get("minQty", 1))), unit_price=price))
    PriceListEntry.objects.bulk_create(objs)


class AdminCustomerGroupsView(APIView):
    permission_classes = [AdminPerm("customers.manage")]

    def post(self, request):
        g, _ = CustomerGroup.objects.get_or_create(name=(request.data.get("name") or "").strip() or "Group", defaults={"description": request.data.get("description") or ""})
        return Response({"id": str(g.id), "name": g.name}, status=201)


class AdminCatalogStatsView(APIView):
    permission_classes = [AdminPerm("products.view")]

    def get(self, request):
        from inventory.models import InventoryLevel

        return Response({
            "products": dict(Product.objects.filter(deleted_at__isnull=True).values("status").annotate(n=Count("id")).values_list("status", "n")),
            "categories": Category.objects.filter(archived_at__isnull=True).count(),
            "emptyLeafCategories": Category.objects.filter(archived_at__isnull=True, children__isnull=True, product_count=0).count(),
            "brands": Brand.objects.count(),
            "units": InventoryLevel.objects.aggregate(n=Sum("on_hand"))["n"] or 0,
        })
