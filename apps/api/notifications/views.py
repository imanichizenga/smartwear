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
    return {"id": m.id, "sender": m.sender_type, "name": name.split(" ")[0] if m.sender_type != "staff" else f"{name.split(' ')[0]} · SmartWear", "body": m.body, "media": media_out(m.media) if m.media_id else None, "at": m.created_at.isoformat()}


def thread_out(t: ChatThread, *, viewer: str) -> dict:
    last = t.messages.order_by("-created_at").first()
    unread = {"customer": t.unread_for_user, "rider": t.unread_for_rider, "staff": t.unread_for_staff}[viewer]
    return {"id": str(t.id), "kind": t.kind, "status": t.status, "subject": t.subject or None, "orderId": str(t.order_id) if t.order_id else None, "orderNumber": t.order.number if t.order_id else None,
            "customer": {"id": str(t.user_id), "name": t.user.display_name} if viewer != "customer" else None, "assignedTo": t.assigned_to.name if t.assigned_to_id else None,
            "lastMessage": message_out(last) if last else None, "lastMessageAt": t.last_message_at.isoformat() if t.last_message_at else None, "unread": unread}


def _post_message(t: ChatThread, sender: str, *, body: str, media_id=None, user=None, admin=None) -> ChatMessage:
    body = (body or "").strip()[:4000]
    if not body and not media_id:
        raise ApiError.bad_request("Write a message")
    with transaction.atomic():
        m = ChatMessage.objects.create(thread=t, sender_type=sender, sender_user=user, sender_admin=admin, body=body, media_id=media_id)
        upd = {"last_message_at": m.created_at}
        if sender == "customer":
            upd.update(unread_for_staff=F("unread_for_staff") + (1 if t.kind == "support" else 0), unread_for_rider=F("unread_for_rider") + (1 if t.kind == "order" else 0), status="open")
        elif sender == "rider":
            upd["unread_for_user"] = F("unread_for_user") + 1
        else:
            upd["unread_for_user"] = F("unread_for_user") + 1
        ChatThread.objects.filter(pk=t.pk).update(**upd)
    payload = {"type": "chat.message", "threadId": str(t.id), "message": message_out(m)}
    transaction.on_commit(lambda: broadcast(f"thread.{t.id}", payload))
    if sender != "customer":
        from .service import notify

        transaction.on_commit(lambda: _chat_push(t, m))
    return m


def _chat_push(t: ChatThread, m: ChatMessage) -> None:
    from .push import send_to_user

    try:
        send_to_user(t.user, "New message" if m.sender_type == "staff" else "Your rider", m.body[:120] or "Sent a photo", {"threadId": str(t.id), "orderId": str(t.order_id) if t.order_id else None}, channel="orders" if t.kind == "order" else "default")
    except Exception:  # noqa: BLE001
        pass


class ThreadsView(APIView):
    permission_classes = [IsAppUser]

    def get(self, request):
        qs = ChatThread.objects.select_related("order", "user", "assigned_to")
        if request.user.kind == "rider" and request.query_params.get("as") == "rider":
            rows = qs.filter(rider__user=request.user.user).order_by("-last_message_at")[:50]
            return Response({"items": [thread_out(t, viewer="rider") for t in rows]})
        return Response({"items": [thread_out(t, viewer="customer") for t in qs.filter(user=request.user.user).order_by("-last_message_at")[:50]]})

    def post(self, request):
        """Open (or reuse) a support thread, or the customer↔rider thread of an active order."""
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
            t = ChatThread.objects.filter(kind="support", user=user, status__in=["open", "pending"]).first() or ChatThread.objects.create(kind="support", user=user, subject=(d.get("subject") or "")[:120], order_id=d.get("orderId"))
        if d.get("body"):
            sender = "rider" if t.kind == "order" and t.rider and t.rider.user_id == user.id else "customer"
            _post_message(t, sender, body=d["body"], media_id=d.get("mediaId"), user=user)
        return Response(thread_out(t, viewer="customer"), status=201)


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
        t, who = self._thread(request, tid)
        cursor, limit = page_params(request, 40, 100)
        rows, nxt = keyset(ChatMessage.objects.filter(thread=t).select_related("sender_user", "sender_admin", "media"), ["-created_at", "-id"], cursor, limit)
        field = {"customer": "unread_for_user", "rider": "unread_for_rider", "staff": "unread_for_staff"}[who]
        ChatThread.objects.filter(pk=t.pk).update(**{field: 0})
        return Response({"thread": thread_out(t, viewer=who), "items": [message_out(m) for m in reversed(rows)], "nextCursor": nxt})

    def post(self, request, tid):
        t, who = self._thread(request, tid)
        p = request.user
        m = _post_message(t, who, body=request.data.get("body") or "", media_id=request.data.get("mediaId"), user=p.user if p.kind != "admin" else None, admin=p.admin if p.kind == "admin" else None)
        if who == "staff" and t.status == "open":
            ChatThread.objects.filter(pk=t.pk).update(status="pending", assigned_to=t.assigned_to or p.admin)
        return Response(message_out(m), status=201)


class AdminSupportInboxView(APIView):
    permission_classes = [AdminPerm("support.chat")]

    def get(self, request):
        st = request.query_params.get("status")
        qs = ChatThread.objects.filter(kind="support").select_related("user", "order", "assigned_to")
        if st:
            qs = qs.filter(status=st)
        if request.query_params.get("mine") == "1":
            qs = qs.filter(assigned_to=request.user.admin)
        return Response({"items": [thread_out(t, viewer="staff") for t in qs.order_by(F("last_message_at").desc(nulls_last=True))[:200]]})


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
