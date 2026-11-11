"""Stock is only ever changed here, always with a StockMovement row (who, why, how much)."""
from __future__ import annotations

from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from core.audit import audit
from core.exceptions import ApiError

from .models import InventoryLevel, StockMovement, StockTransfer, Store


def _level(store: Store, variant, lock: bool = True) -> InventoryLevel:
    qs = InventoryLevel.objects.select_for_update() if lock else InventoryLevel.objects
    lvl = qs.filter(store=store, variant=variant).first()
    if lvl is None:
        lvl, _ = InventoryLevel.objects.get_or_create(store=store, variant=variant)
        if lock:
            lvl = InventoryLevel.objects.select_for_update().get(pk=lvl.pk)
    return lvl


@transaction.atomic
def set_stock(store: Store, variant, quantity: int, *, low_threshold: int | None = None, admin=None, reason: str = "count", note: str = "") -> InventoryLevel:
    if quantity < 0:
        raise ApiError.bad_request("Stock can't be negative")
    lvl = _level(store, variant)
    if quantity < lvl.reserved:
        raise ApiError.conflict("below_reserved", f"{lvl.reserved} units are reserved for open orders at {store.name}")
    delta = quantity - lvl.on_hand
    lvl.on_hand = quantity
    if low_threshold is not None:
        lvl.low_stock_threshold = low_threshold
    lvl.save()
    if delta:
        StockMovement.objects.create(store=store, variant=variant, delta_on_hand=delta, reason=reason, note=note[:240], actor=admin)
    _touch_product(variant)
    return lvl


@transaction.atomic
def adjust(store: Store, variant, delta: int, *, reason: str, note: str = "", admin=None, request=None) -> InventoryLevel:
    if reason not in dict(StockMovement.REASONS):
        raise ApiError.bad_request("Unknown adjustment reason")
    if not note and reason in ("adjust", "damage"):
        raise ApiError.bad_request("Add a short note explaining the adjustment")
    lvl = _level(store, variant)
    if lvl.on_hand + delta < lvl.reserved:
        raise ApiError.conflict("insufficient_stock", f"Only {lvl.on_hand - lvl.reserved} unreserved units at {store.name}")
    lvl.on_hand += delta
    lvl.save(update_fields=["on_hand", "updated_at"])
    StockMovement.objects.create(store=store, variant=variant, delta_on_hand=delta, reason=reason, note=note[:240], actor=admin)
    audit("inventory.adjust", "variant", variant.id, request=request, admin=admin, meta={"store": store.code, "delta": delta, "reason": reason})
    _touch_product(variant)
    return lvl


def reserve_for_order(order, lines: list[tuple]) -> None:
    """lines: [(variant, qty)]. Locks rows and fails atomically if any line is short."""
    short = []
    for variant, qty in sorted(lines, key=lambda x: str(x[0].id)):  # stable lock order avoids deadlocks
        lvl = _level(order.store, variant)
        if lvl.on_hand - lvl.reserved < qty:
            short.append({"variantId": str(variant.id), "sku": variant.sku, "available": max(0, lvl.on_hand - lvl.reserved), "requested": qty})
            continue
        lvl.reserved += qty
        lvl.save(update_fields=["reserved", "updated_at"])
        StockMovement.objects.create(store=order.store, variant=variant, delta_reserved=qty, reason="reserve", order=order)
    if short:
        raise ApiError.conflict("out_of_stock", "Some items just sold out", details={"lines": short})


def release_for_order(order) -> None:
    for item in order.items.select_related("variant"):
        if item.variant is None:
            continue
        lvl = _level(order.store, item.variant)
        give = min(item.qty, lvl.reserved)
        if give:
            lvl.reserved -= give
            lvl.save(update_fields=["reserved", "updated_at"])
            StockMovement.objects.create(store=order.store, variant=item.variant, delta_reserved=-give, reason="release", order=order)
        _touch_product(item.variant)


def commit_sale(order) -> None:
    """At pickup: reserved units leave the shelf."""
    for item in order.items.select_related("variant"):
        if item.variant is None:
            continue
        lvl = _level(order.store, item.variant)
        qty = min(item.qty, lvl.reserved)
        lvl.reserved -= qty
        lvl.on_hand -= qty
        lvl.save(update_fields=["reserved", "on_hand", "updated_at"])
        StockMovement.objects.create(store=order.store, variant=item.variant, delta_on_hand=-qty, delta_reserved=-qty, reason="sale", order=order)
        _touch_product(item.variant)


def _touch_product(variant) -> None:
    from catalog.services.products import stock_by_variant
    from catalog.models import Product, ProductVariant

    ids = list(ProductVariant.objects.filter(product_id=variant.product_id, is_active=True).values_list("id", flat=True))
    in_stock = any(n > 0 for n in stock_by_variant(ids).values())
    Product.objects.filter(id=variant.product_id).exclude(in_stock=in_stock).update(in_stock=in_stock)


def nearest_store_with_stock(lat: float, lng: float, lines: list[tuple], *, pickup: bool = False) -> tuple[Store | None, float | None, list[Store]]:
    """Closest active store (by road-agnostic geodesic distance) that can fulfil every line."""
    point = Point(lng, lat, srid=4326)
    stores = list(
        Store.objects.filter(is_active=True, **({"allows_pickup": True} if pickup else {"fulfils_delivery": True}))
        .annotate(dist=Distance("location", point)).order_by("dist")
    )
    if not lines:
        return (stores[0], stores[0].dist.m, stores) if stores else (None, None, [])
    variant_ids = [v.id for v, _ in lines]
    avail: dict = {}
    for lvl in InventoryLevel.objects.filter(variant_id__in=variant_ids, store__in=stores).values("store_id", "variant_id").annotate(a=F("on_hand") - F("reserved")):
        avail[(lvl["store_id"], lvl["variant_id"])] = lvl["a"]
    for s in stores:
        if all(avail.get((s.id, v.id), 0) >= q for v, q in lines):
            return s, s.dist.m, stores
    return None, None, stores


@transaction.atomic
def ship_transfer(t: StockTransfer, *, admin=None) -> None:
    if t.status != "DRAFT":
        raise ApiError.conflict("bad_status", "Only draft transfers can be shipped")
    from catalog.models import ProductVariant

    for line in t.lines:
        v = ProductVariant.objects.get(id=line["variantId"])
        lvl = _level(t.from_store, v)
        if lvl.on_hand - lvl.reserved < line["qty"]:
            raise ApiError.conflict("insufficient_stock", f"{v.sku}: only {lvl.on_hand - lvl.reserved} available at {t.from_store.name}")
        lvl.on_hand -= line["qty"]
        lvl.save(update_fields=["on_hand", "updated_at"])
        StockMovement.objects.create(store=t.from_store, variant=v, delta_on_hand=-line["qty"], reason="transfer_out", transfer=t, actor=admin)
        _touch_product(v)
    t.status, t.shipped_at = "IN_TRANSIT", timezone.now()
    t.save(update_fields=["status", "shipped_at"])


@transaction.atomic
def receive_transfer(t: StockTransfer, *, admin=None) -> None:
    if t.status != "IN_TRANSIT":
        raise ApiError.conflict("bad_status", "Only shipped transfers can be received")
    from catalog.models import ProductVariant

    for line in t.lines:
        v = ProductVariant.objects.get(id=line["variantId"])
        lvl = _level(t.to_store, v)
        lvl.on_hand += line["qty"]
        lvl.save(update_fields=["on_hand", "updated_at"])
        StockMovement.objects.create(store=t.to_store, variant=v, delta_on_hand=line["qty"], reason="transfer_in", transfer=t, actor=admin)
        _touch_product(v)
    t.status, t.received_at = "RECEIVED", timezone.now()
    t.save(update_fields=["status", "received_at"])
