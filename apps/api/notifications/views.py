from __future__ import annotations

from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import AdminPerm, IsAdmin, IsAppUser
from core.exceptions import ApiError
from core.media_urls import media_out
from core.pagination import keyset, page_params

from .models import ChatMessage, ChatThread, Notification, PushToken
from .realtime import broadcast
from .service import notification_out


class PushTokenView(APIView):
    """Register this device for push (apps) — admins can also register to receive dispatch alerts and test pushes."""

    def post(self, request):
        p = request.user
        if p is None:
            raise ApiError.unauthorized()
        d = request.data or {}
        token = (d.get("token") or "").strip()
        if not token or len(token) > 300:
            raise ApiError.bad_request("Missing push token")
        provider = d.get("provider") or ("expo" if token.startswith("ExponentPushToken") else "fcm")
        defaults = {"provider": provider, "platform": (d.get("platform") or "")[:8], "device_id": (d.get("deviceId") or request.headers.get("X-Device-Id") or "")[:128], "disabled_at": None,
                    "user": p.user if p.kind != "admin" else None, "admin": p.admin if p.kind == "admin" else None, "locale": (getattr(p.user, "locale", "en") if p.kind != "admin" else "en")}
        PushToken.objects.update_or_create(token=token, defaults=defaults)
        return Response({"ok": True})

    def delete(self, request):
        PushToken.objects.filter(token=(request.data or {}).get("token") or request.query_params.get("token")).update(disabled_at=timezone.now())
        return Response({"ok": True})


class InboxView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request):
        cursor, limit = page_params(request, 30, 100)
        qs = Notification.objects.filter(user=request.user.user).select_related("image")
        if request.query_params.get("type"):
            qs = qs.filter(type=request.query_params["type"])
        rows, nxt = keyset(qs, ["-created_at", "-id"], cursor, limit)
        return Response({"items": [notification_out(n) for n in rows], "nextCursor": nxt, "unread": Notification.objects.filter(user=request.user.user, read_at__isnull=True).count()})

    def post(self, request):
        """Mark read: {ids: [...]} or {all: true}"""
        qs = Notification.objects.filter(user=request.user.user, read_at__isnull=True)
        if not request.data.get("all"):
            qs = qs.filter(id__in=request.data.get("ids") or [])
        n = qs.update(read_at=timezone.now())
        return Response({"marked": n, "unread": Notification.objects.filter(user=request.user.user, read_at__isnull=True).count()})


def message_out(m: ChatMessage) -> dict:
    name = (m.sender_admin.name if m.sender_admin_id else (m.sender_user.name if m.sender_user_id else "SmartWear")) or "SmartWear"
    return {
        "id": m.id, "clientId": m.client_id or None, "sender": m.sender_type,
        "name": name.split(" ")[0] if m.sender_type != "staff" else f"{name.split(' ')[0]} · SmartWear",
        "body": m.body, "media": media_out(m.media) if m.media_id else None, "at": m.created_at.isoformat(),
    }


def _order_context(o, *, viewer: str) -> dict | None:
    """The order every support conversation is about — shown as a banner (app) and a context card (admin)."""
    if o is None:
        return None
    from commerce.services.orders import STATUS_LABELS

    items = list(o.items.all()[:4])
    label = STATUS_LABELS.get(o.status, (o.status, o.status))
    out = {
        "id": str(o.id), "number": o.number, "status": o.status, "statusLabel": label[0], "statusLabelSw": label[1],
        "placedAt": o.placed_at.isoformat(), "total": o.total, "currency": o.currency, "itemCount": sum(i.qty for i in items) if len(items) < 4 else o.items.count(),
        "thumbnail": media_out(items[0].image) if items and items[0].image_id else None,
    }
    if viewer == "staff":
        out.update({
            "items": [{"title": i.title, "options": i.options_label, "qty": i.qty, "lineTotal": i.line_total} for i in items],
            "deliveryAddress": o.destination_label or None, "area": o.destination_area or None, "landmark": o.landmark_note or None,
            "location": {"mode": o.location_mode, "details": o.location_details or None, "notes": o.delivery_notes or None},
            "paymentMethod": o.payment_method, "paymentStatus": o.payment_status,
        })
    return out


def thread_out(t: ChatThread, *, viewer: str) -> dict:
    from .presence import presence_for

    last = t.messages.order_by("-created_at").first()
    unread = {"customer": t.unread_for_user, "rider": t.unread_for_rider, "staff": t.unread_for_staff}[viewer]
    other_read = t.staff_read_at if viewer == "customer" else (t.user_read_at if viewer == "staff" else None)
    return {
        "id": str(t.id), "kind": t.kind, "status": t.status, "subject": t.subject or None,
        "orderId": str(t.order_id) if t.order_id else None, "orderNumber": t.order.number if t.order_id else None,
        "order": _order_context(t.order, viewer=viewer) if t.kind == "support" and t.order_id else None,
        "customer": {"id": str(t.user_id), "name": t.user.display_name, "phone": t.user.phone} if viewer != "customer" else None,
        "assignedTo": t.assigned_to.name if t.assigned_to_id else None,
        "lastMessage": message_out(last) if last else None, "lastMessageAt": t.last_message_at.isoformat() if t.last_message_at else None, "unread": unread,
        # Read receipts: the other side has read everything up to this time.
        "otherReadAt": other_read.isoformat() if other_read else None,
        "presence": presence_for(viewer, t.user_id) if t.kind == "support" and viewer in ("customer", "staff") else None,
        "canReply": t.accepts_messages,
    }


def _post_message(t: ChatThread, sender: str, *, body: str, media_id=None, user=None, admin=None, client_id: str = "") -> tuple[ChatMessage, bool]:
    """Returns (message, created). A repeated client_id returns the original message (idempotent send)."""
    if not t.accepts_messages:
        raise ApiError.conflict("thread_closed", "This conversation isn't linked to an order. Start a new one from the order.")
    body = (body or "").strip()[:4000]
    client_id = (client_id or "")[:64]
    if not body and not media_id:
        raise ApiError.bad_request("Write a message")
    if client_id:
        dup = ChatMessage.objects.filter(thread=t, client_id=client_id).select_related("sender_user", "sender_admin", "media").first()
        if dup:
            return dup, False
    with transaction.atomic():
        m = ChatMessage.objects.create(thread=t, sender_type=sender, sender_user=user, sender_admin=admin, body=body, media_id=media_id, client_id=client_id)
        upd = {"last_message_at": m.created_at}
        if sender == "customer":
            upd.update(unread_for_staff=F("unread_for_staff") + (1 if t.kind == "support" else 0), unread_for_rider=F("unread_for_rider") + (1 if t.kind == "order" else 0), status="open", user_read_at=m.created_at)
        elif sender == "rider":
            upd["unread_for_user"] = F("unread_for_user") + 1
        else:
            upd.update(unread_for_user=F("unread_for_user") + 1, staff_read_at=m.created_at)
        ChatThread.objects.filter(pk=t.pk).update(**upd)
    payload = {"type": "chat.message", "threadId": str(t.id), "message": message_out(m)}
    transaction.on_commit(lambda: broadcast(f"thread.{t.id}", payload))
    if t.kind == "support":
        # Staff inbox lists update live too.
        transaction.on_commit(lambda: broadcast("support", {"type": "support.thread", "threadId": str(t.id), "orderNumber": t.order.number if t.order_id else None}))
    if sender != "customer":
        transaction.on_commit(lambda: _chat_push(t, m))
    else:
        transaction.on_commit(lambda: _staff_push(t, m))
    return m, True


def _chat_push(t: ChatThread, m: ChatMessage) -> None:
    """Push to the customer — unless they're looking at the thread right now or turned chat pushes off."""
    from .presence import is_viewing
    from .push import send_to_user

    try:
        if is_viewing(str(t.id), "user", str(t.user_id)):
            return
        if (t.user.notification_prefs or {}).get("chat", True) is False:
            return
        title = f"SmartWear · {t.order.number}" if t.kind == "support" and t.order_id else ("New message" if m.sender_type == "staff" else "Your rider")
        send_to_user(t.user, title, m.body[:120] or "Sent a photo", {"threadId": str(t.id), "orderId": str(t.order_id) if t.order_id else None, "type": "chat"}, channel="orders" if t.kind == "order" else "default")
    except Exception:  # noqa: BLE001
        pass


def _staff_push(t: ChatThread, m: ChatMessage) -> None:
    """A customer wrote: notify the assigned agent (or support staff) unless someone has the thread open."""
    if t.kind != "support":
        return
    from accounts.models import AdminUser

    from .presence import is_viewing
    from .push import send_to_admin

    try:
        if is_viewing(str(t.id), "staff"):
            return
        admins = [t.assigned_to] if t.assigned_to_id else [a for a in AdminUser.objects.filter(is_active=True).select_related("role")[:50] if a.has_perm_key("support.chat")]
        for a in admins:
            send_to_admin(a, f"{t.user.display_name} · {t.order.number if t.order_id else 'Support'}", m.body[:120] or "Sent a photo", {"threadId": str(t.id)})
    except Exception:  # noqa: BLE001
        pass


def _mark_read(t: ChatThread, who: str) -> None:
    now = timezone.now()
    if who == "customer":
        ChatThread.objects.filter(pk=t.pk).update(unread_for_user=0, user_read_at=now)
    elif who == "staff":
        ChatThread.objects.filter(pk=t.pk).update(unread_for_staff=0, staff_read_at=now)
    else:
        ChatThread.objects.filter(pk=t.pk).update(unread_for_rider=0)
        return
    transaction.on_commit(lambda: broadcast(f"thread.{t.id}", {"type": "chat.read", "threadId": str(t.id), "by": who, "at": now.isoformat()}))


def _support_thread_for(order, user) -> ChatThread:
    t, _ = ChatThread.objects.get_or_create(kind="support", order=order, defaults={"user": user, "subject": order.number})
    return t


class ThreadsView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request):
        qs = ChatThread.objects.select_related("order", "user", "assigned_to")
        if request.user.kind == "rider" and request.query_params.get("as") == "rider":
            rows = qs.filter(rider__user=request.user.user).order_by("-last_message_at")[:50]
            return Response({"items": [thread_out(t, viewer="rider") for t in rows]})
        qs = qs.filter(user=request.user.user)
        if request.query_params.get("orderId"):
            qs = qs.filter(order_id=request.query_params["orderId"])
        return Response({"items": [thread_out(t, viewer="customer") for t in qs.order_by(F("last_message_at").desc(nulls_last=True))[:50]]})

    def post(self, request):
        """Open the support conversation of one of the shopper's orders (one per order), or the customer↔rider
        thread of an active delivery."""
        from commerce.models import Order

        d = request.data or {}
        user = request.user.user
        if d.get("orderId") and d.get("kind") == "order":
            from delivery.state import RIDER_HOLDS

            o = Order.objects.select_related("delivery__rider").filter(id=d["orderId"]).filter(Q(user=user) | Q(delivery__rider__user=user)).first()
            if o is None or not hasattr(o, "delivery") or not o.delivery.rider_id or o.delivery.status not in RIDER_HOLDS:
                raise ApiError.bad_request("Chat with the rider is available while your delivery is active")
            t, _ = ChatThread.objects.get_or_create(kind="order", order=o, defaults={"user": o.user, "rider": o.delivery.rider, "subject": o.number})
            if t.rider_id != o.delivery.rider_id:
                t.rider = o.delivery.rider
                t.save(update_fields=["rider"])
        else:
            if not d.get("orderId"):
                raise ApiError.bad_request("Choose the order you need help with", details={"field": "orderId"})
            o = Order.objects.filter(id=d["orderId"], user=user).first()
            if o is None:
                raise ApiError.not_found("Order")
            t = _support_thread_for(o, user)
        if d.get("body"):
            sender = "rider" if t.kind == "order" and t.rider and t.rider.user_id == user.id else "customer"
            _post_message(t, sender, body=d["body"], media_id=d.get("mediaId"), user=user, client_id=d.get("clientId") or "")
            t.refresh_from_db()
        return Response(thread_out(t, viewer="customer"), status=201)


class SupportHubView(APIView):
    """`GET /v1/chat/support` — the Help hub: the shopper's recent orders, each with its conversation (if any)."""

    permission_classes = [IsAppUser]

    def get(self, request):
        from commerce.models import Order

        user = request.user.user
        orders = list(Order.objects.filter(user=user).order_by("-placed_at").prefetch_related("items")[:30])
        threads = {t.order_id: t for t in ChatThread.objects.filter(kind="support", user=user, order__in=orders).select_related("order", "user", "assigned_to")}
        # Orders with recent conversation activity first, then the newest orders (stable sort keeps order).
        def key(o):
            t = threads.get(o.id)
            return (t is None or t.last_message_at is None, -(t.last_message_at.timestamp() if t and t.last_message_at else 0))

        items = [{"order": _order_context(o, viewer="customer"), "thread": thread_out(threads[o.id], viewer="customer") if o.id in threads else None} for o in sorted(orders, key=key)]
        from .presence import presence_for

        return Response({"items": items, "unread": sum(t.unread_for_user for t in threads.values()), "presence": presence_for("customer", user.id)})


class ThreadMessagesView(APIView):
    def _thread(self, request, tid) -> tuple[ChatThread, str]:
        p = request.user
        if p is None:
            raise ApiError.unauthorized()
        t = ChatThread.objects.select_related("rider__user", "user", "order").filter(id=tid).first()
        if t is None:
            raise ApiError.not_found("Conversation")
        if p.kind == "admin":
            if not p.admin.has_perm_key("support.chat"):
                raise ApiError.forbidden()
            return t, "staff"
        if t.user_id == p.user.id:
            return t, "customer"
        if t.kind == "order" and t.rider and t.rider.user_id == p.user.id:
            from delivery.state import RIDER_HOLDS

            if t.order.delivery.status not in RIDER_HOLDS:
                raise ApiError.forbidden("This delivery is finished")
            return t, "rider"
        raise ApiError.not_found("Conversation")

    def get(self, request, tid):
        """Newest page first (`?cursor=` loads older); opening the thread marks it read."""
        t, who = self._thread(request, tid)
        cursor, limit = page_params(request, 40, 100)
        rows, nxt = keyset(ChatMessage.objects.filter(thread=t).select_related("sender_user", "sender_admin", "media"), ["-created_at", "-id"], cursor, limit)
        if not cursor:
            _mark_read(t, who)
            t.refresh_from_db()
        return Response({"thread": thread_out(t, viewer=who), "items": [message_out(m) for m in reversed(rows)], "nextCursor": nxt})

    def post(self, request, tid):
        t, who = self._thread(request, tid)
        p = request.user
        m, created = _post_message(
            t, who, body=request.data.get("body") or "", media_id=request.data.get("mediaId"), client_id=request.data.get("clientId") or "",
            user=p.user if p.kind != "admin" else None, admin=p.admin if p.kind == "admin" else None,
        )
        if created and who == "staff" and t.status == "open":
            ChatThread.objects.filter(pk=t.pk).update(status="pending", assigned_to=t.assigned_to or p.admin)
        return Response(message_out(m), status=201 if created else 200)


class ThreadReadView(ThreadMessagesView):
    """`POST /v1/chat/threads/<id>/read` — mark read while the thread is on screen (new messages arrived)."""

    def get(self, request, tid):  # pragma: no cover - not routed for GET
        raise ApiError.not_found("Conversation")

    def post(self, request, tid):
        t, who = self._thread(request, tid)
        _mark_read(t, who)
        return Response({"ok": True})


class AdminSupportInboxView(APIView):
    permission_classes = [AdminPerm("support.chat")]

    def get(self, request):
        st = request.query_params.get("status")
        qs = ChatThread.objects.filter(kind="support").select_related("user", "order", "assigned_to").prefetch_related("order__items")
        if st:
            qs = qs.filter(status=st)
        if request.query_params.get("mine") == "1":
            qs = qs.filter(assigned_to=request.user.admin)
        q = (request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(order__number__icontains=q) | Q(user__name__icontains=q) | Q(user__phone__icontains=q))
        rows = qs.order_by(F("last_message_at").desc(nulls_last=True))[:200]
        return Response({"items": [thread_out(t, viewer="staff") for t in rows], "unread": sum(t.unread_for_staff for t in rows)})

    def post(self, request):
        """Open (or create) the support conversation of an order — "Message customer" on the order page."""
        from commerce.models import Order

        o = Order.objects.select_related("user").filter(id=(request.data or {}).get("orderId")).first()
        if o is None:
            raise ApiError.not_found("Order")
        t = _support_thread_for(o, o.user)
        if (request.data or {}).get("body"):
            _post_message(t, "staff", body=request.data["body"], admin=request.user.admin, client_id=request.data.get("clientId") or "")
            ChatThread.objects.filter(pk=t.pk, assigned_to__isnull=True).update(assigned_to=request.user.admin)
            t.refresh_from_db()
        return Response(thread_out(t, viewer="staff"), status=201)


class AdminThreadView(APIView):
    permission_classes = [AdminPerm("support.chat")]

    def patch(self, request, tid):
        t = ChatThread.objects.filter(id=tid).first()
        if t is None:
            raise ApiError.not_found("Conversation")
        if request.data.get("status") in ("open", "pending", "closed"):
            t.status = request.data["status"]
        if "assignToMe" in request.data:
            t.assigned_to = request.user.admin if request.data["assignToMe"] else None
        t.save()
        return Response(thread_out(t, viewer="staff"))


class AdminPushTokenStatusView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response({"devices": PushToken.objects.filter(admin=request.user.admin, disabled_at__isnull=True).count()})
