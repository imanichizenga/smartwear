from __future__ import annotations

from celery import shared_task
from django.db import transaction
from django.utils import timezone


@shared_task
def publish_scheduled() -> dict:
    from .models import Product
    from .services import categories

    now = timezone.now()
    pub = Product.objects.filter(status="SCHEDULED", publish_at__lte=now, deleted_at__isnull=True)
    n_pub = 0
    for p in pub:
        p.status, p.published_at = "PUBLISHED", p.published_at or now
        p.save(update_fields=["status", "published_at"])
        n_pub += 1
    n_un = Product.objects.filter(status="PUBLISHED", unpublish_at__lte=now).update(status="ARCHIVED")
    if n_pub or n_un:
        categories.refresh_counts()
    return {"published": n_pub, "unpublished": n_un}


@shared_task
def apply_scheduled_prices() -> int:
    from .models import Product, ScheduledPriceChange
    from .services.products import refresh_denormalised

    n = 0
    for s in ScheduledPriceChange.objects.filter(applied_at__isnull=True, starts_at__lte=timezone.now()).select_related("variant"):
        with transaction.atomic():
            v = s.variant
            tiers_ok = all(t.unit_price < s.retail_price for t in v.tiers.all())
            if not tiers_ok:
                v.tiers.filter(unit_price__gte=s.retail_price).delete()
            v.retail_price = s.retail_price
            v.compare_at_price = s.compare_at_price if s.compare_at_price and s.compare_at_price > s.retail_price else None
            v.save(update_fields=["retail_price", "compare_at_price"])
            s.applied_at = timezone.now()
            s.save(update_fields=["applied_at"])
            refresh_denormalised(Product.objects.get(id=v.product_id))
            n += 1
    return n


@shared_task
def refresh_category_counts() -> None:
    from .services.categories import refresh_counts

    refresh_counts()
