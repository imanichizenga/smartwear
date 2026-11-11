"""Who is looking at prices: builds the PricingContext for the current request (cached per request)."""
from __future__ import annotations

from django.db.models import Q
from django.utils import timezone

from core import settings_service

from ..models import PriceListEntry
from ..pricing import PriceListEntry as PLE
from ..pricing import PricingContext, WholesaleSettings


def wholesale_settings() -> WholesaleSettings:
    return WholesaleSettings.from_settings(settings_service.get("pricing.wholesale"))


def context_for_user(user, variant_ids: list | None = None) -> PricingContext:
    ws = wholesale_settings()
    if user is None:
        return PricingContext("RETAIL", False, ws)
    ctx = PricingContext(user.customer_type, bool(user.wholesale_approved), ws)
    if ctx.is_wholesale:
        now = timezone.now()
        q = Q(price_list__customer=user)
        if user.customer_group_id:
            q |= Q(price_list__group_id=user.customer_group_id)
        qs = PriceListEntry.objects.filter(q, price_list__active=True).filter(Q(price_list__starts_at__isnull=True) | Q(price_list__starts_at__lte=now)).filter(Q(price_list__ends_at__isnull=True) | Q(price_list__ends_at__gt=now))
        if variant_ids is not None:
            qs = qs.filter(variant_id__in=variant_ids)
        # Customer-specific lists beat group lists: order so customer entries come last and win in the engine's max-minQty pick.
        ctx.price_list = [PLE(str(e.variant_id), e.unit_price, e.min_qty) for e in qs]
    return ctx


def request_user(request):
    p = getattr(request, "user", None)
    return p.user if p is not None and getattr(p, "kind", None) in ("customer", "rider") else None


def request_context(request, variant_ids: list | None = None) -> PricingContext:
    return context_for_user(request_user(request), variant_ids)


def locale_of(request) -> str:
    u = request_user(request)
    if u is not None and u.locale in ("en", "sw"):
        return u.locale
    return getattr(getattr(request, "_request", request), "locale", "en")
