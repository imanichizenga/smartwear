"""
One socket per app session. Client messages:
  {"type": "subscribe", "channel": "order.<id>" | "dispatch" | "thread.<id>" | "media"}
  {"type": "unsubscribe", "channel": ...}
  {"type": "ping"}                                   (heartbeat: also refreshes online presence)
  {"type": "chat.typing", "threadId": "<id>"}         (throttled; relayed to the thread room)
  {"type": "rider.location", lat, lng, heading?, speed?, accuracy?, battery?}   (riders, low-latency path)
Every subscription is authorised against the database (customers only see their orders, etc.).
"""
from __future__ import annotations

import json
import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .realtime import group_name


class RealtimeConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.principal = self.scope.get("principal")
        if self.principal is None:
            await self.close(code=4401)
            return
        self.groups_joined: set[str] = set()
        await self.accept()
        p = self.principal
        if p.kind in ("customer", "rider"):
            await self._join(f"user.{p.user.id}")
        if p.kind == "rider":
            rid = await self._rider_id()
            if rid:
                await self._join(f"rider.{rid}")
        self._typing_at = 0.0
        self._viewing: set[str] = set()
        await self._presence(True)
        await self.send_json({"type": "hello", "kind": p.kind})

    async def disconnect(self, code):
        if getattr(self, "groups_joined", None) is not None:
            for tid in list(getattr(self, "_viewing", set())):
                await self._set_viewing(tid, False)
            await self._presence(False)
        for g in list(getattr(self, "groups_joined", [])):
            await self.channel_layer.group_discard(g, self.channel_name)

    # ------------------------------------------------------------ presence
    def _side(self) -> tuple[str, str] | None:
        p = self.principal
        if p.kind == "admin":
            return ("staff", str(p.admin.id)) if p.admin.has_perm_key("support.chat") else None
        return ("user", str(p.user.id)) if p.kind == "customer" else None

    @database_sync_to_async
    def _presence(self, online: bool, heartbeat: bool = False) -> None:
        from . import presence
        from .models import ChatThread
        from .realtime import broadcast

        side = self._side()
        if side is None:
            return
        changed = presence.touch(*side) if online else presence.leave(*side)
        if not changed or heartbeat and not changed:
            return
        if side[0] == "staff":
            # Staff coming online/offline matters only when it changes "is anyone from support here".
            any_online = presence.staff_online()
            if online and any_online or not online and not any_online:
                broadcast("support.presence", {"type": "presence.changed", "who": "staff", "online": any_online, "lastSeenAt": None if any_online else presence.last_seen("staff")})
        else:
            ev = {"type": "presence.changed", "who": "customer", "userId": side[1], "online": online, "lastSeenAt": None if online else presence.last_seen("user", side[1])}
            for tid in ChatThread.objects.filter(kind="support", user_id=side[1]).exclude(status="closed").values_list("id", flat=True)[:20]:
                broadcast(f"thread.{tid}", {**ev, "threadId": str(tid)})

    @database_sync_to_async
    def _set_viewing(self, tid: str, on: bool) -> None:
        from .presence import set_viewing

        side = self._side() or (("user", str(self.principal.user.id)) if self.principal.kind == "rider" else None)
        if side:
            set_viewing(tid, side[0], side[1], on)

    async def _join(self, name: str):
        g = group_name(name)
        await self.channel_layer.group_add(g, self.channel_name)
        self.groups_joined.add(g)

    async def receive_json(self, content, **kwargs):
        t = content.get("type")
        if t == "ping":
            await self.send_json({"type": "pong"})
            await self._presence(True, heartbeat=True)
            for tid in list(self._viewing):
                await self._set_viewing(tid, True)
        elif t == "subscribe":
            ch = str(content.get("channel") or "")
            if await self._allowed(ch):
                await self._join(ch)
                if ch.startswith("thread."):
                    self._viewing.add(ch.partition(".")[2])
                    await self._set_viewing(ch.partition(".")[2], True)
                await self.send_json({"type": "subscribed", "channel": ch})
            else:
                await self.send_json({"type": "error", "code": "forbidden", "channel": ch})
        elif t == "unsubscribe":
            ch = str(content.get("channel") or "")
            g = group_name(ch)
            if g in self.groups_joined:
                await self.channel_layer.group_discard(g, self.channel_name)
                self.groups_joined.discard(g)
            if ch.startswith("thread."):
                self._viewing.discard(ch.partition(".")[2])
                await self._set_viewing(ch.partition(".")[2], False)
        elif t == "chat.typing":
            tid = str(content.get("threadId") or "")
            now = time.monotonic()
            # One typing event per 2 s per socket, and only for a thread this socket has joined.
            if tid in self._viewing and now - self._typing_at >= 2:
                self._typing_at = now
                await self.channel_layer.group_send(group_name(f"thread.{tid}"), {"type": "sw.event", "event": {"type": "chat.typing", "threadId": tid, "by": self._who(), "name": self._name()}, "exclude": self.channel_name})
        elif t == "rider.location" and self.principal.kind == "rider":
            res = await self._location(content)
            await self.send_json({"type": "rider.location.ack", **res})

    def _who(self) -> str:
        p = self.principal
        return "staff" if p.kind == "admin" else ("rider" if p.kind == "rider" else "customer")

    def _name(self) -> str:
        p = self.principal
        n = (p.admin.name if p.kind == "admin" else p.user.name) or ""
        return n.split(" ")[0] if n else ""

    async def sw_event(self, message):
        if message.get("exclude") == self.channel_name:
            return  # don't echo your own typing back
        event = message["event"]
        await self.send(text_data=json.dumps(event, default=str))
        # An admin blocked the account or a session was revoked: drop this socket if it belongs to that session.
        if event.get("type") == "session.revoked" and str(getattr(self.principal, "session_id", "") or "") in (event.get("sessionIds") or []):
            await self.close(code=4403)

    @database_sync_to_async
    def _rider_id(self):
        from delivery.models import Rider

        return str(Rider.objects.filter(user=self.principal.user).values_list("id", flat=True).first() or "") or None

    @database_sync_to_async
    def _allowed(self, ch: str) -> bool:
        p = self.principal
        kind, _, ident = ch.partition(".")
        if p.kind == "admin":
            if kind == "dispatch":
                return p.admin.has_perm_key("dispatch.view")
            if kind == "order":
                return p.admin.has_perm_key("orders.view")
            if kind == "thread":
                return p.admin.has_perm_key("support.chat")
            if ch == "support":
                return p.admin.has_perm_key("support.chat")
            if kind == "media":
                return p.admin.has_perm_key("products.manage")
            return False
        if kind == "order":
            from commerce.models import Order
            from delivery.state import RIDER_HOLDS

            if Order.objects.filter(id=ident, user=p.user).exists():
                return True
            # Riders see the order room only while they hold the delivery (privacy rule).
            return p.kind == "rider" and Order.objects.filter(id=ident, delivery__rider__user=p.user, delivery__status__in=RIDER_HOLDS).exists()
        if ch == "support.presence":
            return True  # "is SmartWear support online" — no personal data
        if kind == "thread":
            from .models import ChatThread

            return ChatThread.objects.filter(id=ident).filter(user=p.user).exists() or (p.kind == "rider" and ChatThread.objects.filter(id=ident, rider__user=p.user).exists())
        return False

    @database_sync_to_async
    def _location(self, c: dict) -> dict:
        from core.exceptions import ApiError
        from delivery.models import Rider
        from delivery.services.dispatch import update_location

        try:
            r = Rider.objects.get(user=self.principal.user)
            return update_location(r, lat=float(c["lat"]), lng=float(c["lng"]), heading=c.get("heading"), speed=c.get("speed"), accuracy=c.get("accuracy"), battery=c.get("battery"))
        except (ApiError, KeyError, ValueError, TypeError) as e:
            return {"ok": False, "error": getattr(e, "message", str(e))}
