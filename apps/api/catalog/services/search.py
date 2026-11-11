"""
Catalog listing & search on Postgres:
  * full-text (`search_vector`, simple config so Swahili and English both work) ranked by ts_rank
  * typo tolerance via pg_trgm word similarity on title + search_text when full-text is thin
  * category filters include the whole subtree (indexed path prefix)
  * facets for the filter sheet: subcategories, brands, sizes, colours/shades (with hex), price range, attributes
"""
from __future__ import annotations

import base64
import json
from collections import Counter
from datetime import timedelta
from typing import Any

from django.contrib.postgres.search import SearchQuery, SearchRank, TrigramWordSimilarity
from django.db.models import Count, F, Max, Min, Q, QuerySet
from django.utils import timezone

from core import settings_service
from core.exceptions import ApiError
from core.pagination import keyset

from ..models import AttributeDefinition, Brand, Category, OptionValue, Product
from . import categories as cat_svc

SORTS = {
    "newest": ["-published_at", "-id"],
    "price_asc": ["min_price", "id"],
    "price_desc": ["-min_price", "-id"],
    "rating": ["-rating_avg", "-id"],
    "popular": ["-popularity", "-id"],
}
RESERVED_PARAMS = {"q", "category", "brand", "brands", "collection", "sizes", "colors", "shades", "minPrice", "maxPrice", "minRating", "inStock", "isNew", "badge", "sort", "cursor", "limit", "department", "facets", "ids", "featured"}


def published() -> QuerySet:
    now = timezone.now()
    return Product.objects.filter(status="PUBLISHED", deleted_at__isnull=True).filter(Q(unpublish_at__isnull=True) | Q(unpublish_at__gt=now))


def _csv(v: str | None) -> list[str]:
    return [x.strip() for x in (v or "").split(",") if x.strip()]


def _int(v, field: str) -> int | None:
    if v in (None, ""):
        return None
    try:
        return int(v)
    except (TypeError, ValueError) as e:
        raise ApiError.bad_request(f"{field} must be a whole number") from e


def apply_filters(qs: QuerySet, params: dict[str, Any], *, skip: set[str] | None = None) -> QuerySet:
    skip = skip or set()
    if params.get("category") and "category" not in skip:
        cat = cat_svc.resolve(params["category"])
        qs = qs.filter(Q(category_links__category__path=cat.path) | Q(category_links__category__path__startswith=cat.path + "/"))
    if params.get("department") and "department" not in skip:
        qs = qs.filter(department__in=_csv(params["department"]) + ["unisex"])
    brands = _csv(params.get("brand") or params.get("brands"))
    if brands and "brand" not in skip:
        qs = qs.filter(Q(brand__slug__in=brands) | Q(brand_id__in=[b for b in brands if len(b) == 36]))
    if params.get("collection"):
        from ..models import Collection

        coll = Collection.objects.filter(Q(slug=params["collection"]) | Q(id__in=[params["collection"]] if len(params["collection"]) == 36 else [])).first()
        if coll is None:
            raise ApiError.not_found("Collection")
        qs = qs.filter(collection_rule_q(coll))
    for key, kinds in (("sizes", ["size"]), ("colors", ["color"]), ("shades", ["shade"])):
        vals = _csv(params.get(key))
        if vals and key not in skip:
            qs = qs.filter(variants__is_active=True, variants__option_values__option_type__kind__in=kinds, variants__option_values__value__in=vals)
    lo, hi = _int(params.get("minPrice"), "minPrice"), _int(params.get("maxPrice"), "maxPrice")
    if lo is not None and "price" not in skip:
        qs = qs.filter(min_price__gte=lo)
    if hi is not None and "price" not in skip:
        qs = qs.filter(min_price__lte=hi)
    if params.get("minRating"):
        qs = qs.filter(rating_avg__gte=float(params["minRating"]), rating_count__gt=0)
    if str(params.get("inStock", "")).lower() in ("1", "true"):
        qs = qs.filter(in_stock=True)
    if str(params.get("isNew", "")).lower() in ("1", "true"):
        qs = qs.filter(published_at__gte=timezone.now() - timedelta(days=21))
    if str(params.get("featured", "")).lower() in ("1", "true"):
        qs = qs.filter(featured=True)
    if params.get("badge"):
        qs = qs.filter(badges__key__in=_csv(params["badge"]))
    if params.get("ids"):
        qs = qs.filter(id__in=_csv(params["ids"])[:100])
    # Attribute filters: attr.<key>=a,b
    for k, v in params.items():
        if k.startswith("attr.") and v and k not in skip:
            key = k[5:]
            vals = _csv(v)
            q = Q()
            for val in vals:
                q |= Q(**{f"attributes__{key}": val}) | Q(**{f"attributes__{key}__contains": [val]})
            qs = qs.filter(q)
    return qs.distinct()


def collection_rule_q(coll) -> Q:
    manual = Q(collectionproduct__collection=coll)
    rule = coll.rule or {}
    if not rule:
        return manual
    rq = Q()
    if rule.get("categoryIds"):
        cq = Q()
        for c in Category.objects.filter(id__in=rule["categoryIds"]):
            cq |= Q(category_links__category__path=c.path) | Q(category_links__category__path__startswith=c.path + "/")
        rq &= cq
    if rule.get("brandIds"):
        rq &= Q(brand_id__in=rule["brandIds"])
    if rule.get("tags"):
        tq = Q()
        for t in rule["tags"]:
            tq |= Q(tags__contains=[t])
        rq &= tq
    if rule.get("isNewDays"):
        rq &= Q(published_at__gte=timezone.now() - timedelta(days=int(rule["isNewDays"])))
    if rule.get("minPrice") is not None:
        rq &= Q(min_price__gte=rule["minPrice"])
    if rule.get("maxPrice") is not None:
        rq &= Q(min_price__lte=rule["maxPrice"])
    if rule.get("department"):
        rq &= Q(department=rule["department"])
    return manual | rq


def _text_search(qs: QuerySet, q: str) -> tuple[QuerySet, bool]:
    """Returns (queryset annotated with `score`, used_fuzzy)."""
    q = q.strip()[:120]
    query = SearchQuery(q, search_type="websearch", config="simple")
    prefix_terms = " & ".join(f"{w}:*" for w in "".join(c if c.isalnum() or c.isspace() else " " for c in q).split() if w)
    prefix = SearchQuery(prefix_terms, search_type="raw", config="simple") if prefix_terms else query
    ft = qs.filter(Q(search_vector=query) | Q(search_vector=prefix)).annotate(score=SearchRank(F("search_vector"), prefix) + F("popularity") * 0.0001)
    if ft.exists() or not settings_service.get("search").typoTolerance:
        return ft, False
    fz = qs.annotate(score=TrigramWordSimilarity(q, "title") * 1.0 + TrigramWordSimilarity(q, "search_text") * 0.6).filter(score__gt=0.3)
    return fz, True


def list_products(params: dict[str, Any], *, cursor: str | None, limit: int, want_facets: bool = False) -> dict[str, Any]:
    base = published()
    q = (params.get("q") or "").strip()
    sort = params.get("sort") or ("relevance" if q else "newest")
    if sort not in SORTS and sort != "relevance":
        raise ApiError.bad_request("Unknown sort")
    filtered = apply_filters(base, params)
    fuzzy = False
    if q:
        filtered, fuzzy = _text_search(filtered, q)
    if sort == "relevance" and q:
        offset = 0
        if cursor:
            try:
                offset = int(json.loads(base64.urlsafe_b64decode(cursor + "==").decode())["o"])
            except Exception as e:  # noqa: BLE001
                raise ApiError.bad_request("Invalid cursor") from e
        ids = list(filtered.order_by("-score", "-id").values_list("id", flat=True)[offset : offset + limit + 1])
        more = len(ids) > limit
        ids = ids[:limit]
        nxt = base64.urlsafe_b64encode(json.dumps({"o": offset + limit}).encode()).decode().rstrip("=") if more else None
        rows = ids
    else:
        if sort == "relevance":
            sort = "newest"
        id_qs = Product.objects.filter(id__in=filtered.values("id"))
        found, nxt = keyset(id_qs.only("id", "published_at", "min_price", "rating_avg", "popularity"), SORTS[sort], cursor, limit)
        rows = [r.id for r in found]
    out: dict[str, Any] = {"ids": rows, "nextCursor": nxt, "fuzzy": fuzzy, "sort": sort}
    if want_facets and not cursor:
        out["facets"], out["priceRange"] = facets(base, params, filtered if q else None)
        out["total"] = filtered.count()
    return out


def facets(base: QuerySet, params: dict[str, Any], text_filtered: QuerySet | None = None) -> tuple[list[dict], dict]:
    locale = params.get("_locale", "en")
    scope = text_filtered if text_filtered is not None else base
    ctx_qs = apply_filters(scope, params, skip={"brand", "sizes", "colors", "shades", "price"} | {k for k in params if k.startswith("attr.")})
    ids = list(ctx_qs.values_list("id", flat=True)[:5000])
    result: list[dict] = []
    # subcategories of the current category (or roots)
    current = cat_svc.resolve(params["category"]) if params.get("category") else None
    children = Category.objects.filter(parent=current, is_active=True, archived_at__isnull=True) if current else Category.objects.filter(parent__isnull=True, is_active=True, archived_at__isnull=True)
    cat_values = []
    for c in children.order_by("sort_order"):
        n = Product.objects.filter(id__in=ids).filter(Q(category_links__category__path=c.path) | Q(category_links__category__path__startswith=c.path + "/")).distinct().count()
        if n:
            cat_values.append({"value": c.slug, "label": c.name_sw if locale == "sw" and c.name_sw else c.name, "count": n})
    if cat_values:
        result.append({"key": "category", "label": "Category", "values": cat_values})
    brand_counts = Brand.objects.filter(products__id__in=ids).annotate(n=Count("products", distinct=True)).order_by("-n", "name")[:40]
    if brand_counts:
        result.append({"key": "brand", "label": "Brand", "values": [{"value": b.slug, "label": b.name, "count": b.n} for b in brand_counts]})
    for kind, key, label in (("size", "sizes", "Size"), ("color", "colors", "Colour"), ("shade", "shades", "Shade")):
        vals = OptionValue.objects.filter(option_type__kind=kind, option_type__product_id__in=ids).values("value").annotate(n=Count("option_type__product", distinct=True), hex=Max("swatch_hex"), label=Max("label"), so=Min("sort_order")).order_by("so", "value")[:60]
        if vals:
            result.append({"key": key, "label": label, "values": [{"value": v["value"], "label": v["label"] or v["value"], "count": v["n"], "hex": v["hex"] or None} for v in vals]})
    if current is not None:
        keys = cat_svc.effective_attribute_keys(current)
        counters: dict[str, Counter] = {k: Counter() for k in keys}
        for attrs in Product.objects.filter(id__in=ids).values_list("attributes", flat=True):
            for k in keys:
                v = (attrs or {}).get(k)
                for x in (v if isinstance(v, list) else [v] if v else []):
                    counters[k][str(x)] += 1
        for d in AttributeDefinition.objects.filter(key__in=keys, filterable=True):
            if counters.get(d.key):
                labels = {o["value"]: (o.get("labelSw") if locale == "sw" and o.get("labelSw") else o["label"]) for o in d.options}
                result.append({"key": f"attr.{d.key}", "label": d.label_sw if locale == "sw" and d.label_sw else d.label, "values": [{"value": v, "label": labels.get(v, v), "count": n} for v, n in counters[d.key].most_common()]})
    pr = Product.objects.filter(id__in=ids).aggregate(lo=Min("min_price"), hi=Max("min_price"))
    return result, {"min": pr["lo"] or 0, "max": pr["hi"] or 0}


def suggest(q: str, *, limit: int = 6, locale: str = "en") -> dict[str, Any]:
    q = (q or "").strip()
    if len(q) < 2:
        return {"productIds": [], "categories": [], "brands": [], "queries": []}
    base = published()
    qs, _ = _text_search(base, q)
    ids = list(qs.order_by("-score", "-popularity").values_list("id", flat=True)[:limit])
    cats = (
        Category.objects.filter(is_active=True, archived_at__isnull=True)
        .annotate(sim=TrigramWordSimilarity(q, "name") + TrigramWordSimilarity(q, "name_sw"))
        .filter(Q(name__icontains=q) | Q(name_sw__icontains=q) | Q(sim__gt=0.45)).order_by("-sim", "depth")[:5]
    )
    brands = Brand.objects.filter(is_active=True).annotate(sim=TrigramWordSimilarity(q, "name")).filter(Q(name__icontains=q) | Q(sim__gt=0.45)).order_by("-sim")[:4]

    def crumb(c: Category) -> str:
        chain = cat_svc.ancestors(c)
        return " · ".join((x.name_sw if locale == "sw" and x.name_sw else x.name) for x in chain[:-1])

    return {
        "productIds": ids,
        "categories": [{"id": str(c.id), "slug": c.slug, "name": c.name_sw if locale == "sw" and c.name_sw else c.name, "context": crumb(c)} for c in cats],
        "brands": [{"id": str(b.id), "slug": b.slug, "name": b.name} for b in brands],
        "queries": _popular_queries(q),
    }


def record_query(q: str) -> None:
    q = " ".join((q or "").lower().split())[:60]
    if len(q) < 3:
        return
    try:
        r = settings_service.redis_client()
        r.zincrby("sw:search:popular", 1, q)
    except Exception:  # noqa: BLE001
        pass


def _popular_queries(prefix: str) -> list[str]:
    try:
        r = settings_service.redis_client()
        top = r.zrevrange("sw:search:popular", 0, 400)
    except Exception:  # noqa: BLE001
        return []
    p = prefix.lower()
    return [t for t in top if t.startswith(p) and t != p][:5]
