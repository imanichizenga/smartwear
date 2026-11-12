from __future__ import annotations

import secrets
import uuid

from django.contrib.gis.geos import Point
from django.db import IntegrityError, transaction
from django.db.models import Avg, Count
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAppUser
from catalog.models import Product
from catalog.services.products import card_queryset, cards
from catalog.services.viewer import context_for_user, locale_of
from core import ratelimit, settings_service
from core.audit import audit, client_ip
from core.exceptions import ApiError
from core.idempotency import idempotent
from core.integrations import google_maps
from core.media_urls import media_out
from core.pagination import keyset, page_params

from .models import CartItem, Order, Review, ReturnRequest, SavedPaymentMethod, SavedPlace, WholesaleApplication, WishlistBoard, WishlistItem
from .services import cart as cart_svc
from .services import checkout as checkout_svc
from .services import payments as pay_svc
from .services.orders import order_out, order_queryset, transition


def _user(request):
    return request.user.user


# ================================================================ bag
class CartView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request):
        return Response(cart_svc.price_for_user(_user(request), locale=locale_of(request)))

    def delete(self, request):
        CartItem.objects.filter(cart__user=_user(request), saved_for_later=False).delete()
        return Response(cart_svc.price_for_user(_user(request), locale=locale_of(request)))


class CartItemsView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request):
        d = request.data or {}
        if "lines" in d:
            cart_svc.merge_guest_lines(_user(request), d["lines"])
        else:
            cart_svc.add_item(_user(request), d.get("variantId"), int(d.get("qty", 1)))
        return Response(cart_svc.price_for_user(_user(request), locale=locale_of(request)), status=201)


class CartItemView(APIView):
    permission_classes = [IsAppUser]

    def patch(self, request, item_id: int):
        d = request.data or {}
        cart_svc.update_item(_user(request), item_id, qty=d.get("qty"), saved_for_later=d.get("savedForLater"), variant_id=d.get("variantId"))
        return Response(cart_svc.price_for_user(_user(request), locale=locale_of(request)))

    def delete(self, request, item_id: int):
        cart_svc.remove_item(_user(request), item_id)
        return Response(cart_svc.price_for_user(_user(request), locale=locale_of(request)))


class CartPromoView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request):
        ratelimit.enforce("promo", str(_user(request).id), 20, 600, "Too many attempts. Try again later.")
        code = (request.data.get("code") or "").strip().upper()
        priced = cart_svc.price_for_user(_user(request), promo_code=code, locale=locale_of(request))
        if priced["promo"] and priced["promo"]["ok"]:
            cart = cart_svc.get_cart(_user(request))
            cart.promo_code = priced["promo"]["code"]
            cart.save(update_fields=["promo_code"])
        return Response(priced)

    def delete(self, request):
        cart = cart_svc.get_cart(_user(request))
        cart.promo_code = ""
        cart.save(update_fields=["promo_code"])
        return Response(cart_svc.price_for_user(_user(request), promo_code="", locale=locale_of(request)))


# ================================================================ wishlist boards
def _default_board(user) -> WishlistBoard:
    b = WishlistBoard.objects.filter(user=user, is_default=True).first()
    if b is None:
        try:
            b = WishlistBoard.objects.create(user=user, name="Saved", is_default=True)
        except IntegrityError:
            b = WishlistBoard.objects.get(user=user, is_default=True)
    return b


def board_out(b: WishlistBoard, preview: int = 4) -> dict:
    items = list(b.items.select_related("product").order_by("-added_at")[:preview])
    covers = []
    for it in items:
        link = it.product.media_links.filter(media__type="IMAGE", media__status="READY").select_related("media").order_by("sort_order").first()
        if link:
            covers.append(media_out(link.media))
    return {"id": str(b.id), "name": b.name, "isDefault": b.is_default, "count": b.items.count(), "covers": covers, "shareToken": b.share_token, "createdAt": b.created_at.isoformat()}


class WishlistView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request):
        user = _user(request)
        _default_board(user)
        return Response({"boards": [board_out(b) for b in WishlistBoard.objects.filter(user=user)], "productIds": [str(p) for p in WishlistItem.objects.filter(board__user=user).values_list("product_id", flat=True).distinct()]})

    def post(self, request):
        """Toggle-style save: {productId, boardId?, variantId?}. Saving again into the same board is a no-op."""
        user = _user(request)
        d = request.data or {}
        p = Product.objects.filter(id=d.get("productId"), status="PUBLISHED").first()
        if p is None:
            raise ApiError.not_found("Product")
        board = WishlistBoard.objects.filter(user=user, id=d["boardId"]).first() if d.get("boardId") else _default_board(user)
        if board is None:
            raise ApiError.not_found("Board")
        WishlistItem.objects.get_or_create(board=board, product=p, defaults={"variant_id": d.get("variantId"), "price_at_add": p.min_price})
        return Response({"ok": True, "boardId": str(board.id), "wishlisted": True}, status=201)

    def delete(self, request):
        user = _user(request)
        pid = request.query_params.get("productId") or (request.data or {}).get("productId")
        qs = WishlistItem.objects.filter(board__user=user, product_id=pid)
        if request.query_params.get("boardId"):
            qs = qs.filter(board_id=request.query_params["boardId"])
        qs.delete()
        return Response({"ok": True, "wishlisted": WishlistItem.objects.filter(board__user=user, product_id=pid).exists()})


class BoardsView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request):
        name = (request.data.get("name") or "").strip()[:60]
        if not name:
            raise ApiError.bad_request("Name your board")
        user = _user(request)
        if WishlistBoard.objects.filter(user=user).count() >= 50:
            raise ApiError.bad_request("You have a lot of boards — tidy a few first")
        return Response(board_out(WishlistBoard.objects.create(user=user, name=name)), status=201)


class BoardView(APIView):
    permission_classes = [IsAppUser]

    def _board(self, request, bid):
        b = WishlistBoard.objects.filter(user=_user(request), id=bid).first()
        if b is None:
            raise ApiError.not_found("Board")
        return b

    def get(self, request, bid):
        b = self._board(request, bid)
        ids = list(b.items.order_by("-added_at").values_list("product_id", flat=True))
        by = {p.id: p for p in card_queryset(Product.objects.filter(id__in=ids))}
        ctx = context_for_user(_user(request))
        return Response({**board_out(b), "items": cards([by[i] for i in ids if i in by], ctx, user=_user(request), locale=locale_of(request))})

    def patch(self, request, bid):
        b = self._board(request, bid)
        if "name" in request.data:
            b.name = (request.data["name"] or b.name)[:60]
        if request.data.get("share") is True and not b.share_token:
            b.share_token = secrets.token_urlsafe(12)
        if request.data.get("share") is False:
            b.share_token = None
        b.save()
        return Response(board_out(b))

    def delete(self, request, bid):
        b = self._board(request, bid)
        if b.is_default:
            raise ApiError.bad_request("Your main board can't be deleted")
        b.delete()
        return Response({"ok": True})


class SharedBoardView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token: str):
        b = WishlistBoard.objects.select_related("user").filter(share_token=token).first()
        if b is None:
            raise ApiError.not_found("Board")
        ids = list(b.items.order_by("-added_at").values_list("product_id", flat=True))
        by = {p.id: p for p in card_queryset(Product.objects.filter(id__in=ids, status="PUBLISHED"))}
        ctx = context_for_user(None)
        return Response({"name": b.name, "owner": b.user.display_name.split(" ")[0], "items": cards([by[i] for i in ids if i in by], ctx, locale=locale_of(request))})


# ================================================================ places & maps proxy
def place_out(p: SavedPlace) -> dict:
    return {"id": str(p.id), "kind": p.kind, "label": p.label or {"home": "Home", "work": "Work"}.get(p.kind, ""), "address": p.address, "area": p.area or None, "landmarkNote": p.landmark_note or None, "location": {"lat": p.location.y, "lng": p.location.x}, "placeId": p.place_id or None, "plusCode": p.plus_code or None, "lastUsedAt": p.last_used_at.isoformat() if p.last_used_at else None}


class PlacesView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request):
        rows = SavedPlace.objects.filter(user=_user(request))
        return Response({"saved": [place_out(p) for p in rows if p.kind != "recent"], "recent": [place_out(p) for p in rows.filter(kind="recent").order_by("-last_used_at")[:6]]})

    def post(self, request):
        d = request.data or {}
        lat, lng = checkout_svc._validate_point(d.get("lat"), d.get("lng"))
        kind = d.get("kind") or "other"
        if kind not in ("home", "work", "other"):
            raise ApiError.bad_request("kind must be home, work or other")
        user = _user(request)
        with transaction.atomic():
            if kind in ("home", "work"):
                SavedPlace.objects.filter(user=user, kind=kind).update(kind="other")
            p = SavedPlace.objects.create(user=user, kind=kind, label=(d.get("label") or "")[:60], address=(d.get("address") or google_maps.offline_place(lat, lng)["address"])[:240], area=(d.get("area") or "")[:80], landmark_note=(d.get("landmarkNote") or "")[:120], location=Point(lng, lat, srid=4326), place_id=(d.get("placeId") or "")[:300], plus_code=(d.get("plusCode") or "")[:32])
        return Response(place_out(p), status=201)


class PlaceView(APIView):
    permission_classes = [IsAppUser]

    def patch(self, request, pid):
        p = SavedPlace.objects.filter(user=_user(request), id=pid).first()
        if p is None:
            raise ApiError.not_found("Place")
        d = request.data
        for k, f, n in (("label", "label", 60), ("landmarkNote", "landmark_note", 120), ("address", "address", 240)):
            if k in d:
                setattr(p, f, (d[k] or "")[:n])
        if d.get("kind") in ("home", "work", "other"):
            SavedPlace.objects.filter(user=p.user, kind=d["kind"]).exclude(id=p.id).filter(kind__in=["home", "work"]).update(kind="other")
            p.kind = d["kind"]
        if "lat" in d and "lng" in d:
            lat, lng = checkout_svc._validate_point(d["lat"], d["lng"])
            p.location = Point(lng, lat, srid=4326)
        p.save()
        return Response(place_out(p))

    def delete(self, request, pid):
        SavedPlace.objects.filter(user=_user(request), id=pid).delete()
        return Response({"ok": True})


def _maps_rate(request):
    ident = str(request.user.id) if request.user else (client_ip(request) or "")
    ratelimit.enforce("maps", ident, 300, 600, "Search is busy — try again in a moment")


class PlaceAutocompleteView(APIView):
    """Places Autocomplete (New) through our server key. Sessions: the app sends a UUID per search session."""

    permission_classes = [AllowAny]

    def get(self, request):
        _maps_rate(request)
        q = request.query_params
        text = (q.get("q") or "").strip()
        token = q.get("session") or str(uuid.uuid4())
        lat = float(q["lat"]) if q.get("lat") else None
        lng = float(q["lng"]) if q.get("lng") else None
        if google_maps.is_plus_code(text):
            hit = google_maps.geocode_text(text, lat=lat, lng=lng, language=locale_of(request))
            return Response({"session": token, "items": [{"placeId": hit["placeId"], "primary": text.upper(), "secondary": hit["address"], "matches": [], "location": {"lat": hit["lat"], "lng": hit["lng"]}, "kind": "plus_code"}] if hit else []})
        items = google_maps.autocomplete(text, session_token=token, lat=lat, lng=lng, language=locale_of(request))
        return Response({"session": token, "items": items})


class PlaceDetailsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, place_id: str):
        _maps_rate(request)
        return Response(google_maps.place_details(place_id, session_token=request.query_params.get("session"), language=locale_of(request)))


class ReverseGeocodeView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        _maps_rate(request)
        lat, lng = checkout_svc._validate_point(request.query_params.get("lat"), request.query_params.get("lng"))
        if not google_maps.configured():
            return Response({**google_maps.offline_place(lat, lng), "offline": True})
        try:
            return Response(google_maps.reverse_geocode(lat, lng, locale_of(request)))
        except ApiError:
            return Response({**google_maps.offline_place(lat, lng), "offline": True})


# ================================================================ payment methods
class PaymentMethodsView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request):
        return Response(checkout_svc.payment_methods(_user(request)))

    def post(self, request):
        d = request.data or {}
        method = d.get("method")
        if method not in ("CASH_ON_DELIVERY", "MOBILE_MONEY"):
            raise ApiError.bad_request("Choose cash on delivery or mobile money")
        msisdn = ""
        if method == "MOBILE_MONEY":
            from accounts.phone import normalize_phone

            msisdn = normalize_phone(d.get("msisdn") or _user(request).phone or "")
        user = _user(request)
        with transaction.atomic():
            if d.get("isDefault", True):
                SavedPaymentMethod.objects.filter(user=user, is_default=True).update(is_default=False)
            m = SavedPaymentMethod.objects.create(user=user, method=method, provider=(d.get("provider") or "")[:24], label=(d.get("label") or "")[:60], msisdn=msisdn, is_default=d.get("isDefault", True))
        return Response({"id": str(m.id)}, status=201)


class PaymentMethodView(APIView):
    permission_classes = [IsAppUser]

    def patch(self, request, mid):
        user = _user(request)
        m = SavedPaymentMethod.objects.filter(user=user, id=mid).first()
        if m is None:
            raise ApiError.not_found("Payment method")
        if request.data.get("isDefault"):
            with transaction.atomic():
                SavedPaymentMethod.objects.filter(user=user, is_default=True).update(is_default=False)
                m.is_default = True
                m.save(update_fields=["is_default"])
        return Response({"ok": True})

    def delete(self, request, mid):
        SavedPaymentMethod.objects.filter(user=_user(request), id=mid).delete()
        return Response({"ok": True})


# ================================================================ checkout & orders
class CheckoutQuoteView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request):
        d = request.data or {}
        return Response(checkout_svc.quote(_user(request), lat=d.get("lat"), lng=d.get("lng"), option_id=d.get("deliveryOptionId"), promo_code=d.get("promoCode"), locale=locale_of(request)))


class PlaceOrderView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request):
        user = _user(request)
        ratelimit.enforce("orders", str(user.id), 20, 3600, "Too many orders in a short time")

        def run():
            order = checkout_svc.place(user, request.data or {}, request=request, locale=locale_of(request))
            audit("order.place", "order", order.id, request=request, user=user, meta={"number": order.number, "total": order.total})
            return Response(order_out(order_queryset().get(id=order.id), locale=locale_of(request)), status=201)

        return idempotent(request, "order.place", str(user.id), run)


class OrdersView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request):
        cursor, limit = page_params(request, 20, 50)
        qs = Order.objects.filter(user=_user(request)).select_related("store").prefetch_related("items__image")
        if request.query_params.get("active") == "1":
            from delivery.state import ORDER_ACTIVE

            qs = qs.filter(status__in=ORDER_ACTIVE + ["PENDING_PAYMENT"])
        rows, nxt = keyset(qs, ["-placed_at", "-id"], cursor, limit)
        loc = locale_of(request)
        from .services.orders import STATUS_LABELS

        return Response({"items": [{
            "id": str(o.id), "number": o.number, "status": o.status, "statusLabel": STATUS_LABELS[o.status][1 if loc == "sw" else 0], "placedAt": o.placed_at.isoformat(),
            "total": o.total, "currency": o.currency, "itemCount": sum(i.qty for i in o.items.all()), "images": [media_out(i.image) for i in o.items.all()[:3] if i.image_id], "fulfilment": o.fulfilment,
        } for o in rows], "nextCursor": nxt})


def _my_order(request, oid) -> Order:
    o = order_queryset().filter(user=_user(request), id=oid).first()
    if o is None:
        raise ApiError.not_found("Order")
    return o


class OrderView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request, oid):
        return Response(order_out(_my_order(request, oid), locale=locale_of(request)))


class OrderCancelView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request, oid):
        o = _my_order(request, oid)
        transition(o, "CANCELLED", actor="customer", actor_id=str(o.user_id), reason=(request.data.get("reason") or "Cancelled by customer")[:240])
        return Response(order_out(order_queryset().get(id=o.id), locale=locale_of(request)))


class OrderKeepSearchingView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request, oid):
        from delivery.services.dispatch import keep_searching

        o = _my_order(request, oid)
        if not hasattr(o, "delivery"):
            raise ApiError.bad_request("This order has no delivery")
        keep_searching(o.delivery, "customer")
        return Response(order_out(order_queryset().get(id=o.id), locale=locale_of(request)))


class OrderReorderView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request, oid):
        o = _my_order(request, oid)
        added, skipped = 0, []
        for it in o.items.all():
            try:
                cart_svc.add_item(_user(request), it.variant_id, it.qty)
                added += 1
            except ApiError:
                skipped.append(it.title)
        return Response({"added": added, "skipped": skipped, "cart": cart_svc.price_for_user(_user(request), locale=locale_of(request))})


class OrderPaymentRetryView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request, oid):
        o = _my_order(request, oid)
        p = pay_svc.retry_payment(o, msisdn=request.data.get("msisdn") or _user(request).phone or "")
        return Response({"checkoutUrl": p.checkout_url})


class OrderInvoiceView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request, oid):
        from .invoice import render_invoice_pdf

        o = _my_order(request, oid)
        from django.http import HttpResponse

        resp = HttpResponse(render_invoice_pdf(o), content_type="application/pdf")
        resp["Content-Disposition"] = f'attachment; filename="{o.number}.pdf"'
        return resp


class OrderRateView(APIView):
    """Rate the rider (and optionally products) after delivery."""

    permission_classes = [IsAppUser]

    @transaction.atomic
    def post(self, request, oid):
        from delivery.models import Rider, RiderRating

        o = _my_order(request, oid)
        if o.status != "DELIVERED":
            raise ApiError.bad_request("You can rate once the order is delivered")
        d = request.data or {}
        job = getattr(o, "delivery", None)
        if job and job.rider_id and d.get("riderRating"):
            r = int(d["riderRating"])
            if not 1 <= r <= 5:
                raise ApiError.bad_request("Rating is 1–5")
            RiderRating.objects.update_or_create(job=job, defaults={"rider_id": job.rider_id, "user": o.user, "rating": r, "tags": (d.get("riderTags") or [])[:6], "comment": (d.get("riderComment") or "")[:500]})
            agg = RiderRating.objects.filter(rider_id=job.rider_id).aggregate(a=Avg("rating"), n=Count("id"))
            Rider.objects.filter(id=job.rider_id).update(rating_avg=round(agg["a"], 2), rating_count=agg["n"])
        for pr in d.get("products") or []:
            _upsert_review(o.user, {**pr, "orderId": str(o.id)})
        o.rated_at = timezone.now()
        o.save(update_fields=["rated_at"])
        return Response({"ok": True})


class OrderReturnView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request, oid):
        if not settings_service.get("features").returns:
            raise ApiError.forbidden("Returns aren't available")
        o = _my_order(request, oid)
        if o.status != "DELIVERED" or not o.delivered_at or (timezone.now() - o.delivered_at).days > 14:
            raise ApiError.bad_request("Returns are possible within 14 days of delivery")
        d = request.data or {}
        valid_ids = {i.id: i for i in o.items.all()}
        items = []
        for it in d.get("items") or []:
            oi = valid_ids.get(int(it["orderItemId"]))
            if oi is None or not 1 <= int(it.get("qty", 1)) <= oi.qty:
                raise ApiError.bad_request("Choose items from this order")
            items.append({"orderItemId": oi.id, "qty": int(it.get("qty", 1)), "exchangeVariantId": it.get("exchangeVariantId")})
        if not items:
            raise ApiError.bad_request("Choose at least one item")
        reason = d.get("reason")
        if reason not in ("wrong_size", "not_as_described", "damaged", "changed_mind", "wrong_item", "other"):
            raise ApiError.bad_request("Choose a reason")
        rr = ReturnRequest.objects.create(order=o, user=o.user, kind="exchange" if d.get("kind") == "exchange" else "return", items=items, reason=reason, comment=(d.get("comment") or "")[:2000])
        if d.get("mediaIds"):
            from media.models import Media

            rr.media.set(Media.objects.filter(id__in=d["mediaIds"][:4], owner_user=o.user))
        return Response({"id": str(rr.id), "status": rr.status}, status=201)


class PublicTrackingView(APIView):
    """Shareable live-tracking link for gifts — no PII beyond first names and the area."""

    permission_classes = [AllowAny]

    def get(self, request, token: str):
        if not settings_service.get("features").shareTracking:
            raise ApiError.not_found("Tracking")
        o = order_queryset().filter(share_token=token).first()
        if o is None:
            raise ApiError.not_found("Tracking")
        full = order_out(o, viewer="public", locale=locale_of(request))
        dest = full["destination"] or {}
        return Response({
            "number": o.number, "status": o.status, "statusLabel": full["statusLabel"], "eta": full["eta"], "store": {"name": full["store"]["name"], "location": full["store"]["location"]},
            "destination": {"area": dest.get("area"), "location": dest.get("location")}, "delivery": {k: (full["delivery"] or {}).get(k) for k in ("status", "riderLocation", "route", "routeLeg")} | {"rider": {"firstName": full["delivery"]["rider"]["firstName"], "vehicle": full["delivery"]["rider"]["vehicle"]} if full["delivery"] and full["delivery"]["rider"] else None},
        })


# ================================================================ reviews
def _upsert_review(user, d: dict) -> Review:
    from catalog.models import Product as P

    p = P.objects.filter(id=d.get("productId")).first()
    if p is None:
        raise ApiError.not_found("Product")
    rating = int(d.get("rating") or 0)
    if not 1 <= rating <= 5:
        raise ApiError.bad_request("Rating is 1–5")
    from .models import OrderItem

    oi = OrderItem.objects.filter(order__user=user, order__status="DELIVERED", product=p).order_by("-order__delivered_at").first()
    auto_publish = oi is not None
    r, _ = Review.objects.update_or_create(product=p, user=user, defaults={
        "order": oi.order if oi else None, "variant_id": oi.variant_id if oi else None, "rating": rating, "title": (d.get("title") or "")[:100], "body": (d.get("body") or "")[:2000],
        "tags": [t[:30] for t in (d.get("tags") or [])][:6], "verified": oi is not None, "status": "PUBLISHED" if auto_publish and not d.get("body") else "PENDING",
    })
    if d.get("mediaIds"):
        from media.models import Media

        r.media.set(Media.objects.filter(id__in=d["mediaIds"][:4], owner_user=user))
    if oi:
        OrderItem.objects.filter(order__user=user, product=p).update(reviewed=True)
    refresh_rating(p)
    return r


def refresh_rating(p) -> None:
    agg = Review.objects.filter(product=p, status="PUBLISHED").aggregate(a=Avg("rating"), n=Count("id"))
    Product.objects.filter(id=p.id).update(rating_avg=round(agg["a"] or 0, 2), rating_count=agg["n"] or 0)


def review_out(r: Review) -> dict:
    return {"id": str(r.id), "rating": r.rating, "title": r.title or None, "body": r.body or None, "tags": r.tags, "media": [media_out(m) for m in r.media.all()], "author": {"name": (r.user.name or "SmartWear member").split(" ")[0], "avatarUrl": media_out(r.user.avatar)["url"] if r.user.avatar_id else None}, "verified": r.verified, "createdAt": r.created_at.isoformat(), "helpful": r.helpful_count}


class ProductReviewsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, pid):
        cursor, limit = page_params(request, 10, 30)
        qs = Review.objects.filter(product_id=pid, status="PUBLISHED").select_related("user__avatar").prefetch_related("media")
        if request.query_params.get("withPhotos") == "1":
            qs = qs.filter(media__isnull=False).distinct()
        rows, nxt = keyset(qs, ["-created_at", "-id"], cursor, limit)
        return Response({"items": [review_out(r) for r in rows], "nextCursor": nxt})

    def post(self, request, pid):
        if request.user is None or request.user.kind not in ("customer", "rider"):
            raise ApiError.unauthorized("Sign in to review")
        if not settings_service.get("features").reviews:
            raise ApiError.forbidden("Reviews are turned off")
        r = _upsert_review(request.user.user, {**(request.data or {}), "productId": str(pid)})
        return Response(review_out(r) | {"status": r.status}, status=201)


class ReviewHelpfulView(APIView):
    permission_classes = [IsAppUser]

    def post(self, request, rid):
        key = f"sw:review-helpful:{rid}:{_user(request).id}"
        if settings_service.redis_client().set(key, 1, nx=True, ex=86400 * 365):
            from django.db.models import F

            Review.objects.filter(id=rid).update(helpful_count=F("helpful_count") + 1)
        return Response({"ok": True})


# ================================================================ wholesale & loyalty
class WholesaleApplicationView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request):
        a = WholesaleApplication.objects.filter(user=_user(request)).order_by("-created_at").first()
        return Response({"application": {"id": str(a.id), "status": a.status, "businessName": a.business_name, "tin": a.tin, "reviewNote": a.review_note or None, "submittedAt": a.created_at.isoformat()} if a else None, "approved": _user(request).wholesale_approved})

    def post(self, request):
        if not settings_service.get("features").wholesaleApplications:
            raise ApiError.forbidden("Wholesale applications are closed")
        user = _user(request)
        if WholesaleApplication.objects.filter(user=user, status="PENDING").exists():
            raise ApiError.conflict("pending", "Your application is being reviewed")
        d = request.data or {}
        tin = "".join(ch for ch in (d.get("tin") or "") if ch.isdigit())
        if len(tin) != 9:
            raise ApiError.bad_request("TIN has 9 digits", details={"field": "tin"})
        if not (d.get("businessName") or "").strip():
            raise ApiError.bad_request("Business name is required", details={"field": "businessName"})
        from media.models import Media

        lic = Media.objects.filter(id=d.get("licenceMediaId"), owner_user=user).first() if d.get("licenceMediaId") else None
        a = WholesaleApplication.objects.create(user=user, business_name=d["businessName"].strip()[:120], tin=tin, business_type=(d.get("businessType") or "")[:60], address=(d.get("address") or "")[:240], licence=lic, expected_monthly_volume=(d.get("expectedMonthlyVolume") or "")[:40])
        audit("wholesale.apply", "wholesale_application", a.id, request=request, user=user)
        return Response({"id": str(a.id), "status": a.status}, status=201)


class LoyaltyView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request):
        from accounts.serializers import user_out

        user = _user(request)
        return Response({**user_out(user)["loyalty"], "tiers": [t.model_dump() for t in settings_service.get("loyalty").tiers], "history": [{"delta": e.delta, "reason": e.reason, "orderNumber": e.order.number if e.order_id else None, "at": e.created_at.isoformat()} for e in user.loyalty_entries.select_related("order")[:50]]})


# ================================================================ webhooks
class SnippeWebhookView(APIView):
    """Snippe payment results. Signature checked on the raw body; 2xx quickly so Snippe stops retrying."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request):
        return Response(pay_svc.handle_snippe_webhook(request.body, request.headers))


class OrderPaymentStatusView(APIView):
    """The app polls this while the shopper approves the USSD prompt; reconciles with Snippe if needed."""

    permission_classes = [IsAppUser]

    def get(self, request, oid):
        o = _my_order(request, oid)
        p = o.payments.order_by("-created_at").first()
        # The app polls every few seconds; ask Snippe at most every 8s per payment (webhooks are the fast path).
        if p and p.provider == "snippe" and p.status == "PENDING" and settings_service.redis_client().set(f"sw:snippe:sync:{p.id}", 1, nx=True, ex=8):
            try:
                p = pay_svc.sync_snippe(p)
            except ApiError:
                pass
        o.refresh_from_db()
        return Response({"orderStatus": o.status, "paymentStatus": o.payment_status, "payment": {"status": p.status, "provider": p.provider, "method": p.method} if p else None})

    def post(self, request, oid):
        """Resend the USSD prompt."""
        o = _my_order(request, oid)
        pay_svc.resend_push(o)
        return Response({"ok": True})


class BeemCheckoutCallbackView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request):
        return Response(pay_svc.handle_beem_callback(request.data or {}, request.headers.get("beem-secure-token")))


class DeliveryEstimateView(APIView):
    """"Arrives today by 6pm" on the product page, from the shopper's location and live stock."""

    permission_classes = [AllowAny]

    def get(self, request):
        from catalog.models import ProductVariant
        from delivery.fees import eta_window
        from inventory.services import nearest_store_with_stock

        q = request.query_params
        lat, lng = checkout_svc._validate_point(q.get("lat"), q.get("lng"))
        v = ProductVariant.objects.filter(id=q.get("variantId")).first() if q.get("variantId") else ProductVariant.objects.filter(product_id=q.get("productId"), is_active=True).first()
        if v is None:
            raise ApiError.not_found("Product")
        store, straight, _ = nearest_store_with_stock(lat, lng, [(v, 1)])
        cur = settings_service.get("delivery.pricing").currency
        if store is None:
            return Response({"available": False, "storeName": None, "minMinutes": None, "maxMinutes": None, "arrivesBy": None, "fee": None, "currency": cur})
        route = google_maps.route((store.location.y, store.location.x), (lat, lng))
        opt = next((o for o in settings_service.get("delivery.pricing").options if o.enabled and o.kind != "pickup"), None)
        if opt is None:
            return Response({"available": False, "currency": cur})
        mn, mx = eta_window(opt, route["durationSeconds"] / 60, settings_service.get("checkout").prepTimeMinutes)
        from delivery.fees import compute_fee, match_zone

        fee = compute_fee(settings_service.get("delivery.pricing"), distance_m=route["distanceMeters"], zone=match_zone(lat, lng), option=opt, subtotal=v.retail_price, at=timezone.now(), tz=settings_service.get("localization").timezone)
        from datetime import timedelta

        by = timezone.now() + timedelta(minutes=mx)
        return Response({"available": fee["serviceable"], "storeName": store.name, "minMinutes": mn, "maxMinutes": mx, "arrivesBy": by.isoformat(), "fee": fee["fee"] if fee["serviceable"] else None, "currency": cur, "option": opt.name})
