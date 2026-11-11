"""
One socket per app session. Client messages:
  {"type": "subscribe", "channel": "order.<id>" | "dispatch" | "thread.<id>" | "media"}
  {"type": "unsubscribe", "channel": ...}
  {"type": "ping"}
  {"type": "rider.location", lat, lng, heading?, speed?, accuracy?, battery?}   (riders, low-latency path)
Every subscription is authorised against the database (customers only see their orders, etc.).
"""
from __future__ import annotations

import json

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
        await self.send_json({"type": "hello", "kind": p.kind})

    async def disconnect(self, code):
        for g in list(getattr(self, "groups_joined", [])):
            await self.channel_layer.group_discard(g, self.channel_name)

    async def _join(self, name: str):
        g = group_name(name)
        await self.channel_layer.group_add(g, self.channel_name)
        self.groups_joined.add(g)

    async def receive_json(self, content, **kwargs):
        t = content.get("type")
        if t == "ping":
            await self.send_json({"type": "pong"})
        elif t == "subscribe":
            ch = str(content.get("channel") or "")
            if await self._allowed(ch):
                await self._join(ch)
                await self.send_json({"type": "subscribed", "channel": ch})
            else:
                await self.send_json({"type": "error", "code": "forbidden", "channel": ch})
        elif t == "unsubscribe":
            g = group_name(str(content.get("channel") or ""))
            if g in self.groups_joined:
                await self.channel_layer.group_discard(g, self.channel_name)
                self.groups_joined.discard(g)
        elif t == "rider.location" and self.principal.kind == "rider":
            res = await self._location(content)
            await self.send_json({"type": "rider.location.ack", **res})

    async def sw_event(self, message):
        await self.send(text_data=json.dumps(message["event"], default=str))

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
