from __future__ import annotations

import pytest

from catalog.models import Brand, Category, Product, ProductVersion
from catalog.services import categories as cat_svc
from catalog.services.products import upsert_product
from conftest import admin_client, make_admin, user_client
from core.exceptions import ApiError
from inventory.models import Store
from media.models import Media

pytestmark = pytest.mark.django_db


def ready_image(n: int | None = None) -> Media:
    import uuid

    n = n if n is not None else uuid.uuid4().hex[:8]
    return Media.objects.create(type="IMAGE", status="READY", purpose="product", original_key=f"media/test/{n}.jpg", content_type="image/jpeg", width=1600, height=2000,
                                variants=[{"width": 640, "height": 800, "format": "jpeg", "key": f"media/test/{n}-640.jpg", "bytes": 40000, "label": "w640"}])


def store() -> Store:
    from django.contrib.gis.geos import Point

    return Store.objects.get_or_create(code="masaki", defaults={"name": "SmartWear Masaki", "address": "Haile Selassie Rd", "location": Point(39.2789, -6.7486, srid=4326)})[0]


def dress_payload(**over):
    cat = Category.objects.get(slug="women-maxi-dresses")
    brand = Brand.objects.get_or_create(name="Kanga House", defaults={"slug": "kanga-house"})[0]
    img = ready_image()
    s = store()
    data = {
        "title": "Zuri linen maxi dress", "titleSw": "Gauni refu la kitani Zuri", "brandId": str(brand.id), "categoryIds": [str(cat.id)],
        "tagline": "Breathable linen for Dar afternoons", "descriptionHtml": "<p>Cut from <strong>pure linen</strong>.</p><script>alert(1)</script>",
        "attributes": {"neckline": "v-neck", "occasion": ["everyday", "vacation"], "material": ["linen"]},
        "optionTypes": [
            {"name": "Colour", "kind": "color", "values": [{"value": "Ivory", "swatchHex": "#f3ede2"}, {"value": "Terracotta", "swatchHex": "#B5583A"}]},
            {"name": "Size", "kind": "size", "values": [{"value": "S"}, {"value": "M"}]},
        ],
        "variants": [
            {"sku": f"ZURI-{c[:3].upper()}-{sz}", "optionValues": [{"type": "Colour", "value": c}, {"type": "Size", "value": sz}], "retailPrice": 85000,
             "compareAtPrice": None, "wholesaleTiers": [{"minQty": 6, "unitPrice": 72000}, {"minQty": 24, "unitPrice": 64000}], "stock": [{"storeId": str(s.id), "quantity": 5}]}
            for c in ("Ivory", "Terracotta") for sz in ("S", "M")
        ],
        "media": [{"mediaId": str(img.id), "sortOrder": 0, "role": "gallery", "alt": "Model in an ivory linen maxi dress", "optionValue": {"type": "Colour", "value": "Ivory"}}],
        "status": "PUBLISHED",
    }
    data.update(over)
    return data


def test_create_full_product(admin_user):
    p = upsert_product(dress_payload(), admin=admin_user)
    assert p.slug == "zuri-linen-maxi-dress"
    assert p.variants.count() == 4 and p.option_types.count() == 2
    assert "<script>" not in p.description_html and "<strong>pure linen</strong>" in p.description_html
    p.refresh_from_db()
    assert (p.min_price, p.max_price, p.min_bulk_price, p.in_stock) == (85000, 85000, 64000, True)
    assert "kanga house" in p.search_text.lower() and "dresses" in p.search_text.lower()
    assert ProductVersion.objects.filter(product=p, version=1).exists()


def test_attribute_must_apply_to_category(admin_user):
    with pytest.raises(ApiError) as e:
        upsert_product(dress_payload(attributes={"heel_height": "high"}), admin=admin_user)
    assert "heel_height" in e.value.details["attributes"]
    with pytest.raises(ApiError):
        upsert_product(dress_payload(attributes={"neckline": "turtle"}), admin=admin_user)


def test_root_only_category_rejected(admin_user):
    with pytest.raises(ApiError) as e:
        upsert_product(dress_payload(categoryIds=[str(Category.objects.get(slug="women").id)]), admin=admin_user)
    assert "specific category" in e.value.message


def test_archived_category_rejected(admin_user):
    midi = Category.objects.get(slug="women-midi-dresses")
    cat_svc.archive(midi, admin=admin_user)
    with pytest.raises(ApiError):
        upsert_product(dress_payload(categoryIds=[str(midi.id)]), admin=admin_user)


def test_fake_discount_and_bad_tiers_rejected(admin_user):
    data = dress_payload()
    data["variants"][0]["compareAtPrice"] = 80000
    with pytest.raises(ApiError) as e:
        upsert_product(data, admin=admin_user)
    assert "real discounts" in e.value.message
    data = dress_payload()
    data["variants"][0]["wholesaleTiers"] = [{"minQty": 6, "unitPrice": 72000}, {"minQty": 24, "unitPrice": 75000}]
    with pytest.raises(ApiError):
        upsert_product(data, admin=admin_user)


def test_shades_only_for_beauty(admin_user):
    data = dress_payload(optionTypes=[{"name": "Shade", "kind": "shade", "values": [{"value": "Mocha"}]}])
    data["variants"] = [{"sku": "X-1", "optionValues": [{"type": "Shade", "value": "Mocha"}], "retailPrice": 1000}]
    data["media"][0].pop("optionValue")
    with pytest.raises(ApiError) as e:
        upsert_product(data, admin=admin_user)
    assert "beauty" in e.value.message.lower()


def test_beauty_product_with_shades(admin_user):
    cat = Category.objects.get(slug="makeup-face")
    img = ready_image(9)
    p = upsert_product({
        "title": "Silk skin foundation", "categoryIds": [str(cat.id)], "attributes": {"finish": "satin", "coverage": "medium"},
        "beauty": {"skinTypes": ["oily", "combination"], "finish": "satin", "volume": "30ml", "paoMonths": 12, "crueltyFree": True, "vegan": False},
        "optionTypes": [{"name": "Shade", "kind": "shade", "values": [{"value": "Mocha", "swatchHex": "#8A5A3C"}, {"value": "Espresso", "swatchHex": "#4B2E1F"}]}],
        "variants": [{"sku": f"SILK-{s}", "optionValues": [{"type": "Shade", "value": s}], "retailPrice": 42000, "shadeHex": h} for s, h in (("Mocha", "#8A5A3C"), ("Espresso", "#4B2E1F"))],
        "media": [{"mediaId": str(img.id), "sortOrder": 0}], "status": "PUBLISHED",
    }, admin=admin_user)
    assert p.is_beauty and p.beauty["crueltyFree"] is True


def test_catalog_editor_cannot_publish_without_permission():
    from accounts.models import Role

    support_like = make_admin("CATALOG_EDITOR", "editor2@smartwear.test")
    role = Role.objects.create(key="DRAFTER", name="Drafter", permissions=["products.view", "products.manage"])
    support_like.role = role
    support_like.save()
    with pytest.raises(ApiError) as e:
        upsert_product(dress_payload(), admin=support_like)
    assert e.value.status_code == 403
    assert upsert_product(dress_payload(status="DRAFT"), admin=support_like).status == "DRAFT"


def test_publish_requires_ready_image(admin_user):
    data = dress_payload()
    data["media"] = []
    with pytest.raises(ApiError) as e:
        upsert_product(data, admin=admin_user)
    assert "processed image" in str(e.value.details)


def test_versions_and_revert(admin_user):
    from catalog.services.products import revert_to_version

    p = upsert_product(dress_payload(), admin=admin_user)
    data = dress_payload(title="Zuri dress — new name")
    data["variants"] = data["variants"][:2]
    data["optionTypes"][0]["values"] = data["optionTypes"][0]["values"][:1]
    p = upsert_product(data, admin=admin_user, product=p)
    assert p.version == 2 and p.variants.filter(is_active=True).count() == 2
    p = revert_to_version(p, 1, admin=admin_user)
    p.refresh_from_db()
    assert p.title == "Zuri linen maxi dress" and p.variants.filter(is_active=True).count() == 4 and p.version == 3


def test_listing_filters_facets_and_typo_search(api, admin_user):
    upsert_product(dress_payload(), admin=admin_user)
    cat_svc.refresh_counts()
    r = api.get("/v1/products", {"category": "women-dresses", "facets": "1"})
    body = r.json()
    assert r.status_code == 200 and len(body["items"]) == 1
    card = body["items"][0]
    assert card["price"]["retail"] == 85000 and card["price"]["fromBulk"] is None  # approved_only by default
    assert {s["hex"] for s in card["swatches"]} == {"#F3EDE2", "#B5583A"}
    keys = {f["key"] for f in body["facets"]}
    assert {"sizes", "colors", "brand", "attr.neckline"} <= keys
    assert api.get("/v1/products", {"category": "men"}).json()["items"] == []
    assert len(api.get("/v1/products", {"sizes": "M", "colors": "Ivory"}).json()["items"]) == 1
    assert api.get("/v1/products", {"attr.neckline": "square"}).json()["items"] == []
    assert len(api.get("/v1/products", {"q": "linen maxi"}).json()["items"]) == 1
    fuzzy = api.get("/v1/products", {"q": "linnen dres"}).json()
    assert len(fuzzy["items"]) == 1 and fuzzy["fuzzy"] is True
    assert len(api.get("/v1/products", {"q": "gauni"}).json()["items"]) == 1  # Swahili title + category names
    s = api.get("/v1/search/suggest", {"q": "dress"}).json()
    assert s["products"] and any(c["slug"] == "women-dresses" for c in s["categories"])


def test_wholesale_customer_sees_tiers(api, admin_user, customer):
    p = upsert_product(dress_payload(), admin=admin_user)
    customer.customer_type, customer.wholesale_approved = "WHOLESALE", True
    customer.save()
    d = user_client(customer).get(f"/v1/products/{p.slug}").json()
    price = d["variants"][0]["price"]
    assert price["showWholesale"] is True and price["yourPrice"] == 85000 and price["fromBulk"] == 64000
    assert [t["label"] for t in price["tiers"]] == ["1–5", "6–23", "24+"]
    retail = api.get(f"/v1/products/{p.slug}").json()["variants"][0]["price"]
    assert retail["tiers"] == [] and retail["showWholesale"] is False


def test_detail_payload(api, admin_user):
    p = upsert_product(dress_payload(), admin=admin_user)
    d = api.get(f"/v1/products/{p.slug}").json()
    assert d["attributes"]["Neckline"] == "V-neck" and d["attributes"]["Occasion"] == "Everyday, Vacation"
    assert [c["slug"] for c in d["categoryPath"]][-1] == "women-maxi-dresses"
    assert d["sizeChart"]["name"].startswith("Women")
    assert d["media"][0]["optionValueId"]
    sw = api.get(f"/v1/products/{p.slug}", HTTP_ACCEPT_LANGUAGE="sw").json()
    assert sw["title"] == "Gauni refu la kitani Zuri"


def test_admin_product_endpoints(admin_user):
    c = admin_client(admin_user)
    r = c.post("/v1/admin/products", dress_payload(status="DRAFT"), format="json")
    assert r.status_code == 201, r.json()
    pid = r.json()["id"]
    got = c.get(f"/v1/admin/products/{pid}").json()
    assert any(h["code"] == "missing_description" for h in got["qualityHints"]) is False
    stale = dict(got, version=99)
    assert c.put(f"/v1/admin/products/{pid}", stale, format="json").status_code == 409
    assert c.post(f"/v1/admin/products/{pid}/duplicate", {}, format="json").status_code == 201
    lst = c.get("/v1/admin/products", {"q": "ZURI-IVO"}).json()
    assert len(lst["items"]) == 2
    prev = c.get(f"/v1/admin/products/{pid}/preview").json()
    assert prev["wholesale"]["card"]["price"]["fromBulk"] == 64000
    csv = c.get("/v1/admin/products/export")
    assert csv.status_code == 200 and b"ZURI-IVO-S" in csv.content
    bulk = c.post("/v1/admin/products/bulk-price", {"productIds": [pid], "percent": 10, "rounding": "nearest_1000"}, format="json").json()
    assert bulk["variantsUpdated"] == 4
    assert Product.objects.get(id=pid).min_price == 94000


def test_editor_roundtrip_with_placeholder_option_ids(admin_user):
    """The admin editor sends new option values with client ids ("new:…") that variants and media reference."""
    p = upsert_product(dress_payload(), admin=admin_user)
    from catalog.services.products import admin_product_out

    data = admin_product_out(p)
    colour = next(o for o in data["optionTypes"] if o["kind"] == "color")
    colour["values"].append({"id": "new:k1", "value": "Sage", "swatchHex": "#9CAF88"})
    size_ids = [v["id"] for v in next(o for o in data["optionTypes"] if o["kind"] == "size")["values"]]
    data["variants"].append({"sku": "ZURI-SAG-S", "optionValueIds": ["new:k1", size_ids[0]], "retailPrice": 85000, "wholesaleTiers": [], "stock": []})
    data["media"][0]["optionValueId"] = "new:k1"
    p = upsert_product(data, admin=admin_user, product=p)
    sage = p.option_types.get(kind="color").values.get(value="Sage")
    assert p.variants.get(sku="ZURI-SAG-S").option_values.filter(id=sage.id).exists()
    assert p.media_links.get().option_value_id == sage.id
    # Saving the same payload again (autosave keeps the placeholder ids) must not duplicate anything.
    p = upsert_product(data, admin=admin_user, product=Product.objects.get(id=p.id))
    assert p.option_types.get(kind="color").values.filter(value="Sage").count() == 1 and p.variants.count() == 5


def test_admin_products_filter_by_ids(admin_user):
    a = upsert_product(dress_payload(), admin=admin_user)
    b = upsert_product(dress_payload(title="Second dress", variants=[{"sku": "SECOND-1", "retailPrice": 50000, "stock": []}], optionTypes=[], media=[{"mediaId": str(ready_image().id), "role": "gallery", "alt": "x"}]), admin=admin_user)
    c = admin_client(admin_user)
    r = c.get("/v1/admin/products", {"ids": f"{b.id}"})
    assert r.status_code == 200 and [i["id"] for i in r.json()["items"]] == [str(b.id)]
    assert {i["id"] for i in c.get("/v1/admin/products", {"ids": f"{a.id},{b.id}"}).json()["items"]} == {str(a.id), str(b.id)}
