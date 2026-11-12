from __future__ import annotations

from datetime import timedelta

from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from accounts.models import User


def audience_queryset(aud: dict, channel: str):
    qs = User.objects.filter(deleted_at__isnull=True, is_blocked=False, rider__isnull=True)
    if channel == "sms":
        # exclude(prefs__key=False) alone would also drop users who never set the key (NULL in SQL), so match the opt-out explicitly.
        qs = qs.filter(phone__isnull=False).exclude(Q(notification_prefs__has_key="sms") & Q(notification_prefs__sms=False))
    else:
        from notifications.models import PushToken

        # Only people with a live device token (a bare LEFT JOIN would also match users with no token at all).
        qs = qs.filter(Exists(PushToken.objects.filter(user=OuterRef("pk"), disabled_at__isnull=True))).exclude(Q(notification_prefs__has_key="marketing") & Q(notification_prefs__marketing=False)).distinct()
    if aud.get("customerTypes"):
        qs = qs.filter(customer_type__in=aud["customerTypes"])
    if aud.get("departments"):
        q = Q()
        for d in aud["departments"]:
            q |= Q(style_profile__departments__contains=[d])
        qs = qs.filter(q)
    if aud.get("hasOrdered") is True:
        qs = qs.filter(orders__status="DELIVERED").distinct()
    elif aud.get("hasOrdered") is False:
        qs = qs.exclude(orders__status="DELIVERED")
    if aud.get("lastSeenDays"):
        qs = qs.filter(last_seen_at__gte=timezone.now() - timedelta(days=int(aud["lastSeenDays"])))
    if aud.get("categoryIds"):
        from catalog.models import Category

        q = Q()
        for c in Category.objects.filter(id__in=aud["categoryIds"]):
            q |= Q(orders__items__product__category_links__category__path__startswith=c.path)
        qs = qs.filter(q).distinct()
    if aud.get("locale") in ("en", "sw"):
        qs = qs.filter(locale=aud["locale"])
    return qs
