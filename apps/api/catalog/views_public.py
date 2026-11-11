from __future__ import annotations

import hashlib
import json

from django.db.models import Q
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAppUser
from core import ratelimit
from core.audit import client_ip
from core.exceptions import ApiError
from core.media_urls import media_out
from core.pagination import page_params

from .models import Brand, Collection, Product, ProductView, SizeChart
from .services import categories as cat_svc
from .services import search as search_svc
from .services.products import card_queryset, cards, product_detail, size_chart_out
from .services.viewer import locale_of, request_context, request_user


def _etag_response(request, payload, max_age: int = 60, private: bool = False) -> Response:
    tag = '"' + hashlib.sha1(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:20] + '"'
    if request.headers.get("If-None-Match") == tag:
        resp = Response(status=304)
    else:
        resp = Response(payload)
    resp["ETag"] = tag
    resp["Cache-Control"] = f"{'private' if private else 'public'}, max-age={max_age}, stale-while-revalidate={max_age * 10}"
    resp["Vary"] = "Accept-Language, Authorization"
    return resp


def _cards_by_ids(ids: list, request) -> list[dict]:
    ctx = request_context(request)
    by = {p.id: p for p in card_queryset(Product.objects.filter(id__in=ids))}
    return cards([by[i] for i in ids if i in by], ctx, user=request_user(request), locale=locale_of(request))


class CategoryTreeView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        locale = locale_of(request)
        tree = cat_svc.public_tree(locale, include_empty=request.query_params.get("hideEmpty") != "1")
        return _etag_response(request, {"items": tree, "version": cat_svc.nav_tree_version()}, max_age=300)


class CategoryDetailView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, slug: str):
        cat = cat_svc.resolve(slug)
        if not cat.is_active or cat.archived_at:
            raise ApiError.not_found("Category")
        return _etag_response(request, cat_svc.category_detail(cat, locale_of(request)), max_age=300)


class ProductListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        cursor, limit = page_params(request, 24, 60)
        params = {k: v for k, v in request.query_params.items()}
        params["_locale"] = locale_of(request)
        if params.get("q"):
            ratelimit.enforce("search:ip", client_ip(request) or "", 240, 60)
            if not cursor:
                search_svc.record_query(params["q"])
        res = search_svc.list_products(params, cursor=cursor, limit=limit, want_facets=params.get("facets") == "1")
        body = {"items": _cards_by_ids(res["ids"], request), "nextCursor": res["nextCursor"], "sort": res["sort"], "fuzzy": res["fuzzy"]}
        for k in ("facets", "priceRange", "total"):
            if k in res:
                body[k] = res[k]
        return _etag_response(request, body, max_age=30, private=request_user(request) is not None)


class ProductDetailView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, slug: str):
        q = Q(slug=slug)
        if len(slug) == 36:
            q |= Q(id=slug)
        p = card_queryset(search_svc.published().filter(q)).first()
        if p is None:
            raise ApiError.not_found("Product")
        user = request_user(request)
        if user is not None:
            pv, created = ProductView.objects.get_or_create(user=user, product=p)
            if not created:
                ProductView.objects.filter(pk=pv.pk).update(count=pv.count + 1, viewed_at=timezone.now())
        Product.objects.filter(pk=p.pk).update(popularity=p.popularity + 1)
        data = product_detail(p, request_context(request), user=user, locale=locale_of(request))
        return _etag_response(request, data, max_age=30, private=user is not None)


class SuggestView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        ratelimit.enforce("suggest:ip", client_ip(request) or "", 600, 60)
        from core import settings_service

        s = search_svc.suggest(request.query_params.get("q", ""), locale=locale_of(request))
        return Response({
            "products": _cards_by_ids(s["productIds"], request), "categories": s["categories"], "brands": s["brands"], "queries": s["queries"],
            "trending": settings_service.get("search").trending,
        })


class BrandListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        qs = Brand.objects.filter(is_active=True).select_related("logo", "cover")
        if request.query_params.get("featured") == "1":
            qs = qs.filter(featured=True)
        return _etag_response(request, {"items": [brand_out(b, locale_of(request)) for b in qs]}, max_age=300)


class BrandDetailView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, slug: str):
        b = Brand.objects.select_related("logo", "cover").filter(slug=slug, is_active=True).first()
        if b is None:
            raise ApiError.not_found("Brand")
        return _etag_response(request, brand_out(b, locale_of(request)), max_age=300)


def brand_out(b: Brand, locale: str = "en") -> dict:
    return {"id": str(b.id), "slug": b.slug, "name": b.name, "story": (b.story_sw if locale == "sw" and b.story_sw else b.story) or None, "country": b.country or None, "logo": media_out(b.logo) if b.logo_id else None, "cover": media_out(b.cover) if b.cover_id else None, "featured": b.featured}


def collection_out(c: Collection, locale: str = "en", notify_count: int | None = None, subscribed: bool | None = None) -> dict:
    now = timezone.now()
    return {
        "id": str(c.id), "slug": c.slug, "title": c.title_sw if locale == "sw" and c.title_sw else c.title, "titleSw": c.title_sw or None,
        "subtitle": c.subtitle or None, "description": c.description or None, "cover": media_out(c.cover) if c.cover_id else None,
        "isDrop": c.is_drop, "launchesAt": c.launches_at.isoformat() if c.launches_at else None, "endsAt": c.ends_at.isoformat() if c.ends_at else None,
        "isLive": not c.launches_at or c.launches_at <= now, "productCount": Product.objects.filter(search_svc.collection_rule_q(c), status="PUBLISHED", deleted_at__isnull=True).distinct().count(),
        "notifyCount": notify_count, "subscribed": subscribed,
    }


class CollectionListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        now = timezone.now()
        qs = Collection.objects.filter(published=True).filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now)).select_related("cover")
        if request.query_params.get("drops") == "1":
            qs = qs.filter(is_drop=True)
        return Response({"items": [collection_out(c, locale_of(request)) for c in qs]})


class CollectionDetailView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, slug: str):
        c = Collection.objects.select_related("cover").filter(slug=slug, published=True).first()
        if c is None:
            raise ApiError.not_found("Collection")
        user = request_user(request)
        from marketing.models import DropSubscription

        subscribed = DropSubscription.objects.filter(collection=c, user=user).exists() if user else None
        return Response(collection_out(c, locale_of(request), subscribed=subscribed))


class SizeChartView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, chart_id):
        c = SizeChart.objects.filter(id=chart_id).first()
        if c is None:
            raise ApiError.not_found("Size chart")
        return _etag_response(request, size_chart_out(c), max_age=3600)


class RecentlyViewedView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request):
        ids = list(ProductView.objects.filter(user=request.user.user, product__status="PUBLISHED").order_by("-viewed_at").values_list("product_id", flat=True)[:20])
        return Response({"items": _cards_by_ids(ids, request)})

    def delete(self, request):
        ProductView.objects.filter(user=request.user.user).delete()
        return Response({"ok": True})
