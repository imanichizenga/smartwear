"""Cart: the server prices every line (tiers, price lists, rounding) — the app only renders the result."""
from __future__ import annotations

from typing import Any

from django.db import transaction
from django.db.models import Prefetch
from django.utils import timezone

from catalog.models import ProductMedia, ProductVariant
from catalog.pricing import CartLine, PromoRule, evaluate_promo, price_cart
from catalog.services.products import stock_by_variant, variant_pricing
from catalog.services.viewer import context_for_user
from core.exceptions import ApiError
from core.media_urls import media_out

from ..models import Cart, CartItem, PromoCode, PromoRedemption

MAX_LINES = 60
MAX_QTY = 999


def get_cart(user) -> Cart:
    cart, _ = Cart.objects.get_or_create(user=user)
    return cart


def _variant_qs():
    return ProductVariant.objects.select_related("product__brand").prefetch_related(
        "tiers", "option_values__option_type",
        Prefetch("product__media_links", queryset=ProductMedia.objects.filter(media__type="IMAGE", media__status="READY").select_related("media", "option_value").order_by("sort_order")),
        "media",
    )


def _image_for(v: ProductVariant):
    links = list(v.product.media_links.all())
    ov_ids = {o.id for o in v.option_values.all()}
    for l in links:
        if l.option_value_id and l.option_value_id in ov_ids:
            return l.media
    vm = [m for m in v.media.all() if m.type == "IMAGE" and m.status == "READY"]
    if vm:
        return vm[0]
    return links[0].media if links else None


def options_label(v: ProductVariant) -> str:
    return " · ".join(o.label or o.value for o in sorted(v.option_values.all(), key=lambda o: (o.option_type.sort_order, o.option_type_id)))


@transaction.atomic
def add_item(user, variant_id, qty: int = 1) -> Cart:
    if qty < 1 or qty > MAX_QTY:
        raise ApiError.bad_request("Quantity must be between 1 and 999")
    v = ProductVariant.objects.select_related("product").filter(id=variant_id, is_active=True, product__status="PUBLISHED", product__deleted_at__isnull=True).first()
    if v is None:
        raise ApiError.not_found("Item")
    cart = get_cart(user)
    item = CartItem.objects.select_for_update().filter(cart=cart, variant=v, saved_for_later=False).first()
    if item is None:
        if cart.items.count() >= MAX_LINES:
            raise ApiError.bad_request("Your bag is full — check out or save some items for later")
        CartItem.objects.filter(cart=cart, variant=v, saved_for_later=True).delete()
        CartItem.objects.create(cart=cart, variant=v, qty=qty)
    else:
        item.qty = min(MAX_QTY, item.qty + qty)
        item.save(update_fields=["qty", "updated_at"])
    cart.save(update_fields=["updated_at"])
    return cart


@transaction.atomic
def update_item(user, item_id: int, *, qty: int | None = None, saved_for_later: bool | None = None, variant_id=None) -> Cart:
    cart = get_cart(user)
    item = CartItem.objects.select_for_update().filter(cart=cart, id=item_id).first()
    if item is None:
        raise ApiError.not_found("Bag item")
    if variant_id and str(variant_id) != str(item.variant_id):
        nv = ProductVariant.objects.filter(id=variant_id, product_id=item.variant.product_id, is_active=True).first()
        if nv is None:
            raise ApiError.bad_request("That option isn't available")
        clash = CartItem.objects.filter(cart=cart, variant=nv, saved_for_later=item.saved_for_later).exclude(id=item.id).first()
        if clash:
            clash.qty = min(MAX_QTY, clash.qty + item.qty)
            clash.save(update_fields=["qty"])
            item.delete()
            return cart
        item.variant = nv
    if qty is not None:
        if qty < 1 or qty > MAX_QTY:
            raise ApiError.bad_request("Quantity must be between 1 and 999")
        item.qty = qty
    if saved_for_later is not None and saved_for_later != item.saved_for_later:
        CartItem.objects.filter(cart=cart, variant=item.variant, saved_for_later=saved_for_later).exclude(id=item.id).delete()
        item.saved_for_later = saved_for_later
    item.save()
    return cart


def remove_item(user, item_id: int) -> Cart:
    cart = get_cart(user)
    if not CartItem.objects.filter(cart=cart, id=item_id).delete()[0]:
        raise ApiError.not_found("Bag item")
    return cart


def merge_guest_lines(user, lines: list[dict]) -> Cart:
    """Guest bag (kept on the device) merges into the account bag at sign-in."""
    cart = get_cart(user)
    for ln in lines[:MAX_LINES]:
        try:
            add_item(user, ln["variantId"], max(1, min(MAX_QTY, int(ln.get("qty", 1)))))
        except ApiError:
            continue
    return cart


def find_promo(code: str) -> PromoCode | None:
    return PromoCode.objects.filter(code__iexact=(code or "").strip()).first()


def evaluate_code(user, code: str, subtotal: int, delivery_fee: int, category_subtotal: int | None = None) -> tuple[PromoCode | None, dict]:
    promo = find_promo(code)
    if promo is None:
        return None, {"ok": False, "reason": "not_found"}
    if promo.first_order_only and user.orders.exclude(status__in=["CANCELLED", "FAILED"]).exists():
        return promo, {"ok": False, "reason": "first_order_only"}
    rule = PromoRule(
        code=promo.code, type=promo.type, value=promo.value, min_subtotal=promo.min_subtotal, max_discount=promo.max_discount, starts_at=promo.starts_at, ends_at=promo.ends_at,
        usage_limit=promo.usage_limit, used_count=promo.used_count, per_customer_limit=promo.per_customer_limit,
        customer_uses=PromoRedemption.objects.filter(promo=promo, user=user).count(), customer_types=promo.customer_types or None, active=promo.active,
    )
    basis = category_subtotal if promo.category_ids and category_subtotal is not None else subtotal
    return promo, evaluate_promo(rule, basis, delivery_fee, user.customer_type, timezone.now())


PROMO_MESSAGES = {
    "not_found": "That code doesn't exist", "inactive": "That code is no longer active", "expired": "That code has expired", "not_started": "That code isn't active yet",
    "min_subtotal": "Spend a little more to use this code", "usage_limit": "That code has been fully used", "customer_limit": "You've already used this code",
    "customer_type": "This code isn't available for your account type", "first_order_only": "This code is for your first order",
}


def _category_subtotal(promo: PromoCode, priced: list[dict], variants: dict) -> int:
    from catalog.models import Category, ProductCategory

    paths = list(Category.objects.filter(id__in=promo.category_ids).values_list("path", flat=True))
    total = 0
    for line in priced:
        v = variants[line["variantId"]]
        cpaths = ProductCategory.objects.filter(product_id=v.product_id).values_list("category__path", flat=True)
        if any(cp == p or cp.startswith(p + "/") for cp in cpaths for p in paths):
            total += line["lineTotal"]
    return total


def price_for_user(user, *, delivery_fee: int = 0, promo_code: str | None = None, items: list[CartItem] | None = None, locale: str = "en") -> dict[str, Any]:
    cart = get_cart(user)
    items = items if items is not None else list(cart.items.select_related("variant").order_by("-added_at"))
    active = [i for i in items if not i.saved_for_later]
    later = [i for i in items if i.saved_for_later]
    vids = [i.variant_id for i in items]
    variants = {str(v.id): v for v in _variant_qs().filter(id__in=vids)}
    ctx = context_for_user(user, vids)
    stock = stock_by_variant(vids)
    lines = [CartLine(str(i.id), str(i.variant_id), i.qty, variant_pricing(variants[str(i.variant_id)])) for i in active if str(i.variant_id) in variants]
    code = promo_code if promo_code is not None else cart.promo_code
    priced0 = price_cart(lines, ctx, delivery_fee=delivery_fee)
    promo_info = None
    discount = 0
    free_delivery = False
    if code:
        promo, res = evaluate_code(user, code, priced0.subtotal, delivery_fee)
        if promo and promo.category_ids and res.get("ok"):
            cat_sub = _category_subtotal(promo, priced0.lines, variants)
            promo, res = evaluate_code(user, code, priced0.subtotal, delivery_fee, cat_sub)
        if res.get("ok"):
            discount = res["discount"]
            free_delivery = res["freeDelivery"]
            promo_info = {"code": promo.code, "ok": True, "discount": discount, "freeDelivery": free_delivery, "description": promo.description or None}
        else:
            promo_info = {"code": code, "ok": False, "reason": res["reason"], "message": PROMO_MESSAGES.get(res["reason"], "Code can't be applied")}
    totals = price_cart(lines, ctx, delivery_fee=0 if free_delivery else delivery_fee, discount=discount)
    by_line = {l["lineId"]: l for l in totals.lines}

    def render(i: CartItem, saved: bool) -> dict[str, Any] | None:
        v = variants.get(str(i.variant_id))
        if v is None:
            return None
        p = v.product
        pr = by_line.get(str(i.id))
        img = _image_for(v)
        available = stock.get(v.id, 0)
        purchasable = v.is_active and p.status == "PUBLISHED" and p.deleted_at is None
        return {
            "id": i.id, "variantId": str(v.id), "productId": str(p.id), "slug": p.slug, "title": p.title_sw if locale == "sw" and p.title_sw else p.title,
            "brand": p.brand.name if p.brand_id else None, "options": options_label(v), "sku": v.sku, "image": media_out(img) if img else None, "qty": i.qty,
            "retailUnitPrice": v.retail_price, "unitPrice": pr["unitPrice"] if pr else v.retail_price, "basis": pr["basis"] if pr else "retail",
            "tier": pr["tier"] if pr else None, "lineTotal": pr["lineTotal"] if pr else v.retail_price * i.qty, "savings": pr["savings"] if pr else 0,
            "nextTier": pr["nextTier"] if pr else None, "moqViolation": pr["moqViolation"] if pr else False, "moq": v.wholesale_moq if ctx.is_wholesale else None,
            "available": available, "inStock": available >= i.qty and purchasable, "purchasable": purchasable, "savedForLater": saved,
        }

    rows = [r for r in (render(i, False) for i in active) if r]
    problems = [{"itemId": r["id"], "reason": "out_of_stock" if r["available"] < r["qty"] else "unavailable", "available": r["available"]} for r in rows if not r["inStock"]]
    problems += [{"itemId": r["id"], "reason": "below_moq", "moq": r["moq"]} for r in rows if r["moqViolation"]]
    return {
        "currency": totals.currency, "items": rows, "savedForLater": [r for r in (render(i, True) for i in later) if r],
        "subtotal": totals.subtotal, "discount": totals.discount, "deliveryFee": totals.delivery_fee, "tax": totals.tax, "taxInclusive": ctx.settings.tax_inclusive,
        "total": totals.total, "savings": totals.savings, "itemCount": sum(r["qty"] for r in rows), "promo": promo_info, "freeDelivery": free_delivery,
        "problems": problems, "isWholesale": ctx.is_wholesale,
    }
