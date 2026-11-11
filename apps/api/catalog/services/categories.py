"""
Category rules (enforced here and by DB constraints):

* Roots come only from taxonomy.ROOTS. Core roots exist from the seed; optional roots can be enabled by
  someone with `catalog.roots` (Super Admin). Root keys and slugs are fixed; display names may be edited.
* Everyone else can add, rename, reorder, move and archive *subcategories*, down to MAX_DEPTH.
* A subcategory always belongs to the same root as its parent; moving re-roots the whole subtree,
  rewrites `path`/`depth` for every descendant in one statement and is rejected if it would create a
  cycle or exceed MAX_DEPTH. Roots cannot be moved, and nothing can be moved to the top level.
* Deleting is only possible for an empty subtree; otherwise archive it, optionally reassigning products
  to another category first.
* The navigation tree is cached in Redis under a version key that every write bumps.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from django.db import IntegrityError, connection, transaction
from django.db.models import Count, Q
from django.utils import timezone
from slugify import slugify

from core import settings_service
from core.audit import audit
from core.exceptions import ApiError
from core.media_urls import media_out

from ..models import AttributeDefinition, Category, Product, ProductCategory, SizeChart
from ..taxonomy import CATEGORY_ICONS, MAX_DEPTH, ROOT_BY_KEY, ROOTS

logger = logging.getLogger("smartwear.catalog")
TREE_KEY = "sw:catalog:tree:{v}:{scope}"
VERSION_KEY = "sw:catalog:version"


# ---------------------------------------------------------------- cache
def nav_tree_version() -> int:
    try:
        return int(settings_service.redis_client().get(VERSION_KEY) or 0)
    except Exception:  # noqa: BLE001
        return 0


def bump_version() -> None:
    try:
        settings_service.redis_client().incr(VERSION_KEY)
    except Exception as e:  # noqa: BLE001
        logger.warning("catalog version bump failed: %s", e)


# ---------------------------------------------------------------- helpers
def unique_slug(base: str, exclude_id=None) -> str:
    root = slugify(base, max_length=80) or "category"
    slug, i = root, 2
    while Category.objects.filter(slug=slug).exclude(id=exclude_id).exists():
        slug = f"{root}-{i}"
        i += 1
    return slug


def subtree(cat: Category):
    return Category.objects.filter(Q(id=cat.id) | Q(path__startswith=cat.path + "/"))


def subtree_ids(cat: Category) -> list:
    return list(subtree(cat).values_list("id", flat=True))


def ancestors(cat: Category) -> list[Category]:
    slugs = cat.path.split("/")
    by_slug = {c.slug: c for c in Category.objects.filter(slug__in=slugs)}
    return [by_slug[s] for s in slugs if s in by_slug]


def effective_attribute_keys(cat: Category) -> list[str]:
    """Attributes introduced on this category and every ancestor (root first, deduplicated)."""
    seen: list[str] = []
    for c in ancestors(cat):
        for k in c.attribute_keys or []:
            if k not in seen:
                seen.append(k)
    return seen


def effective_size_chart(cat: Category) -> SizeChart | None:
    for c in reversed(ancestors(cat)):
        if c.default_size_chart_id:
            return c.default_size_chart
    return None


def _validate_attribute_keys(keys: list[str]) -> list[str]:
    keys = [k for k in dict.fromkeys(keys or [])]
    known = set(AttributeDefinition.objects.filter(key__in=keys).values_list("key", flat=True))
    unknown = [k for k in keys if k not in known]
    if unknown:
        raise ApiError.bad_request(f"Unknown attributes: {', '.join(unknown)}", details={"field": "attributeKeys"})
    return keys


def _validate_icon(icon: str | None) -> str:
    if icon and icon not in CATEGORY_ICONS:
        raise ApiError.bad_request("Pick an icon from the SmartWear icon set", details={"field": "icon", "allowed": CATEGORY_ICONS})
    return icon or ""


def _can_manage_roots(admin) -> bool:
    return admin is not None and admin.has_perm_key("catalog.roots")


# ---------------------------------------------------------------- roots
def available_roots() -> list[dict[str, Any]]:
    existing = {c.root_key: c for c in Category.objects.filter(parent__isnull=True)}
    return [{"key": r.key, "name": r.name, "nameSw": r.name_sw, "kind": r.kind, "core": r.core, "description": r.description, "enabled": r.key in existing and existing[r.key].archived_at is None, "id": str(existing[r.key].id) if r.key in existing else None} for r in ROOTS]


def enable_root(key: str, *, admin, request=None) -> Category:
    if not _can_manage_roots(admin):
        raise ApiError.forbidden("Only a Super Admin can add a top-level category")
    spec = ROOT_BY_KEY.get(key)
    if spec is None:
        raise ApiError.bad_request("SmartWear only sells fashion and beauty. Choose one of the available top-level departments.", details={"allowed": [r.key for r in ROOTS]})
    with transaction.atomic():
        cat = Category.objects.filter(parent__isnull=True, root_key=key).first()
        if cat:
            if cat.archived_at:
                subtree(cat).update(archived_at=None, is_active=True)
                cat.refresh_from_db()
        else:
            cat = Category.objects.create(
                parent=None, root_key=key, slug=key, path=key, depth=0, name=spec.name, name_sw=spec.name_sw, kind=spec.kind,
                department=spec.department, icon=spec.icon, description=spec.description,
                sort_order=(Category.objects.filter(parent__isnull=True).count()) * 10,
            )
        audit("category.root.enable", "category", cat.id, request=request, admin=admin, after={"key": key})
    transaction.on_commit(bump_version)
    return cat


# ---------------------------------------------------------------- create / update
def create(data: dict[str, Any], *, admin, request=None) -> Category:
    parent_id = data.get("parentId")
    if not parent_id:
        if data.get("rootKey"):
            return enable_root(data["rootKey"], admin=admin, request=request)
        raise ApiError.bad_request(
            "Top-level departments are fixed to fashion and beauty. Add this as a subcategory, or ask a Super Admin to enable an optional department.",
            details={"field": "parentId"},
        )
    parent = Category.objects.filter(id=parent_id).first()
    if parent is None:
        raise ApiError.not_found("Parent category")
    if parent.archived_at:
        raise ApiError.bad_request("Restore the parent category before adding to it")
    if parent.depth + 1 > MAX_DEPTH:
        raise ApiError.bad_request(f"Categories can be at most {MAX_DEPTH + 1} levels deep", details={"field": "parentId"})
    name = (data.get("name") or "").strip()
    if not name:
        raise ApiError.bad_request("Name is required", details={"field": "name"})
    slug = unique_slug(data.get("slug") or f"{parent.slug if parent.depth else parent.root_key}-{name}")
    siblings = Category.objects.filter(parent=parent)
    sort = data.get("sortOrder")
    if sort is None:
        last = siblings.order_by("-sort_order").values_list("sort_order", flat=True).first()
        sort = (last or 0) + 10
    try:
        with transaction.atomic():
            cat = Category.objects.create(
                parent=parent, root_key=parent.root_key, slug=slug, path=f"{parent.path}/{slug}", depth=parent.depth + 1,
                name=name, name_sw=(data.get("nameSw") or "").strip(), description=data.get("description") or "", description_sw=data.get("descriptionSw") or "",
                kind=parent.kind, department=data.get("department") or parent.department, icon=_validate_icon(data.get("icon")),
                image_id=data.get("imageMediaId"), sort_order=sort, show_in_nav=data.get("showInNav", True), is_featured=data.get("isFeatured", False),
                attribute_keys=_validate_attribute_keys(data.get("attributeKeys") or []), default_size_chart_id=data.get("defaultSizeChartId"),
                seo_title=data.get("seoTitle") or "", seo_description=data.get("seoDescription") or "",
            )
            audit("category.create", "category", cat.id, request=request, admin=admin, after=category_admin_out(cat))
    except IntegrityError as e:
        if "unique_sibling_name" in str(e):
            raise ApiError.conflict("duplicate_name", f'"{name}" already exists under {parent.name}') from e
        raise
    transaction.on_commit(bump_version)
    return cat


EDITABLE = {
    "name": "name", "nameSw": "name_sw", "description": "description", "descriptionSw": "description_sw", "department": "department",
    "imageMediaId": "image_id", "showInNav": "show_in_nav", "isFeatured": "is_featured", "seoTitle": "seo_title", "seoDescription": "seo_description",
    "defaultSizeChartId": "default_size_chart_id", "isActive": "is_active",
}


def update(cat: Category, data: dict[str, Any], *, admin, request=None) -> Category:
    before = category_admin_out(cat)
    if cat.is_root and "name" in data and not _can_manage_roots(admin):
        raise ApiError.forbidden("Only a Super Admin can rename a top-level department")
    for k, field in EDITABLE.items():
        if k in data:
            v = data[k]
            if k == "name":
                v = (v or "").strip()
                if not v:
                    raise ApiError.bad_request("Name is required", details={"field": "name"})
            setattr(cat, field, v if v is not None or field.endswith("_id") or field == "department" else "")
    if "icon" in data:
        cat.icon = _validate_icon(data["icon"])
    if "attributeKeys" in data:
        cat.attribute_keys = _validate_attribute_keys(data["attributeKeys"])
    if "slug" in data and data["slug"] and data["slug"] != cat.slug:
        if cat.is_root:
            raise ApiError.bad_request("Top-level department URLs are fixed")
        _reslug(cat, data["slug"])
    try:
        with transaction.atomic():
            cat.save()
            if "isActive" in data and not data["isActive"]:
                subtree(cat).update(is_active=False)
            audit("category.update", "category", cat.id, request=request, admin=admin, before=before, after=category_admin_out(cat))
    except IntegrityError as e:
        if "unique_sibling_name" in str(e):
            raise ApiError.conflict("duplicate_name", "A sibling category already has that name") from e
        raise
    if "parentId" in data and str(data["parentId"] or "") != str(cat.parent_id or ""):
        cat = move(cat, data["parentId"], admin=admin, request=request)
    transaction.on_commit(bump_version)
    return cat


def _reslug(cat: Category, new_slug: str) -> None:
    slug = unique_slug(new_slug, exclude_id=cat.id)
    old_path = cat.path
    new_path = (old_path.rsplit("/", 1)[0] + "/" + slug) if "/" in old_path else slug
    with transaction.atomic():
        _rewrite_paths(old_path, new_path, depth_delta=0, root_key=cat.root_key)
        Category.objects.filter(id=cat.id).update(slug=slug)
    cat.refresh_from_db()


def _rewrite_paths(old_prefix: str, new_prefix: str, *, depth_delta: int, root_key: str) -> None:
    with connection.cursor() as c:
        c.execute(
            f"""UPDATE {Category._meta.db_table}
                SET path = %s || substr(path, %s), depth = depth + %s, root_key = %s
                WHERE path = %s OR path LIKE %s""",
            [new_prefix, len(old_prefix) + 1, depth_delta, root_key, old_prefix, old_prefix.replace("%", r"\%").replace("_", r"\_") + "/%"],
        )


def move(cat: Category, new_parent_id, *, position: int | None = None, admin=None, request=None) -> Category:
    if cat.is_root:
        raise ApiError.bad_request("Top-level departments can't be moved")
    if not new_parent_id:
        raise ApiError.bad_request("A subcategory can't become a top-level department")
    parent = Category.objects.filter(id=new_parent_id).first()
    if parent is None:
        raise ApiError.not_found("Destination category")
    if parent.id == cat.id or parent.path == cat.path or parent.path.startswith(cat.path + "/"):
        raise ApiError.bad_request("A category can't be moved inside itself")
    max_sub = max(subtree(cat).values_list("depth", flat=True)) - cat.depth
    new_depth = parent.depth + 1
    if new_depth + max_sub > MAX_DEPTH:
        raise ApiError.bad_request(f"That move would make the tree deeper than {MAX_DEPTH + 1} levels")
    if parent.kind != cat.kind:
        # Moving between fashion and beauty is allowed but the subtree takes the destination kind.
        pass
    before = category_admin_out(cat)
    old_path, new_path = cat.path, f"{parent.path}/{cat.slug}"
    try:
        with transaction.atomic():
            Category.objects.select_for_update().filter(Q(id=cat.id) | Q(id=parent.id)).exists()
            _rewrite_paths(old_path, new_path, depth_delta=new_depth - cat.depth, root_key=parent.root_key)
            subtree(Category.objects.get(id=cat.id)).update(kind=parent.kind)
            Category.objects.filter(id=cat.id).update(parent=parent)
            cat.refresh_from_db()
            if position is not None:
                ids = [str(i) for i in Category.objects.filter(parent=parent).exclude(id=cat.id).order_by("sort_order", "name").values_list("id", flat=True)]
                ids.insert(max(0, min(position, len(ids))), str(cat.id))
                _apply_order(parent.id, ids)
            audit("category.move", "category", cat.id, request=request, admin=admin, before=before, after=category_admin_out(cat))
    except IntegrityError as e:
        raise ApiError.conflict("duplicate_name", f"{parent.name} already has a category called {cat.name}") from e
    transaction.on_commit(bump_version)
    _refresh_counts()
    return cat


def _apply_order(parent_id, ids: list[str]) -> None:
    existing = {str(i) for i in Category.objects.filter(parent_id=parent_id).values_list("id", flat=True)} if parent_id else {str(i) for i in Category.objects.filter(parent__isnull=True).values_list("id", flat=True)}
    if set(ids) != existing:
        raise ApiError.bad_request("Send every sibling exactly once to reorder", details={"expected": len(existing), "got": len(ids)})
    for i, cid in enumerate(ids):
        Category.objects.filter(id=cid).update(sort_order=(i + 1) * 10)


def reorder(parent_id, ids: list[str], *, admin, request=None) -> None:
    if not parent_id and not _can_manage_roots(admin):
        raise ApiError.forbidden("Only a Super Admin can reorder top-level departments")
    with transaction.atomic():
        _apply_order(parent_id, ids)
        audit("category.reorder", "category", parent_id or "root", request=request, admin=admin, after={"order": ids})
    transaction.on_commit(bump_version)


def archive(cat: Category, *, admin, request=None, reassign_to_id=None) -> dict[str, int]:
    """Hide a subtree from the shop. With `reassign_to_id`, products move there first so nothing is orphaned."""
    if cat.is_root and not _can_manage_roots(admin):
        raise ApiError.forbidden("Only a Super Admin can archive a top-level department")
    ids = subtree_ids(cat)
    moved = 0
    with transaction.atomic():
        if reassign_to_id:
            target = Category.objects.filter(id=reassign_to_id, archived_at__isnull=True).first()
            if target is None or target.id in ids:
                raise ApiError.bad_request("Choose an active category outside the one you are archiving")
            moved = _reassign_products(ids, target)
        now = timezone.now()
        Category.objects.filter(id__in=ids).update(archived_at=now, is_active=False)
        audit("category.archive", "category", cat.id, request=request, admin=admin, meta={"subtree": len(ids), "reassigned": moved, "to": str(reassign_to_id or "")})
    transaction.on_commit(bump_version)
    _refresh_counts()
    return {"archived": len(ids), "productsReassigned": moved}


def restore(cat: Category, *, admin, request=None) -> None:
    if cat.parent_id and Category.objects.filter(id=cat.parent_id, archived_at__isnull=False).exists():
        raise ApiError.bad_request("Restore the parent category first")
    subtree(cat).update(archived_at=None, is_active=True)
    audit("category.restore", "category", cat.id, request=request, admin=admin)
    transaction.on_commit(bump_version)


def _reassign_products(ids: list, target: Category) -> int:
    product_ids = set(ProductCategory.objects.filter(category_id__in=ids).values_list("product_id", flat=True)) | set(Product.objects.filter(primary_category_id__in=ids).values_list("id", flat=True))
    for pid in product_ids:
        ProductCategory.objects.filter(product_id=pid, category_id__in=ids).delete()
        link, _ = ProductCategory.objects.get_or_create(product_id=pid, category=target)
        if Product.objects.filter(id=pid, primary_category_id__in=ids).exists():
            ProductCategory.objects.filter(product_id=pid, is_primary=True).update(is_primary=False)
            link.is_primary = True
            link.save(update_fields=["is_primary"])
            Product.objects.filter(id=pid).update(primary_category=target)
    return len(product_ids)


def delete(cat: Category, *, admin, request=None) -> None:
    if cat.is_root:
        raise ApiError.bad_request("Top-level departments can be archived, not deleted")
    ids = subtree_ids(cat)
    if len(ids) > 1:
        raise ApiError.conflict("has_children", "Move or delete the subcategories first, or archive this category instead")
    if ProductCategory.objects.filter(category_id__in=ids).exists() or Product.objects.filter(primary_category_id__in=ids).exists():
        raise ApiError.conflict("has_products", "This category still has products. Archive it and reassign the products instead.")
    before = category_admin_out(cat)
    cat.delete()
    audit("category.delete", "category", before["id"], request=request, admin=admin, before=before)
    transaction.on_commit(bump_version)


# ---------------------------------------------------------------- counts
def _refresh_counts() -> None:
    """Recompute published product counts per subtree in one SQL pass."""
    table, link, prod = Category._meta.db_table, ProductCategory._meta.db_table, Product._meta.db_table
    with transaction.atomic(), connection.cursor() as c:
        c.execute(f"UPDATE {table} SET product_count = 0 WHERE product_count <> 0")
        c.execute(
            f"""
            UPDATE {table} AS c SET product_count = sub.n
            FROM (
              SELECT anc.id, COUNT(DISTINCT p.id) AS n
              FROM {table} anc
              JOIN {table} d ON d.path = anc.path OR d.path LIKE anc.path || '/%%'
              JOIN {link} l ON l.category_id = d.id
              JOIN {prod} p ON p.id = l.product_id AND p.status = 'PUBLISHED' AND p.deleted_at IS NULL
              GROUP BY anc.id
            ) sub
            WHERE sub.id = c.id
            """,
            [],
        )


def refresh_counts() -> None:
    _refresh_counts()
    bump_version()


# ---------------------------------------------------------------- output
def category_admin_out(c: Category) -> dict[str, Any]:
    return {
        "id": str(c.id), "parentId": str(c.parent_id) if c.parent_id else None, "rootKey": c.root_key, "slug": c.slug, "path": c.path, "depth": c.depth,
        "name": c.name, "nameSw": c.name_sw or None, "description": c.description or None, "descriptionSw": c.description_sw or None, "kind": c.kind,
        "department": c.department, "icon": c.icon or None, "imageMediaId": str(c.image_id) if c.image_id else None, "sortOrder": c.sort_order,
        "isActive": c.is_active, "showInNav": c.show_in_nav, "isFeatured": c.is_featured, "attributeKeys": c.attribute_keys or [],
        "defaultSizeChartId": str(c.default_size_chart_id) if c.default_size_chart_id else None, "seoTitle": c.seo_title or None,
        "seoDescription": c.seo_description or None, "productCount": c.product_count, "archived": c.archived_at is not None, "isRoot": c.parent_id is None,
    }


def _public_node(c: Category, locale: str) -> dict[str, Any]:
    name = c.name_sw if locale == "sw" and c.name_sw else c.name
    return {
        "id": str(c.id), "slug": c.slug, "name": name, "nameSw": c.name_sw or None, "parentId": str(c.parent_id) if c.parent_id else None,
        "isRoot": c.parent_id is None, "depth": c.depth, "kind": c.kind, "department": c.department, "icon": c.icon or None,
        "sortOrder": c.sort_order, "image": media_out(c.image) if c.image_id else None, "productCount": c.product_count, "isFeatured": c.is_featured, "children": [],
    }


def build_tree(rows: list[Category], render) -> list[dict[str, Any]]:
    nodes = {r.id: render(r) for r in rows}
    roots: list[dict] = []
    for r in sorted(rows, key=lambda r: (r.depth, r.sort_order, r.name.lower())):
        node = nodes[r.id]
        if r.parent_id and r.parent_id in nodes:
            nodes[r.parent_id]["children"].append(node)
        elif r.parent_id is None:
            roots.append(node)
    return roots


def public_tree(locale: str = "en", *, include_empty: bool = True) -> list[dict[str, Any]]:
    v = nav_tree_version()
    key = TREE_KEY.format(v=v, scope=f"public:{locale}:{int(include_empty)}")
    try:
        cached = settings_service.redis_client().get(key)
        if cached:
            return json.loads(cached)
    except Exception:  # noqa: BLE001
        pass
    qs = Category.objects.filter(is_active=True, archived_at__isnull=True, show_in_nav=True).select_related("image")
    if not include_empty:
        qs = qs.filter(product_count__gt=0)
    tree = build_tree(list(qs), lambda c: _public_node(c, locale))
    try:
        settings_service.redis_client().set(key, json.dumps(tree), ex=3600)
    except Exception:  # noqa: BLE001
        pass
    return tree


def admin_tree(include_archived: bool = False) -> list[dict[str, Any]]:
    qs = Category.objects.all()
    if not include_archived:
        qs = qs.filter(archived_at__isnull=True)
    rows = list(qs)
    direct = dict(ProductCategory.objects.filter(category_id__in=[r.id for r in rows]).values("category_id").annotate(n=Count("product_id", distinct=True)).values_list("category_id", "n"))

    def render(c: Category) -> dict[str, Any]:
        d = category_admin_out(c)
        d["children"] = []
        d["directProductCount"] = direct.get(c.id, 0)
        return d

    return build_tree(rows, render)


def resolve(slug_or_id: str) -> Category:
    q = Q(slug=slug_or_id)
    try:
        import uuid

        uuid.UUID(str(slug_or_id))
        q |= Q(id=slug_or_id)
    except ValueError:
        pass
    cat = Category.objects.select_related("image", "default_size_chart").filter(q).first()
    if cat is None:
        raise ApiError.not_found("Category")
    return cat


def category_detail(cat: Category, locale: str = "en") -> dict[str, Any]:
    """Public category page payload: breadcrumbs, children, filterable attributes and size chart."""
    chain = ancestors(cat)
    children = Category.objects.filter(parent=cat, is_active=True, archived_at__isnull=True, show_in_nav=True).select_related("image").order_by("sort_order", "name")
    attr_keys = effective_attribute_keys(cat)
    defs = {d.key: d for d in AttributeDefinition.objects.filter(key__in=attr_keys, filterable=True)}
    chart = effective_size_chart(cat)
    nm = (lambda c: c.name_sw if locale == "sw" and c.name_sw else c.name)
    return {
        **_public_node(cat, locale),
        "description": (cat.description_sw if locale == "sw" and cat.description_sw else cat.description) or None,
        "breadcrumbs": [{"id": str(c.id), "slug": c.slug, "name": nm(c)} for c in chain],
        "children": [_public_node(c, locale) for c in children],
        "filters": [{"key": k, "label": (defs[k].label_sw if locale == "sw" and defs[k].label_sw else defs[k].label), "type": defs[k].type,
                     "options": [{"value": o["value"], "label": o.get("labelSw") if locale == "sw" and o.get("labelSw") else o["label"], "hex": o.get("hex")} for o in defs[k].options]}
                    for k in attr_keys if k in defs],
        "sizeChartId": str(chart.id) if chart else None,
        "seo": {"title": cat.seo_title or f"{nm(cat)} — SmartWear", "description": cat.seo_description or (cat.description[:155] if cat.description else None)},
    }
