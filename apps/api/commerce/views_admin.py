from __future__ import annotations

import csv
import io
from datetime import timedelta

from django.db import transaction
from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Max, Q, Sum
from django.db.models.functions import TruncDate, TruncHour
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import AdminPerm, require_perm
from core.audit import audit
from core.exceptions import ApiError
from core.media_urls import media_out
from core.pagination import keyset, page_params
from delivery import state

from .models import Order, OrderItem, PromoCode, ReturnRequest, Review, WholesaleApplication
from .services import payments as pay_svc
from .services.orders import STATUS_LABELS, add_event, order_out, order_queryset, sla, transition


def _order(oid) -> Order:
    o = order_queryset().filter(id=oid).first()
    if o is None:
        raise ApiError.not_found("Order")
    return o


def _row(o: Order) -> dict:
    job = getattr(o, "delivery", None)
    return {
        "id": str(o.id), "number": o.number, "status": o.status, "statusLabel": STATUS_LABELS[o.status][0], "placedAt": o.placed_at.isoformat(),
        "customer": {"id": str(o.user_id), "name": o.user.display_name, "phone": o.contact_phone, "type": o.customer_type}, "store": o.store.name,
        "total": o.total, "currency": o.currency, "items": sum(i.qty for i in o.items.all()), "payment": {"method": o.payment_method, "status": o.payment_status},
        "fulfilment": o.fulfilment, "area": o.destination_area or None, "delivery": {"status": job.status, "rider": job.rider.user.name if job.rider_id else None} if job else None,
        "sla": sla(o), "promisedBy": o.promised_by.isoformat() if o.promised_by else None, "ready": o.ready_at is not None,
    }


def _filter_orders(qs, q):
    if q.get("status"):
        qs = qs.filter(status__in=q["status"].split(","))
    if q.get("q"):
        t = q["q"].strip()
        qs = qs.filter(Q(number__icontains=t) | Q(contact_phone__icontains=t) | Q(user__name__icontains=t) | Q(contact_name__icontains=t))
    if q.get("storeId"):
        qs = qs.filter(store_id=q["storeId"])
    if q.get("payment"):
        qs = qs.filter(payment_method=q["payment"])
    if q.get("customerType"):
        qs = qs.filter(customer_type=q["customerType"])
    if q.get("from"):
        qs = qs.filter(placed_at__date__gte=parse_date(q["from"]))
    if q.get("to"):
        qs = qs.filter(placed_at__date__lte=parse_date(q["to"]))
    if q.get("riderId"):
        qs = qs.filter(delivery__rider_id=q["riderId"])
    if q.get("needsRider") == "1":
        qs = qs.filter(delivery__status__in=["SEARCHING", "OFFERED", "NO_RIDER"])
    return qs


class AdminOrdersView(APIView):
    permission_classes = [AdminPerm("orders.view")]

    def get(self, request):
        q = request.query_params
        cursor, limit = page_params(request, 50, 200)
        qs = _filter_orders(Order.objects.select_related("user", "store", "delivery__rider__user").prefetch_related("items"), q)
        sort = {"placed": ["-placed_at", "-id"], "-placed": ["placed_at", "id"], "total": ["-total", "-id"]}.get(q.get("sort", "placed"), ["-placed_at", "-id"])
        if q.get("format") == "csv":
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["number", "placed_at", "status", "customer", "phone", "customer_type", "store", "items", "subtotal", "discount", "delivery_fee", "tax", "total", "currency", "payment_method", "payment_status", "area"])
            for o in qs.order_by(*sort).iterator(chunk_size=500):
                w.writerow([o.number, o.placed_at.isoformat(), o.status, o.user.display_name, o.contact_phone, o.customer_type, o.store.name, sum(i.qty for i in o.items.all()), o.subtotal, o.discount, o.delivery_fee, o.tax, o.total, o.currency, o.payment_method, o.payment_status, o.destination_area])
            resp = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
            resp["Content-Disposition"] = f'attachment; filename="orders-{timezone.now():%Y%m%d}.csv"'
            return resp
        rows, nxt = keyset(qs, sort, cursor, limit)
        counts = dict(_filter_orders(Order.objects.all(), {k: v for k, v in q.items() if k != "status"}).values("status").annotate(n=Count("id")).values_list("status", "n"))
        return Response({"items": [_row(o) for o in rows], "nextCursor": nxt, "counts": counts})


class AdminOrdersKanbanView(APIView):
    permission_classes = [AdminPerm("orders.view")]
    COLUMNS = ["PENDING_PAYMENT", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "ASSIGNED", "ON_THE_WAY", "ARRIVED", "DELIVERED"]

    def get(self, request):
        since = timezone.now() - timedelta(hours=int(request.query_params.get("hours", 24)))
        qs = _filter_orders(Order.objects.select_related("user", "store", "delivery__rider__user").prefetch_related("items"), request.query_params)
        cols = []
        for s in self.COLUMNS:
            sub = qs.filter(status__in=[s, "PICKED_UP"] if s == "ON_THE_WAY" else [s])
            if s == "DELIVERED":
                sub = sub.filter(delivered_at__gte=since)
            cols.append({"status": s, "label": STATUS_LABELS[s][0], "items": [_row(o) for o in sub.order_by("placed_at")[:100]], "count": sub.count(),
                         "dropTargets": [t for t, a in state.ORDER_TRANSITIONS.get(s, {}).items() if "admin" in a]})
        return Response({"columns": cols})


class AdminOrderView(APIView):
    permission_classes = [AdminPerm("orders.view")]

    def get(self, request, oid):
        return Response(order_out(_order(oid), viewer="admin"))

    def patch(self, request, oid):
        require_perm(request, "orders.manage")
        o = _order(oid)
        if "adminNotes" in request.data:
            o.admin_notes = (request.data["adminNotes"] or "")[:5000]
            o.save(update_fields=["admin_notes"])
            add_event(o, "note", actor="admin", actor_id=str(request.user.admin.id), data={"note": o.admin_notes[:200]})
        return Response(order_out(_order(oid), viewer="admin"))


class AdminOrderActionView(APIView):
    """POST {action: status|ready|cancel|refund|assign|keep_searching, ...}"""

    permission_classes = [AdminPerm("orders.manage")]

    def post(self, request, oid):
        o = _order(oid)
        admin = request.user.admin
        d = request.data or {}
        a = d.get("action")
        if a == "status":
            to = d.get("to")
            if to in ("ASSIGNED",):
                raise ApiError.bad_request("Assign a rider instead")
            if to == "CANCELLED":
                a = "cancel"
            else:
                transition(o, to, actor="admin", actor_id=str(admin.id), reason=d.get("reason") or "")
        if a == "ready":
            with transaction.atomic():
                o = Order.objects.select_for_update().get(pk=o.pk)
                if o.ready_at is None:
                    o.ready_at = timezone.now()
                    o.save(update_fields=["ready_at"])
                    add_event(o, "ready", actor="admin", actor_id=str(admin.id))
                if o.status == "PREPARING":
                    transition(o, "READY_FOR_PICKUP", actor="admin", actor_id=str(admin.id), notify_customer=False)
                if o.fulfilment == "pickup":
                    from notifications.service import notify

                    notify(o.user, "order.ready_pickup", {"orderNumber": o.number, "storeName": o.store.name}, data={"orderId": str(o.id)})
        elif a == "cancel":
            transition(o, "CANCELLED", actor="admin", actor_id=str(admin.id), reason=d.get("reason") or "Cancelled by SmartWear")
        elif a == "refund":
            require_perm(request, "orders.refund")
            pay_svc.refund(o, int(d.get("amount") or o.total), admin=admin, reason=d.get("reason") or "")
        elif a == "assign":
            require_perm(request, "dispatch.assign")
            from delivery.models import Rider
            from delivery.services.dispatch import create_job, manual_assign

            rider = Rider.objects.filter(id=d.get("riderId")).first()
            if rider is None:
                raise ApiError.not_found("Rider")
            job = getattr(o, "delivery", None) or create_job(o)
            manual_assign(job, rider, admin=admin)
        elif a == "keep_searching":
            from delivery.services.dispatch import keep_searching

            keep_searching(o.delivery, "admin")
        elif a == "delivered_pickup":
            if o.fulfilment != "pickup":
                raise ApiError.bad_request("Only store-pickup orders are handed over at the counter")
            transition(o, "DELIVERED", actor="admin", actor_id=str(admin.id))
        elif a != "status":
            raise ApiError.bad_request("Unknown action")
        audit(f"order.{a}", "order", o.id, request=request, meta={k: v for k, v in d.items() if k != "action"})
        return Response(order_out(_order(oid), viewer="admin"))


class AdminOrderDocumentView(APIView):
    permission_classes = [AdminPerm("orders.view")]

    def get(self, request, oid, doc: str):
        from .invoice import render_invoice_pdf, render_label_pdf

        o = _order(oid)
        pdf = render_invoice_pdf(o) if doc == "invoice" else render_label_pdf(o)
        resp = HttpResponse(pdf, content_type="application/pdf")
        resp["Content-Disposition"] = f'inline; filename="{o.number}-{doc}.pdf"'
        return resp


# ================================================================ customers
class AdminCustomersView(APIView):
    permission_classes = [AdminPerm("customers.view")]

    def get(self, request):
        q = request.query_params
        cursor, limit = page_params(request, 50, 200)
        qs = User.objects.filter(deleted_at__isnull=True, rider__isnull=True).annotate(order_count=Count("orders", filter=~Q(orders__status__in=["CANCELLED", "FAILED"])), ltv=Sum("orders__total", filter=Q(orders__status="DELIVERED")), last_order=Max("orders__placed_at"))
        if q.get("q"):
            t = q["q"].strip()
            qs = qs.filter(Q(name__icontains=t) | Q(phone__icontains=t) | Q(email__icontains=t))
        if q.get("type"):
            qs = qs.filter(customer_type=q["type"])
        if q.get("blocked") == "1":
            qs = qs.filter(is_blocked=True)
        if q.get("segment") == "vip":
            qs = qs.filter(ltv__gte=int(q.get("ltvMin", 500000)))
        elif q.get("segment") == "lapsed":
            qs = qs.filter(last_order__lt=timezone.now() - timedelta(days=60))
        elif q.get("segment") == "new":
            qs = qs.filter(created_at__gte=timezone.now() - timedelta(days=30))
        rows, nxt = keyset(qs, ["-created_at", "-id"], cursor, limit)
        return Response({"items": [{"id": str(u.id), "name": u.display_name, "phone": u.phone, "email": u.email, "customerType": u.customer_type, "wholesaleApproved": u.wholesale_approved, "orders": u.order_count, "ltv": u.ltv or 0, "lastOrderAt": u.last_order.isoformat() if u.last_order else None, "blocked": u.is_blocked, "createdAt": u.created_at.isoformat(), "loyaltyPoints": u.loyalty_points} for u in rows], "nextCursor": nxt})


class AdminCustomerView(APIView):
    permission_classes = [AdminPerm("customers.view")]

    def get(self, request, uid):
        u = User.objects.filter(id=uid).select_related("customer_group").first()
        if u is None:
            raise ApiError.not_found("Customer")
        orders = Order.objects.filter(user=u).order_by("-placed_at")
        agg = orders.filter(status="DELIVERED").aggregate(ltv=Sum("total"), aov=Avg("total"), n=Count("id"))
        from catalog.models import PriceList

        return Response({
            "id": str(u.id), "name": u.display_name, "phone": u.phone, "email": u.email, "customerType": u.customer_type, "wholesaleApproved": u.wholesale_approved,
            "group": {"id": str(u.customer_group_id), "name": u.customer_group.name} if u.customer_group_id else None, "blocked": u.is_blocked, "blockedReason": u.blocked_reason or None,
            "styleProfile": u.style_profile, "loyaltyPoints": u.loyalty_points, "createdAt": u.created_at.isoformat(), "lastSeenAt": u.last_seen_at.isoformat() if u.last_seen_at else None,
            "identities": list(u.identities.values_list("provider", flat=True)),
            "stats": {"ltv": agg["ltv"] or 0, "aov": int(agg["aov"] or 0), "delivered": agg["n"], "orders": orders.count(), "cancelled": orders.filter(status="CANCELLED").count()},
            "orders": [_row(o) for o in orders.select_related("user", "store", "delivery__rider__user").prefetch_related("items")[:20]],
            "wholesaleApplications": [_app_out(a) for a in u.wholesale_applications.order_by("-created_at")],
            "priceLists": [{"id": str(p.id), "name": p.name, "active": p.active} for p in PriceList.objects.filter(Q(customer=u) | Q(group_id=u.customer_group_id) if u.customer_group_id else Q(customer=u))],
        })

    def patch(self, request, uid):
        require_perm(request, "customers.manage")
        u = User.objects.filter(id=uid).first()
        if u is None:
            raise ApiError.not_found("Customer")
        d = request.data or {}
        before = {"blocked": u.is_blocked, "type": u.customer_type, "group": str(u.customer_group_id or "")}
        if "blocked" in d:
            u.is_blocked = bool(d["blocked"])
            u.blocked_reason = (d.get("reason") or "")[:240] if u.is_blocked else ""
            if u.is_blocked:
                from accounts.tokens import revoke_all

                revoke_all(u, "blocked")
        if "groupId" in d:
            u.customer_group_id = d["groupId"] or None
        if "customerType" in d:
            if d["customerType"] not in ("RETAIL", "WHOLESALE"):
                raise ApiError.bad_request("Unknown customer type")
            require_perm(request, "wholesale.approve")
            u.customer_type = d["customerType"]
            u.wholesale_approved = d["customerType"] == "WHOLESALE"
        u.save()
        audit("customer.update", "user", u.id, request=request, before=before, after={"blocked": u.is_blocked, "type": u.customer_type, "group": str(u.customer_group_id or "")})
        return self.get(request, uid)


def _app_out(a: WholesaleApplication) -> dict:
    return {"id": str(a.id), "status": a.status, "businessName": a.business_name, "tin": a.tin, "businessType": a.business_type or None, "address": a.address or None, "expectedMonthlyVolume": a.expected_monthly_volume or None,
            "licence": media_out(a.licence) if a.licence_id else None, "reviewNote": a.review_note or None, "reviewedAt": a.reviewed_at.isoformat() if a.reviewed_at else None, "submittedAt": a.created_at.isoformat(),
            "customer": {"id": str(a.user_id), "name": a.user.display_name, "phone": a.user.phone}}


class AdminWholesaleView(APIView):
    permission_classes = [AdminPerm("customers.view")]

    def get(self, request):
        status = request.query_params.get("status", "PENDING")
        rows = WholesaleApplication.objects.select_related("user", "licence").filter(status=status).order_by("created_at")[:200]
        return Response({"items": [_app_out(a) for a in rows], "counts": dict(WholesaleApplication.objects.values("status").annotate(n=Count("id")).values_list("status", "n"))})


class AdminWholesaleDecisionView(APIView):
    permission_classes = [AdminPerm("wholesale.approve")]

    @transaction.atomic
    def post(self, request, aid):
        a = WholesaleApplication.objects.select_for_update(of=("self",)).select_related("user").filter(id=aid).first()
        if a is None:
            raise ApiError.not_found("Application")
        if a.status != "PENDING":
            raise ApiError.conflict("decided", "This application was already reviewed")
        decision = request.data.get("decision")
        if decision not in ("approve", "reject"):
            raise ApiError.bad_request("decision must be approve or reject")
        note = (request.data.get("note") or "").strip()
        if decision == "reject" and not note:
            raise ApiError.bad_request("Tell the customer why (they will see this note)")
        a.status = "APPROVED" if decision == "approve" else "REJECTED"
        a.review_note, a.reviewed_by, a.reviewed_at = note, request.user.admin, timezone.now()
        a.save()
        u = a.user
        if decision == "approve":
            u.customer_type, u.wholesale_approved = "WHOLESALE", True
            if request.data.get("groupId"):
                u.customer_group_id = request.data["groupId"]
            u.save()
            from notifications.service import notify

            notify(u, "wholesale.approved", {"businessName": a.business_name}, data={"screen": "wholesale"})
        audit(f"wholesale.{decision}", "wholesale_application", a.id, request=request, meta={"note": note})
        return Response(_app_out(a))


# ================================================================ reviews & returns & promos
class AdminReviewsView(APIView):
    permission_classes = [AdminPerm("reviews.moderate")]

    def get(self, request):
        status = request.query_params.get("status", "PENDING")
        cursor, limit = page_params(request, 50, 100)
        qs = Review.objects.filter(status=status).select_related("user", "product").prefetch_related("media")
        rows, nxt = keyset(qs, ["-created_at", "-id"], cursor, limit)
        return Response({"items": [{"id": str(r.id), "rating": r.rating, "title": r.title, "body": r.body, "tags": r.tags, "verified": r.verified, "media": [media_out(m) for m in r.media.all()], "product": {"id": str(r.product_id), "title": r.product.title, "slug": r.product.slug}, "author": r.user.display_name, "createdAt": r.created_at.isoformat(), "status": r.status} for r in rows], "nextCursor": nxt, "counts": dict(Review.objects.values("status").annotate(n=Count("id")).values_list("status", "n"))})


class AdminReviewView(APIView):
    permission_classes = [AdminPerm("reviews.moderate")]

    def post(self, request, rid):
        from .views import refresh_rating

        r = Review.objects.filter(id=rid).select_related("product").first()
        if r is None:
            raise ApiError.not_found("Review")
        st = request.data.get("status")
        if st not in ("PUBLISHED", "REJECTED"):
            raise ApiError.bad_request("status must be PUBLISHED or REJECTED")
        r.status, r.moderation_note, r.moderated_by = st, (request.data.get("note") or "")[:240], request.user.admin
        r.save()
        refresh_rating(r.product)
        audit("review.moderate", "review", r.id, request=request, meta={"status": st})
        return Response({"ok": True})


class AdminReturnsView(APIView):
    permission_classes = [AdminPerm("returns.manage")]

    def get(self, request):
        status = request.query_params.get("status")
        qs = ReturnRequest.objects.select_related("order", "user").prefetch_related("media").order_by("-created_at")
        if status:
            qs = qs.filter(status=status)
        items = []
        for rr in qs[:200]:
            oi = {i.id: i for i in rr.order.items.all()}
            items.append({"id": str(rr.id), "kind": rr.kind, "status": rr.status, "reason": rr.reason, "comment": rr.comment or None, "media": [media_out(m) for m in rr.media.all()], "order": {"id": str(rr.order_id), "number": rr.order.number}, "customer": rr.user.display_name,
                          "items": [{"title": oi[x["orderItemId"]].title if x["orderItemId"] in oi else "?", "options": oi[x["orderItemId"]].options_label if x["orderItemId"] in oi else "", "qty": x["qty"], "unitPrice": oi[x["orderItemId"]].unit_price if x["orderItemId"] in oi else 0} for x in rr.items],
                          "refundAmount": rr.refund_amount, "resolutionNote": rr.resolution_note or None, "createdAt": rr.created_at.isoformat()})
        return Response({"items": items})


class AdminReturnView(APIView):
    permission_classes = [AdminPerm("returns.manage")]
    FLOW = {"REQUESTED": ["APPROVED", "REJECTED"], "APPROVED": ["RECEIVED", "CANCELLED"], "RECEIVED": ["REFUNDED", "EXCHANGED"]}

    @transaction.atomic
    def post(self, request, rid):
        rr = ReturnRequest.objects.select_for_update(of=("self",)).select_related("order").filter(id=rid).first()
        if rr is None:
            raise ApiError.not_found("Return")
        to = request.data.get("status")
        if to not in self.FLOW.get(rr.status, []):
            raise ApiError.conflict("invalid_transition", f"A {rr.status.lower()} return can't become {str(to).lower()}")
        rr.status, rr.handled_by = to, request.user.admin
        rr.resolution_note = (request.data.get("note") or rr.resolution_note)[:2000]
        if to == "RECEIVED":
            from catalog.models import ProductVariant
            from inventory.services import adjust

            items = {i.id: i for i in rr.order.items.all()}
            for x in rr.items:
                oi = items.get(x["orderItemId"])
                if oi and oi.variant_id:
                    adjust(rr.order.store, ProductVariant.objects.get(id=oi.variant_id), x["qty"], reason="return", note=f"Return {rr.order.number}", admin=request.user.admin)
        if to == "REFUNDED":
            require_perm(request, "orders.refund")
            items = {i.id: i for i in rr.order.items.all()}
            amount = int(request.data.get("amount") or sum(items[x["orderItemId"]].unit_price * x["qty"] for x in rr.items if x["orderItemId"] in items))
            pay_svc.refund(rr.order, amount, admin=request.user.admin, reason=f"Return {rr.id}")
            rr.refund_amount = amount
        rr.save()
        audit("return.update", "return", rr.id, request=request, meta={"status": to})
        return Response({"ok": True, "status": rr.status})


def promo_out(p: PromoCode) -> dict:
    return {"id": str(p.id), "code": p.code, "description": p.description or None, "type": p.type, "value": p.value, "minSubtotal": p.min_subtotal, "maxDiscount": p.max_discount, "startsAt": p.starts_at.isoformat() if p.starts_at else None, "endsAt": p.ends_at.isoformat() if p.ends_at else None, "usageLimit": p.usage_limit, "usedCount": p.used_count, "perCustomerLimit": p.per_customer_limit, "customerTypes": p.customer_types, "categoryIds": p.category_ids, "firstOrderOnly": p.first_order_only, "active": p.active}


class AdminPromosView(APIView):
    permission_classes = [AdminPerm("marketing.manage")]

    def get(self, request):
        return Response({"items": [promo_out(p) for p in PromoCode.objects.order_by("-created_at")]})

    def post(self, request):
        p = PromoCode()
        _apply_promo(p, request.data or {})
        audit("promo.create", "promo", p.id, request=request, after=promo_out(p))
        return Response(promo_out(p), status=201)


class AdminPromoView(APIView):
    permission_classes = [AdminPerm("marketing.manage")]

    def patch(self, request, pid):
        p = PromoCode.objects.filter(id=pid).first()
        if p is None:
            raise ApiError.not_found("Promo code")
        before = promo_out(p)
        _apply_promo(p, request.data or {})
        audit("promo.update", "promo", p.id, request=request, before=before, after=promo_out(p))
        return Response(promo_out(p))


def _apply_promo(p: PromoCode, d: dict) -> None:
    if "code" in d or not p.code:
        code = "".join(ch for ch in (d.get("code") or "").upper() if ch.isalnum() or ch in "-_")[:40]
        if len(code) < 3:
            raise ApiError.bad_request("Codes need at least 3 letters or numbers")
        if PromoCode.objects.filter(code__iexact=code).exclude(id=p.id).exists():
            raise ApiError.conflict("duplicate_code", "That code already exists")
        p.code = code
    if "type" in d or not p.type:
        if d.get("type") not in ("PERCENT", "FIXED", "FREE_DELIVERY"):
            raise ApiError.bad_request("type must be PERCENT, FIXED or FREE_DELIVERY")
        p.type = d["type"]
    fields = {"description": "description", "value": "value", "minSubtotal": "min_subtotal", "maxDiscount": "max_discount", "startsAt": "starts_at", "endsAt": "ends_at", "usageLimit": "usage_limit", "perCustomerLimit": "per_customer_limit", "customerTypes": "customer_types", "categoryIds": "category_ids", "firstOrderOnly": "first_order_only", "active": "active"}
    for k, f in fields.items():
        if k in d:
            setattr(p, f, d[k] if d[k] is not None or f not in ("description",) else "")
    if p.type == "PERCENT" and not 1 <= int(p.value or 0) <= 10000:
        raise ApiError.bad_request("Percent is in basis points: 1000 = 10%")
    if p.type == "FIXED" and int(p.value or 0) <= 0:
        raise ApiError.bad_request("Set the discount amount")
    p.save()


# ================================================================ dashboard & reports
class AdminDashboardView(APIView):
    permission_classes = [AdminPerm("dashboard.view")]

    def get(self, request):
        from catalog.models import Product
        from delivery.models import Rider
        from inventory.models import InventoryLevel

        now = timezone.localtime()
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        today = Order.objects.filter(placed_at__gte=start).exclude(status__in=["FAILED"])
        valid = today.exclude(status__in=["CANCELLED", "PENDING_PAYMENT"])
        yday = Order.objects.filter(placed_at__gte=start - timedelta(days=1), placed_at__lt=now - timedelta(days=1)).exclude(status__in=["CANCELLED", "FAILED", "PENDING_PAYMENT"])
        sales = valid.aggregate(s=Sum("total"), n=Count("id"), aov=Avg("total"))
        ysales = yday.aggregate(s=Sum("total"), n=Count("id"))
        by_status = dict(Order.objects.filter(status__in=state.ORDER_ACTIVE + ["PENDING_PAYMENT"]).values("status").annotate(n=Count("id")).values_list("status", "n"))
        hourly = list(valid.annotate(h=TruncHour("placed_at")).values("h").annotate(s=Sum("total"), n=Count("id")).order_by("h"))
        days = list(Order.objects.filter(placed_at__gte=start - timedelta(days=13)).exclude(status__in=["CANCELLED", "FAILED", "PENDING_PAYMENT"]).annotate(d=TruncDate("placed_at")).values("d").annotate(s=Sum("total"), n=Count("id")).order_by("d"))
        top = list(OrderItem.objects.filter(order__placed_at__gte=start - timedelta(days=6)).exclude(order__status__in=["CANCELLED", "FAILED"]).values("product_id", "title").annotate(qty=Sum("qty"), revenue=Sum("line_total")).order_by("-revenue")[:8])
        low = list(InventoryLevel.objects.filter(on_hand__lte=F("low_stock_threshold"), variant__is_active=True, variant__product__status="PUBLISHED").select_related("variant__product", "store").order_by("on_hand")[:10])
        sessions_key = f"sw:metrics:sessions:{now:%Y%m%d}"
        try:
            from core import settings_service

            visitors = int(settings_service.redis_client().pfcount(sessions_key))
        except Exception:  # noqa: BLE001
            visitors = 0
        buyers = valid.values("user_id").distinct().count()
        return Response({
            "currency": "TZS",
            "today": {"sales": sales["s"] or 0, "orders": sales["n"], "aov": int(sales["aov"] or 0), "visitors": visitors, "conversion": round(buyers / visitors * 100, 1) if visitors else None},
            "yesterdaySameTime": {"sales": ysales["s"] or 0, "orders": ysales["n"]},
            "byStatus": by_status, "hourly": [{"hour": h["h"].isoformat(), "sales": h["s"], "orders": h["n"]} for h in hourly],
            "last14Days": [{"date": d["d"].isoformat(), "sales": d["s"], "orders": d["n"]} for d in days],
            "topProducts": [{"productId": str(t["product_id"]) if t["product_id"] else None, "title": t["title"], "qty": t["qty"], "revenue": t["revenue"]} for t in top],
            "lowStock": [{"sku": l.variant.sku, "title": l.variant.product.title, "store": l.store.name, "onHand": l.on_hand, "threshold": l.low_stock_threshold, "productId": str(l.variant.product_id)} for l in low],
            "riders": dict(Rider.objects.filter(status="ACTIVE").values("presence").annotate(n=Count("id")).values_list("presence", "n")),
            "needsRider": Order.objects.filter(delivery__status__in=["SEARCHING", "OFFERED", "NO_RIDER"]).count(),
            "pendingWholesale": WholesaleApplication.objects.filter(status="PENDING").count(), "pendingReviews": Review.objects.filter(status="PENDING").count(),
            "products": Product.objects.filter(status="PUBLISHED", deleted_at__isnull=True).count(),
        })


class AdminReportsView(APIView):
    permission_classes = [AdminPerm("reports.view")]

    def get(self, request, report: str):
        q = request.query_params
        frm = parse_date(q.get("from") or "") or (timezone.localdate() - timedelta(days=29))
        to = parse_date(q.get("to") or "") or timezone.localdate()
        base = Order.objects.filter(placed_at__date__gte=frm, placed_at__date__lte=to)
        done = base.exclude(status__in=["CANCELLED", "FAILED", "PENDING_PAYMENT"])
        if report == "sales":
            rows = list(done.annotate(d=TruncDate("placed_at")).values("d").annotate(orders=Count("id"), revenue=Sum("total"), discount=Sum("discount"), delivery=Sum("delivery_fee"), tax=Sum("tax")).order_by("d"))
            data = [{"date": r["d"].isoformat(), **{k: r[k] or 0 for k in ("orders", "revenue", "discount", "delivery", "tax")}} for r in rows]
            split = list(done.values("customer_type").annotate(revenue=Sum("total"), orders=Count("id")))
            extra = {"byCustomerType": split, "byPayment": list(done.values("payment_method").annotate(revenue=Sum("total"), orders=Count("id")))}
        elif report == "products":
            data = list(OrderItem.objects.filter(order__in=done).values("product_id", "title", "brand").annotate(units=Sum("qty"), revenue=Sum("line_total"), wholesaleUnits=Sum("qty", filter=~Q(price_basis="retail"))).order_by("-revenue")[:500])
            for r in data:
                r["product_id"] = str(r["product_id"]) if r["product_id"] else None
            from catalog.models import Category

            extra = {"byRoot": [{"root": c.name, "revenue": OrderItem.objects.filter(order__in=done, product__category_links__category__path__startswith=c.path).aggregate(s=Sum("line_total"))["s"] or 0} for c in Category.objects.filter(parent__isnull=True)]}
        elif report == "riders":
            from delivery.models import DeliveryJob, Rider

            data = []
            for r in Rider.objects.select_related("user"):
                jobs = DeliveryJob.objects.filter(rider=r, completed_at__date__gte=frm, completed_at__date__lte=to)
                dur = jobs.annotate(t=ExpressionWrapper(F("completed_at") - F("accepted_at"), output_field=DurationField())).aggregate(a=Avg("t"))["a"]
                data.append({"riderId": str(r.id), "name": r.user.name, "deliveries": jobs.count(), "earnings": jobs.aggregate(s=Sum("earning"))["s"] or 0, "avgMinutes": round(dur.total_seconds() / 60, 1) if dur else None, "rating": r.rating_avg, "acceptance": _acceptance(r, frm, to)})
            data.sort(key=lambda x: -x["deliveries"])
            extra = {}
        elif report == "delivery-times":
            from delivery.models import DeliveryJob

            jobs = DeliveryJob.objects.filter(completed_at__date__gte=frm, completed_at__date__lte=to).select_related("order")
            buckets = {"<30": 0, "30–45": 0, "45–60": 0, "60–90": 0, "90+": 0}
            on_time = 0
            for j in jobs:
                mins = (j.completed_at - j.order.placed_at).total_seconds() / 60
                k = "<30" if mins < 30 else "30–45" if mins < 45 else "45–60" if mins < 60 else "60–90" if mins < 90 else "90+"
                buckets[k] += 1
                on_time += 1 if j.order.promised_by and j.completed_at <= j.order.promised_by else 0
            data = [{"bucket": k, "orders": v} for k, v in buckets.items()]
            extra = {"onTimeRate": round(on_time / jobs.count() * 100, 1) if jobs.count() else None, "total": jobs.count()}
        elif report == "heatmap":
            data = [{"lat": round(o.destination.y, 3), "lng": round(o.destination.x, 3), "weight": 1} for o in base.filter(destination__isnull=False).only("destination")[:5000]]
            extra = {}
        else:
            raise ApiError.not_found("Report")
        if q.get("format") == "csv" and data:
            buf = io.StringIO()
            w = csv.DictWriter(buf, fieldnames=list(data[0].keys()))
            w.writeheader()
            w.writerows(data)
            resp = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
            resp["Content-Disposition"] = f'attachment; filename="{report}-{frm}-{to}.csv"'
            return resp
        return Response({"from": frm.isoformat(), "to": to.isoformat(), "rows": data, **extra})


def _acceptance(rider, frm, to) -> float | None:
    from delivery.models import DeliveryOffer

    qs = DeliveryOffer.objects.filter(rider=rider, offered_at__date__gte=frm, offered_at__date__lte=to).exclude(status="WITHDRAWN")
    n = qs.count()
    return round(qs.filter(status="ACCEPTED").count() / n * 100, 1) if n else None
