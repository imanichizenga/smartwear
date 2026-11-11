from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger("smartwear.marketing")


@shared_task(acks_late=True)
def send_campaign(campaign_id: str) -> dict:
    from core.integrations.beem import BeemClient
    from notifications.models import Notification, PushToken
    from notifications.push import send

    from .campaigns import audience_queryset
    from .models import Campaign

    c = Campaign.objects.filter(id=campaign_id).first()
    if c is None or c.status in ("SENT", "CANCELLED"):
        return {"skipped": True}
    c.status = "SENDING"
    c.save(update_fields=["status"])
    users = list(audience_queryset(c.audience, c.channel)[:200000])
    ok = failed = 0
    if c.channel == "push":
        for locale in ("en", "sw"):
            group = [u for u in users if (u.locale == "sw") == (locale == "sw")]
            body = c.body_sw if locale == "sw" and c.body_sw else c.body
            tokens = list(PushToken.objects.filter(user__in=group, disabled_at__isnull=True))
            res = send(tokens, c.title or "SmartWear", body, {"campaignId": str(c.id), "link": c.link}, channel="marketing", priority="normal")
            ok += res["ok"]
            failed += res["sent"] - res["ok"]
            Notification.objects.bulk_create([Notification(user=u, type="system", title=c.title or "SmartWear", body=body, data={"campaignId": str(c.id), "link": c.link}) for u in group])
    else:
        client = BeemClient()
        if not client.configured:
            c.status = "FAILED"
            c.stats = {**c.stats, "error": "SMS (Beem) is not configured"}
            c.save()
            return c.stats
        for locale in ("en", "sw"):
            phones = [u.phone for u in users if u.phone and ((u.locale == "sw") == (locale == "sw"))]
            body = c.body_sw if locale == "sw" and c.body_sw else c.body
            for i in range(0, len(phones), 500):
                r = client.send_sms(phones[i : i + 500], body)
                ok += r.valid if r.ok else 0
                failed += r.invalid + (0 if r.ok else len(phones[i : i + 500]))
    c.status, c.sent_at = "SENT", timezone.now()
    c.stats = {**c.stats, "audience": len(users), "delivered": ok, "failed": failed}
    c.save()
    return c.stats


@shared_task
def notify_live_drops() -> int:
    """Drops whose launch time has passed notify their subscribers once."""
    from catalog.models import Collection
    from notifications.service import notify

    from .models import DropSubscription

    n = 0
    for c in Collection.objects.filter(is_drop=True, published=True, launches_at__lte=timezone.now(), subscriptions__notified_at__isnull=True).distinct():
        for sub in DropSubscription.objects.filter(collection=c, notified_at__isnull=True).select_related("user")[:5000]:
            notify(sub.user, "drop.live", {"dropName": c.title}, data={"collection": c.slug})
            sub.notified_at = timezone.now()
            sub.save(update_fields=["notified_at"])
            n += 1
    return n


@shared_task
def wishlist_price_drops() -> int:
    """Honest price-drop alerts: only when the current price is really below what it was when saved."""
    from commerce.models import WishlistItem
    from notifications.service import notify

    n = 0
    for it in WishlistItem.objects.filter(price_at_add__isnull=False, product__status="PUBLISHED").select_related("product", "board__user")[:20000]:
        p = it.product
        if p.min_price and p.min_price < it.price_at_add and p.in_stock:
            notify(it.board.user, "wishlist.price_drop", {"productTitle": p.title, "price": f"{p.currency} {p.min_price:,}"}, data={"product": p.slug})
            it.price_at_add = p.min_price
            it.save(update_fields=["price_at_add"])
            n += 1
    return n
