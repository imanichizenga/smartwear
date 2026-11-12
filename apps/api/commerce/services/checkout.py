"""
Bolt-style checkout: no forms. Location from GPS/pin, contact from the profile, payment from the saved method.
`quote()` powers the checkout screen live; `place()` re-validates everything server-side and creates the order.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.contrib.gis.geos import Point
from django.db import transaction
from django.utils import timezone

from catalog.models import ProductVariant
from core import settings_service
from core.exceptions import ApiError
from core.integrations import google_maps
from delivery.fees import compute_fee, eta_window, match_zone
from inventory.services import nearest_store_with_stock, reserve_for_order

from ..models import CartItem, Order, OrderItem, Payment, PromoRedemption, SavedPaymentMethod, SavedPlace
from . import cart as cart_svc
from .orders import add_event, new_pin, next_order_number, transition


def _validate_point(lat, lng) -> tuple[float, float]:
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError) as e:
        raise ApiError.bad_request("Choose where to deliver", details={"field": "location"}) from e
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ApiError.bad_request("That location isn't valid", details={"field": "location"})
    return lat, lng


def _lines(user) -> list[tuple[ProductVariant, int]]:
    items = CartItem.objects.filter(cart__user=user, saved_for_later=False).select_related("variant")
    return [(i.variant, i.qty) for i in items]


def payment_methods(user) -> dict[str, Any]:
    cfg = settings_service.get("payments")
    available = []
    if cfg.cashOnDeliveryEnabled:
        available.append({"method": "CASH_ON_DELIVERY", "label": "Cash on delivery", "labelSw": "Lipa unapopokea", "maxAmount": cfg.cashOnDeliveryMaxAmount})
    if cfg.mobileMoneyProvider == "snippe" and cfg.snippeApiKey:
        available.append({"method": "MOBILE_MONEY", "label": "Mobile money", "labelSw": "Pesa kwa simu", "providers": ["mpesa", "airtel", "mixx", "halotel"], "flow": "ussd_push"})
    elif cfg.mobileMoneyProvider == "beem_checkout" and cfg.beemCheckoutApiKey:
        available.append({"method": "MOBILE_MONEY", "label": "Mobile money", "labelSw": "Pesa kwa simu", "providers": ["mpesa", "tigopesa", "airtelmoney", "halopesa"]})
    saved = [{"id": str(m.id), "method": m.method, "provider": m.provider or None, "label": m.label or None, "msisdn": m.msisdn[:6] + "•••" + m.msisdn[-3:] if m.msisdn else None, "isDefault": m.is_default} for m in SavedPaymentMethod.objects.filter(user=user)]
    allowed = {a["method"] for a in available}
    default = next((s for s in saved if s["isDefault"] and s["method"] in allowed), None)
    return {"available": available, "saved": saved, "default": default or ({"id": None, "method": available[0]["method"], "provider": None, "label": available[0]["label"], "isDefault": True} if available else None)}


def quote(user, *, lat, lng, option_id: str | None = None, promo_code: str | None = None, locale: str = "en") -> dict[str, Any]:
    lat, lng = _validate_point(lat, lng)
    lines = _lines(user)
    if not lines:
        raise ApiError.bad_request("Your bag is empty", details={"code": "empty_cart"})
    pricing_cfg = settings_service.get("delivery.pricing")
    checkout_cfg = settings_service.get("checkout")
    tz = settings_service.get("localization").timezone
    now = timezone.now()
    store, straight_m, _ = nearest_store_with_stock(lat, lng, lines)
    pickup_store, _, _ = nearest_store_with_stock(lat, lng, lines, pickup=True)
    priced0 = cart_svc.price_for_user(user, promo_code=promo_code, locale=locale)
    route = google_maps.route((store.location.y, store.location.x), (lat, lng)) if store else None
    zone = match_zone(lat, lng)
    options = []
    for opt in sorted([o for o in pricing_cfg.options if o.enabled], key=lambda o: o.sortOrder):
        if opt.kind == "pickup":
            if pickup_store is None:
                options.append({"id": opt.id, "name": opt.nameSw if locale == "sw" and opt.nameSw else opt.name, "kind": opt.kind, "available": False, "reason": "out_of_stock"})
                continue
            mn, mx = eta_window(opt, None, checkout_cfg.prepTimeMinutes)
            options.append({"id": opt.id, "name": opt.nameSw if locale == "sw" and opt.nameSw else opt.name, "kind": opt.kind, "description": opt.description, "available": True, "fee": 0, "etaMinMinutes": mn, "etaMaxMinutes": mx, "store": {"id": str(pickup_store.id), "name": pickup_store.name, "address": pickup_store.address}})
            continue
        if store is None:
            options.append({"id": opt.id, "name": opt.nameSw if locale == "sw" and opt.nameSw else opt.name, "kind": opt.kind, "available": False, "reason": "out_of_stock"})
            continue
        fee = compute_fee(pricing_cfg, distance_m=route["distanceMeters"], zone=zone, option=opt, subtotal=priced0["subtotal"] - priced0["discount"], at=now, tz=tz)
        mn, mx = eta_window(opt, route["durationSeconds"] / 60, checkout_cfg.prepTimeMinutes)
        options.append({"id": opt.id, "name": opt.nameSw if locale == "sw" and opt.nameSw else opt.name, "kind": opt.kind, "description": opt.description, "available": fee["serviceable"], "reason": fee.get("reason"), "fee": fee["fee"], "freeDelivery": fee["freeDelivery"], "feeBeforeFree": fee["subtotalBeforeFree"], "etaMinMinutes": mn, "etaMaxMinutes": mx, "breakdown": fee})
    avail = [o for o in options if o["available"]]
    selected = next((o for o in avail if o["id"] == option_id), None) or (avail[0] if avail else None)
    fee = selected["fee"] if selected else 0
    totals = cart_svc.price_for_user(user, delivery_fee=fee, promo_code=promo_code, locale=locale)
    pm = payment_methods(user)
    problems = list(totals["problems"])
    if not avail:
        problems.append({"reason": "no_delivery_option", "message": "We can't deliver these items to this location right now"})
    if totals["total"] < checkout_cfg.minOrderAmount:
        problems.append({"reason": "min_order", "minOrderAmount": checkout_cfg.minOrderAmount})
    cod_max = settings_service.get("payments").cashOnDeliveryMaxAmount
    requires_phone = settings_service.get("auth").requirePhoneForCheckout and not user.phone_verified_at
    eta_by = None
    if selected:
        eta_by = (now + timedelta(minutes=selected["etaMaxMinutes"])).isoformat()
    return {
        "deliverTo": {"lat": lat, "lng": lng},
        "store": {"id": str(store.id), "name": store.name, "address": store.address, "location": {"lat": store.location.y, "lng": store.location.x}, "distanceMeters": route["distanceMeters"] if route else None, "straightMeters": int(straight_m) if straight_m else None} if store else None,
        "route": {"polyline": route["polyline"] or None, "durationSeconds": route["durationSeconds"], "source": route["source"]} if route else None,
        "zone": zone and {"id": zone["id"], "name": zone["name"]},
        "options": options, "selectedOptionId": selected["id"] if selected else None, "arrivesBy": eta_by,
        "cart": totals, "payment": pm, "codMaxAmount": cod_max,
        "contact": {"name": user.name or None, "phone": user.phone, "phoneVerified": bool(user.phone_verified_at)},
        "requiresPhone": requires_phone, "extraFields": [f.model_dump() for f in checkout_cfg.extraFields], "slideToConfirm": checkout_cfg.slideToConfirm,
        "problems": problems, "canPlace": not problems and selected is not None and pm["default"] is not None and not requires_phone,
    }


def place(user, data: dict[str, Any], *, request=None, locale: str = "en") -> Order:
    """Creates the order exactly as quoted — or fails with a precise reason the app can show."""
    lat, lng = _validate_point(data.get("lat"), data.get("lng"))
    option_id = data.get("deliveryOptionId")
    method = data.get("paymentMethod")
    q = quote(user, lat=lat, lng=lng, option_id=option_id, promo_code=data.get("promoCode"), locale=locale)
    if q["requiresPhone"]:
        raise ApiError("Verify your phone number so your rider can reach you", status_code=400, code="phone_required")
    if q["problems"]:
        raise ApiError("Some things changed in your bag", status_code=409, code="checkout_problems", details={"problems": q["problems"]})
    selected = next((o for o in q["options"] if o["id"] == q["selectedOptionId"]), None)
    if selected is None or (option_id and selected["id"] != option_id):
        raise ApiError.bad_request("That delivery option isn't available here")
    if data.get("expectedTotal") is not None and int(data["expectedTotal"]) != q["cart"]["total"]:
        raise ApiError("The total changed — please review", status_code=409, code="total_changed", details={"total": q["cart"]["total"]})
    allowed = {m["method"] for m in q["payment"]["available"]}
    method = method or (q["payment"]["default"] or {}).get("method")
    if method not in allowed:
        raise ApiError.bad_request("Choose a payment method")
    if method == "CASH_ON_DELIVERY" and q["codMaxAmount"] and q["cart"]["total"] > q["codMaxAmount"]:
        raise ApiError.bad_request("Cash on delivery isn't available for orders this large — use mobile money")
    extra = _validate_extra_fields(data.get("extraFields") or {})
    pickup = selected["kind"] == "pickup"
    from inventory.models import Store

    store = Store.objects.get(id=(selected["store"]["id"] if pickup else q["store"]["id"]))
    place_label = (data.get("label") or "").strip()[:240]
    area = (data.get("area") or "").strip()[:80]
    if not place_label:
        try:
            rev = google_maps.reverse_geocode(lat, lng, locale) if google_maps.configured() else google_maps.offline_place(lat, lng)
        except ApiError:
            rev = google_maps.offline_place(lat, lng)
        place_label, area = rev["address"], area or rev["area"]
    cart = cart_svc.get_cart(user)
    items = list(CartItem.objects.filter(cart=cart, saved_for_later=False).select_related("variant__product__brand"))
    priced = {str(r["id"]): r for r in q["cart"]["items"]}
    with transaction.atomic():
        pin, pin_enc = new_pin()
        prep = settings_service.get("checkout").prepTimeMinutes
        order = Order.objects.create(
            number=next_order_number(), user=user, status="PENDING_PAYMENT", customer_type=user.customer_type if not (user.customer_type == "WHOLESALE" and not user.wholesale_approved) else "RETAIL",
            currency=q["cart"]["currency"], subtotal=q["cart"]["subtotal"], discount=q["cart"]["discount"], delivery_fee=q["cart"]["deliveryFee"], tax=q["cart"]["tax"], total=q["cart"]["total"], savings=q["cart"]["savings"],
            promo_code=(q["cart"]["promo"] or {}).get("code", "") if (q["cart"]["promo"] or {}).get("ok") else "",
            fulfilment="pickup" if pickup else "delivery", delivery_option={k: selected.get(k) for k in ("id", "name", "kind", "etaMinMinutes", "etaMaxMinutes")}, fee_breakdown=selected.get("breakdown") or {},
            store=store, destination=None if pickup else Point(lng, lat, srid=4326), destination_label=place_label if not pickup else store.address, destination_area=area,
            landmark_note=(data.get("landmarkNote") or "").strip()[:120], distance_m=(q["store"] or {}).get("distanceMeters"),
            contact_name=user.name, contact_phone=user.phone or "", extra_fields=extra, payment_method=method, delivery_pin=pin_enc if not pickup else "",
            eta_min_minutes=selected["etaMinMinutes"], eta_max_minutes=selected["etaMaxMinutes"], promised_by=timezone.now() + timedelta(minutes=selected["etaMaxMinutes"]),
            share_token=__import__("secrets").token_urlsafe(16),
        )
        from .cart import _image_for, options_label

        for it in items:
            r = priced[str(it.id)]
            OrderItem.objects.create(
                order=order, product=it.variant.product, variant=it.variant, sku=it.variant.sku, title=it.variant.product.title, brand=it.variant.product.brand.name if it.variant.product.brand_id else "",
                options_label=options_label(it.variant), image=_image_for(it.variant), qty=it.qty, retail_unit_price=r["retailUnitPrice"], unit_price=r["unitPrice"],
                price_basis=r["basis"], tier=r["tier"], line_total=r["lineTotal"], savings=r["savings"],
            )
        reserve_for_order(order, [(it.variant, it.qty) for it in items])
        add_event(order, "placed", actor="customer", actor_id=str(user.id), to="PENDING_PAYMENT", data={"option": selected["id"], "payment": method, "storeCode": store.code})
        if order.promo_code:
            from ..models import PromoCode

            promo = PromoCode.objects.select_for_update().get(code__iexact=order.promo_code)
            if promo.usage_limit is not None and promo.used_count >= promo.usage_limit:
                raise ApiError.conflict("promo_exhausted", "That code was just used up")
            promo.used_count += 1
            promo.save(update_fields=["used_count"])
            PromoRedemption.objects.create(promo=promo, user=user, order=order, discount=order.discount)
        from .payments import start_payment

        payment = start_payment(order, method, msisdn=data.get("msisdn") or user.phone or "")
        CartItem.objects.filter(cart=cart, saved_for_later=False).delete()
        cart.promo_code = ""
        cart.save(update_fields=["promo_code", "updated_at"])
        _remember_place(user, lat, lng, place_label, area, data)
        if method == "CASH_ON_DELIVERY" or payment.status == "PAID":
            order = transition(order, "CONFIRMED", actor="system", data={"payment": method})
            if not pickup:
                from delivery.services.dispatch import create_job

                create_job(order)
    return order


def _validate_extra_fields(values: dict) -> dict:
    fields = settings_service.get("checkout").extraFields
    out = {}
    for f in fields:
        v = values.get(f.key)
        if v in (None, ""):
            if f.required:
                raise ApiError.bad_request(f"{f.label} is required", details={"field": f.key})
            continue
        v = str(v).strip()[: 500 if f.type == "textarea" else 120]
        if f.type == "select" and f.options and v not in f.options:
            raise ApiError.bad_request(f"Choose a valid {f.label}", details={"field": f.key})
        if f.type == "phone":
            from accounts.phone import normalize_phone

            v = normalize_phone(v)
        out[f.key] = v
    return out


def _remember_place(user, lat: float, lng: float, label: str, area: str, data: dict) -> None:
    pid = data.get("savedPlaceId")
    now = timezone.now()
    if pid:
        SavedPlace.objects.filter(id=pid, user=user).update(last_used_at=now)
        return
    pt = Point(lng, lat, srid=4326)
    from django.contrib.gis.measure import D

    near = SavedPlace.objects.filter(user=user, location__distance_lte=(pt, D(m=40))).first()
    if near:
        near.last_used_at = now
        near.save(update_fields=["last_used_at"])
        return
    SavedPlace.objects.create(user=user, kind="recent", address=label or google_maps.offline_place(lat, lng)["address"], area=area, landmark_note=(data.get("landmarkNote") or "")[:120], location=pt, place_id=data.get("placeId") or "", last_used_at=now)
    stale = SavedPlace.objects.filter(user=user, kind="recent").order_by("-last_used_at").values_list("id", flat=True)[8:]
    SavedPlace.objects.filter(id__in=list(stale)).delete()
