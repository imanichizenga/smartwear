from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger("smartwear.marketing")


@shared_task(acks_late=True)
def send_campaign(campaign_id: str) -> dict:
    """Sends a campaign; any crash marks it FAILED with the reason (never stuck on SENDING)."""
    try:
        return _send_campaign(campaign_id)
    except Exception as e:  # noqa: BLE001
        from .models import Campaign

        logger.exception("campaign %s failed", campaign_id)
        c = Campaign.objects.filter(id=campaign_id).first()
        if c is not None:
            c.status = "FAILED"
            c.stats = {**(c.stats or {}), "error": str(e)[:200]}
            c.save(update_fields=["status", "stats"])
        return {"error": str(e)[:200]}


def _send_campaign(campaign_id: str) -> dict:
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
        from .models import CampaignDelivery
        from .views import campaign_image_url, campaign_route

        route = campaign_route(c)
        image = campaign_image_url(c)
        data = {"type": "campaign", "campaignId": str(c.id), "route": route, "link": c.link}
        CampaignDelivery.objects.filter(campaign=c).delete()  # a re-send starts a fresh count
        for locale in ("en", "sw"):
            group = [u for u in users if (u.locale == "sw") == (locale == "sw")]
            if not group:
                continue
            body = c.body_sw if locale == "sw" and c.body_sw else c.body
            title = c.title or "SmartWear"
            tokens = list(PushToken.objects.filter(user__in=group, disabled_at__isnull=True))
            res = send(tokens, title, body, data, channel="marketing", priority="normal", image=image)
            accepted = set(res.get("okTokens", []))
            by_user: dict = {}
            for t in tokens:
                d = by_user.setdefault(t.user_id, [0, False])
                d[0] += 1
                d[1] = d[1] or t.pk in accepted
            err = (res.get("errors") or [""])[0][:120]
            CampaignDelivery.objects.bulk_create(
                [CampaignDelivery(campaign=c, user=u, devices=by_user.get(u.id, [0, False])[0], delivered=by_user.get(u.id, [0, False])[1], error="" if by_user.get(u.id, [0, False])[1] else err) for u in group],
                ignore_conflicts=True,
            )
            ok += sum(1 for v in by_user.values() if v[1])
            failed += sum(1 for v in by_user.values() if not v[1])
            Notification.objects.bulk_create([Notification(user=u, type="system", title=title, body=body, data=data, image_id=c.image_id or _first_product_media_id(c)) for u in group])
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
    c.stats = {**c.stats, "audience": len(users), "delivered": ok, "failed": failed}  # people, not devices
    c.save()
    return c.stats


def _first_product_media_id(c):
    from catalog.models import ProductMedia

    if not c.product_ids:
        return None
    pm = ProductMedia.objects.filter(product_id=c.product_ids[0], role="gallery", media__type="IMAGE").order_by("sort_order", "id").first()
    return pm.media_id if pm else None


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
