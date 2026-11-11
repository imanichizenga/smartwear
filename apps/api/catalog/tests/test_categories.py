"""Controlled taxonomy: roots are fixed to fashion & beauty, the tree stays consistent under every edit."""
from __future__ import annotations

import pytest

from catalog.models import Category, Product, ProductCategory
from catalog.services import categories as svc
from catalog.taxonomy import CORE_ROOT_KEYS, MAX_DEPTH, ROOTS
from conftest import admin_client, make_admin
from core.exceptions import ApiError

pytestmark = pytest.mark.django_db


def cat(slug: str) -> Category:
    return Category.objects.get(slug=slug)


def test_seed_has_exactly_the_core_fashion_beauty_roots():
    roots = set(Category.objects.filter(parent__isnull=True).values_list("root_key", flat=True))
    assert roots == set(CORE_ROOT_KEYS)
    assert cat("beauty").kind == "beauty" and cat("women").kind == "fashion"
    beauty_groups = set(cat("beauty").children.values_list("slug", flat=True))
    assert {"beauty-makeup", "beauty-skincare", "beauty-haircare", "beauty-fragrance", "beauty-nails", "beauty-tools"} <= beauty_groups


def test_paths_and_depths_are_consistent():
    for c in Category.objects.select_related("parent"):
        if c.parent is None:
            assert c.depth == 0 and c.path == c.slug
        else:
            assert c.depth == c.parent.depth + 1
            assert c.path == f"{c.parent.path}/{c.slug}"
            assert c.root_key == c.parent.root_key
            assert c.kind == c.parent.kind
        assert c.depth <= MAX_DEPTH


def test_cannot_create_free_text_root(admin_user):
    with pytest.raises(ApiError) as e:
        svc.create({"name": "Electronics"}, admin=admin_user)
    assert "fashion and beauty" in e.value.message


def test_unknown_root_key_rejected_even_for_super_admin(admin_user):
    with pytest.raises(ApiError) as e:
        svc.enable_root("electronics", admin=admin_user)
    assert e.value.status_code == 400


def test_only_super_admin_enables_optional_roots(admin_user):
    editor = make_admin("CATALOG_EDITOR")
    with pytest.raises(ApiError) as e:
        svc.enable_root("african-fashion", admin=editor)
    assert e.value.status_code == 403
    root = svc.enable_root("african-fashion", admin=admin_user)
    assert root.parent is None and root.kind == "fashion"
    assert svc.enable_root("african-fashion", admin=admin_user).id == root.id  # idempotent


def test_editor_can_add_subcategory_with_inherited_rules():
    editor = make_admin("CATALOG_EDITOR")
    dresses = cat("women-dresses")
    c = svc.create({"parentId": str(dresses.id), "name": "Wrap dresses", "nameSw": "Magauni ya kufunga"}, admin=editor)
    assert c.depth == 3 and c.root_key == "women" and c.path.startswith("women/women-clothing/women-dresses/")
    keys = svc.effective_attribute_keys(c)
    assert "occasion" in keys and "neckline" in keys  # from Clothing and Dresses
    assert svc.effective_size_chart(c).key == "women-apparel"


def test_depth_limit():
    editor = make_admin("CATALOG_EDITOR")
    leaf = cat("women-maxi-dresses")  # depth 3
    with pytest.raises(ApiError) as e:
        svc.create({"parentId": str(leaf.id), "name": "Too deep"}, admin=editor)
    assert "levels deep" in e.value.message


def test_duplicate_sibling_name_rejected_case_insensitively():
    editor = make_admin("CATALOG_EDITOR")
    with pytest.raises(ApiError) as e:
        svc.create({"parentId": str(cat("women-clothing").id), "name": "dresses"}, admin=editor)
    assert e.value.code == "duplicate_name"


def test_move_rewrites_whole_subtree_and_blocks_cycles():
    editor = make_admin("CATALOG_EDITOR")
    clothing = cat("women-clothing")
    group = svc.create({"parentId": str(clothing.id), "name": "Occasion"}, admin=editor)
    dresses = cat("women-dresses")
    with pytest.raises(ApiError):
        svc.move(cat("women-clothing"), str(cat("women-maxi-dresses").id), admin=editor)  # into own descendant
    with pytest.raises(ApiError):
        svc.move(dresses, str(group.id), admin=editor)  # would exceed depth (dresses has children)
    lingerie = cat("women-lingerie-nightwear")
    moved = svc.move(lingerie, str(group.id), admin=editor)
    assert moved.path == f"{group.path}/{lingerie.slug}" and moved.depth == 3


def test_move_between_roots_updates_root_key_and_kind():
    editor = make_admin("CATALOG_EDITOR")
    belts = cat("accessories-belts")
    moved = svc.move(belts, str(cat("bags").id), admin=editor)
    assert moved.root_key == "bags" and moved.path == "bags/accessories-belts"


def test_roots_cannot_move_and_subcategories_cannot_become_roots(admin_user):
    with pytest.raises(ApiError):
        svc.move(cat("women"), str(cat("men").id), admin=admin_user)
    with pytest.raises(ApiError):
        svc.move(cat("women-dresses"), None, admin=admin_user)


def test_reorder_requires_complete_sibling_list():
    editor = make_admin("CATALOG_EDITOR")
    clothing = cat("women-clothing")
    ids = [str(i) for i in clothing.children.order_by("sort_order").values_list("id", flat=True)]
    with pytest.raises(ApiError):
        svc.reorder(str(clothing.id), ids[:-1], admin=editor)
    svc.reorder(str(clothing.id), list(reversed(ids)), admin=editor)
    assert [str(i) for i in clothing.children.order_by("sort_order").values_list("id", flat=True)] == list(reversed(ids))
    with pytest.raises(ApiError) as e:
        roots = [str(i) for i in Category.objects.filter(parent__isnull=True).values_list("id", flat=True)]
        svc.reorder(None, roots, admin=editor)
    assert e.value.status_code == 403


def _product_in(category: Category) -> Product:
    p = Product.objects.create(title="Linen shirt dress", slug="linen-shirt-dress", primary_category=category, status="PUBLISHED")
    ProductCategory.objects.create(product=p, category=category, is_primary=True)
    return p


def test_delete_blocked_with_products_but_archive_reassigns():
    editor = make_admin("CATALOG_EDITOR")
    midi = cat("women-midi-dresses")
    p = _product_in(midi)
    with pytest.raises(ApiError) as e:
        svc.delete(midi, admin=editor)
    assert e.value.code == "has_products"
    result = svc.archive(midi, admin=editor, reassign_to_id=str(cat("women-maxi-dresses").id))
    assert result == {"archived": 1, "productsReassigned": 1}
    p.refresh_from_db()
    assert p.primary_category.slug == "women-maxi-dresses"
    assert ProductCategory.objects.get(product=p, is_primary=True).category.slug == "women-maxi-dresses"
    assert cat("women-midi-dresses").archived_at is not None
    with pytest.raises(ApiError):
        svc.create({"parentId": str(midi.id), "name": "x"}, admin=editor)


def test_subtree_product_counts():
    _product_in(cat("women-maxi-dresses"))
    svc.refresh_counts()
    assert cat("women-maxi-dresses").product_count == 1
    assert cat("women-dresses").product_count == 1
    assert cat("women").product_count == 1
    assert cat("men").product_count == 0


def test_public_tree_is_cached_and_invalidated(api):
    r = api.get("/v1/categories")
    assert r.status_code == 200
    names = [n["name"] for n in r.json()["items"]]
    assert names[:2] == ["Women", "Men"]
    v1 = r.json()["version"]
    editor = make_admin("CATALOG_EDITOR")
    from django.db import transaction

    with transaction.atomic():
        svc.create({"parentId": str(cat("bags").id), "name": "Bucket bags"}, admin=editor)
    svc.bump_version()
    r2 = api.get("/v1/categories")
    assert r2.json()["version"] > v1
    bags = next(n for n in r2.json()["items"] if n["slug"] == "bags")
    assert "Bucket bags" in [c["name"] for c in bags["children"]]


def test_swahili_names(api):
    r = api.get("/v1/categories", HTTP_ACCEPT_LANGUAGE="sw")
    assert r.json()["items"][0]["name"] == "Wanawake"


def test_category_detail_has_breadcrumbs_and_filters(api):
    r = api.get("/v1/categories/women-maxi-dresses")
    d = r.json()
    assert [b["slug"] for b in d["breadcrumbs"]] == ["women", "women-clothing", "women-dresses", "women-maxi-dresses"]
    keys = [f["key"] for f in d["filters"]]
    assert "neckline" in keys and "occasion" in keys
    assert d["sizeChartId"]


def test_admin_api_permissions(admin_user):
    support = admin_client(make_admin("SUPPORT"))
    assert support.post("/v1/admin/categories", {"parentId": str(cat("bags").id), "name": "Hobo bags"}, format="json").status_code == 403
    editor = admin_client(make_admin("CATALOG_EDITOR"))
    r = editor.post("/v1/admin/categories", {"parentId": str(cat("bags").id), "name": "Hobo bags", "icon": "shopping-bag"}, format="json")
    assert r.status_code == 201, r.json()
    assert editor.post("/v1/admin/categories", {"name": "Groceries"}, format="json").status_code == 400
    assert editor.post("/v1/admin/categories/roots/bridal", {}, format="json").status_code == 403
    sup = admin_client(admin_user)
    assert sup.post("/v1/admin/categories/roots/bridal", {}, format="json").status_code == 201
    tree = sup.get("/v1/admin/categories").json()
    bridal = next(r for r in tree["roots"] if r["key"] == "bridal")
    assert bridal["enabled"] is True
    assert any(n["slug"] == "bridal" and n["children"] for n in tree["items"])


def test_icon_must_come_from_the_icon_set():
    editor = make_admin("CATALOG_EDITOR")
    with pytest.raises(ApiError):
        svc.create({"parentId": str(cat("bags").id), "name": "Satchels", "icon": "rocket"}, admin=editor)


def test_unknown_attribute_keys_rejected():
    editor = make_admin("CATALOG_EDITOR")
    with pytest.raises(ApiError):
        svc.create({"parentId": str(cat("bags").id), "name": "Satchels", "attributeKeys": ["megapixels"]}, admin=editor)


def test_every_registered_root_is_fashion_or_beauty():
    assert all(r.kind in ("fashion", "beauty") for r in ROOTS)
