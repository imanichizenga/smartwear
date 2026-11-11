"""notify(): one call writes the inbox entry, sends the push (async) and, if enabled, the SMS — from DB templates."""
from __future__ import annotations

import logging
from typing import Any

from django.db import transaction

from core import settings_service
from core.integrations.beem import render_template

from .models import Notification

logger = logging.getLogger("smartwear.notify")

TYPE_FOR_KEY = {"order": "order", "drop": "drop", "wishlist": "price_drop", "wholesale": "wholesale", "rider": "rider"}


def _template(key: str, channel: str):
    for t in settings_service.get("notifications.templates").templates:
        if t.key == key and t.channel == channel:
            return t
    return None


def notify(user, key: str, variables: dict[str, Any] | None = None, *, data: dict | None = None, image_id=None, push: bool = True, inbox: bool = True) -> Notification | None:
    variables = variables or {}
    data = {"key": key, **(data or {})}
    locale = getattr(user, "locale", "en")
    prefs = user.notification_prefs or {}
    category = key.split(".")[0]
    t = _template(key, "push")
    n = None
    if t and t.enabled:
        body = render_template(t.bodySw if locale == "sw" and t.bodySw else t.body, **variables)
        title = render_template(t.title, **variables)
        if inbox:
            n = Notification.objects.create(user=user, type=TYPE_FOR_KEY.get(category, "system"), title=title, body=body, data=data, image_id=image_id)
        if push and prefs.get(category, True):
            from .tasks import deliver_push

            nid = str(n.id) if n else None
            transaction.on_commit(lambda: deliver_push.delay(str(user.id), title, body, data, nid, "orders" if category == "order" else ("jobs" if category == "rider" else "default")))
    sms = _template(key, "sms")
    if sms and sms.enabled and user.phone and prefs.get("sms", True):
        from .tasks import deliver_sms

        text = render_template(sms.bodySw if locale == "sw" and sms.bodySw else sms.body, **variables)
        transaction.on_commit(lambda: deliver_sms.delay(user.phone, text))
    try:
        from .realtime import broadcast

        if n:
            broadcast(f"user.{user.id}", {"type": "notification", "notification": notification_out(n)})
    except Exception:  # noqa: BLE001
        pass
    return n


def notification_out(n: Notification) -> dict[str, Any]:
    from core.media_urls import media_out

    return {"id": str(n.id), "type": n.type, "title": n.title, "body": n.body, "data": n.data, "image": media_out(n.image) if n.image_id else None, "readAt": n.read_at.isoformat() if n.read_at else None, "createdAt": n.created_at.isoformat()}
